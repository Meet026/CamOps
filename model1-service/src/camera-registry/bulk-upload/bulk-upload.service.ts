import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../../prisma/prisma.service';
import { CsvParserService } from './csv-parser.service';
import { DepartmentLookupService } from './department-lookup.service';
import { CameraRegistryService } from '../camera-registry.service';
import { BulkUploadRowDto } from '../dto/bulk-upload-row.dto';
import { CreateCameraDto } from '../dto/create-camera.dto';
import { UpdateCameraDto } from '../dto/update-camera.dto';
import { writeAuditLogEntry } from '../../common/audit/write-audit-log-entry';

interface RowError {
  row: number;
  error: string;
}

const BATCH_SIZE = 50;
const BATCH_CONCURRENCY = 5;

@Injectable()
export class BulkUploadService {
  private readonly logger = new Logger(BulkUploadService.name);

  constructor(
    private readonly csvParser: CsvParserService,
    private readonly departmentLookup: DepartmentLookupService,
    private readonly cameraRegistryService: CameraRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  async createJob(fileBuffer: Buffer, createdBy: string): Promise<{ jobId: string }> {
    this.csvParser.validateStructure(fileBuffer);

    let totalRows = 0;
    for await (const _row of this.csvParser.parseRows(fileBuffer)) {
      totalRows += 1;
    }

    const job = await this.prisma.bulkUploadJob.create({
      data: { totalRows, createdBy, status: 'pending' },
    });

    void this.processRowsInBackground(job.jobId, fileBuffer, createdBy);

    return { jobId: job.jobId };
  }

  async getJobStatus(jobId: string) {
    const job = await this.prisma.bulkUploadJob.findUnique({ where: { jobId } });

    if (!job) {
      throw new NotFoundException(`Bulk upload job ${jobId} not found`);
    }

    return {
      jobId: job.jobId,
      status: job.status,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      succeededCount: job.succeededCount,
      failedCount: job.failedCount,
      rowErrors: job.rowErrors,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  }

  private async processRowsInBackground(
    jobId: string,
    fileBuffer: Buffer,
    createdBy: string,
  ): Promise<void> {
    const departmentMap = await this.departmentLookup.loadCodeToIdMap();

    let processedRows = 0;
    let succeededCount = 0;
    let failedCount = 0;
    const rowErrors: RowError[] = [];

    let batch: Array<{ rowNumber: number; raw: Record<string, string> }> = [];

    const flushBatch = async () => {
      if (batch.length === 0) return;

      // Bounded concurrency within the batch: process BATCH_CONCURRENCY
      // rows at a time, not all 50 at once (risks connection pool
      // exhaustion) and not fully sequential (slow at 10,000-row scale).
      for (let i = 0; i < batch.length; i += BATCH_CONCURRENCY) {
        const slice = batch.slice(i, i + BATCH_CONCURRENCY);
        await Promise.all(
          slice.map((row) => this.processSingleRow(row, departmentMap, createdBy, rowErrors)),
        );
      }

      processedRows += batch.length;
      failedCount = rowErrors.length;
      succeededCount = processedRows - failedCount;

      await this.prisma.bulkUploadJob.update({
        where: { jobId },
        data: {
          processedRows,
          succeededCount,
          failedCount,
          rowErrors: rowErrors as unknown as object,
          status: 'processing',
        },
      });

      batch = [];

      // Yield to the event loop between batches so other concurrent
      // requests (logins, other API calls) get interleaved processing
      // time instead of waiting behind the whole job.
      await new Promise((resolve) => setImmediate(resolve));
    };

    try {
      for await (const row of this.csvParser.parseRows(fileBuffer)) {
        batch.push(row);
        if (batch.length >= BATCH_SIZE) {
          await flushBatch();
        }
      }
      await flushBatch();

      failedCount = rowErrors.length;
      succeededCount = processedRows - failedCount;

      await this.prisma.bulkUploadJob.update({
        where: { jobId },
        data: {
          processedRows,
          succeededCount,
          failedCount,
          rowErrors: rowErrors as unknown as object,
          status: 'completed',
          completedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Bulk upload job ${jobId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.prisma.bulkUploadJob.update({
        where: { jobId },
        data: { status: 'failed', rowErrors: rowErrors as unknown as object },
      });
    }
  }

  private async processSingleRow(
    row: { rowNumber: number; raw: Record<string, string> },
    departmentMap: Map<string, string>,
    createdBy: string,
    rowErrors: RowError[],
  ): Promise<void> {
    // CSV cells with no value parse as empty strings, not undefined/null —
    // but @IsOptional() only skips validation for undefined/null, so an
    // empty-string optional field (e.g. installedAt: '') would otherwise
    // fail its @IsDateString()/@IsString() check. Convert every empty
    // string to undefined before validating, for both optional fields and
    // the numeric lat/long conversion.
    const normalized = Object.fromEntries(
      Object.entries(row.raw).map(([key, value]) => [key, value === '' ? undefined : value]),
    );

    const dto = plainToInstance(BulkUploadRowDto, {
      ...normalized,
      latitude: normalized.latitude ? Number(normalized.latitude) : undefined,
      longitude: normalized.longitude ? Number(normalized.longitude) : undefined,
    });

    const validationErrors = await validate(dto);
    if (validationErrors.length > 0) {
      const message = validationErrors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('; ');
      rowErrors.push({ row: row.rowNumber, error: message });
      return;
    }

    const departmentId = departmentMap.get(dto.departmentCode);
    if (!departmentId) {
      rowErrors.push({
        row: row.rowNumber,
        error: `departmentCode '${dto.departmentCode}' does not match any known department`,
      });
      return;
    }

    const existing = await this.prisma.camera.findFirst({
      where: { departmentId, name: dto.name },
    });

    if (!existing) {
      const createDto: CreateCameraDto = {
        name: dto.name,
        departmentId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        cameraType: dto.cameraType,
        brand: dto.brand,
        model: dto.model,
        addressText: dto.addressText,
        installedAt: dto.installedAt,
      };

      const created = await this.cameraRegistryService.createCamera(createDto, createdBy);

      writeAuditLogEntry(this.prisma, createdBy, 'create_camera', 'camera', {
        before: null,
        after: { cameraId: created.cameraId, name: created.name },
      });
      return;
    }

    const updateDto: UpdateCameraDto = {
      name: dto.name,
      latitude: dto.latitude,
      longitude: dto.longitude,
      cameraType: dto.cameraType,
      brand: dto.brand,
      model: dto.model,
      addressText: dto.addressText,
      installedAt: dto.installedAt,
    };

    const existingRecord = await this.cameraRegistryService.findCameraRecordById(
      existing.cameraId,
    );
    if (!existingRecord) {
      // Extremely unlikely (the row was just found by findFirst above),
      // but handled explicitly rather than passing a possibly-null value
      // into applyCameraFieldChanges — e.g. a concurrent hard-delete
      // between the findFirst and this call.
      rowErrors.push({
        row: row.rowNumber,
        error: `Camera ${existing.cameraId} was found but could not be re-read`,
      });
      return;
    }

    const changes = await this.cameraRegistryService.applyCameraFieldChanges(
      existing.cameraId,
      updateDto,
      existingRecord,
    );

    if (changes) {
      writeAuditLogEntry(this.prisma, createdBy, 'update_camera', 'camera', {
        before: changes.before,
        after: changes.after,
      });
    }
  }
}
