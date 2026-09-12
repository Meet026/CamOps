import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BulkUploadService } from './bulk-upload.service';
import { CsvParserService } from './csv-parser.service';
import { DepartmentLookupService } from './department-lookup.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CameraRegistryService } from '../camera-registry.service';

jest.mock('../../common/audit/write-audit-log-entry', () => ({
  writeAuditLogEntry: jest.fn(),
}));
import { writeAuditLogEntry } from '../../common/audit/write-audit-log-entry';

describe('BulkUploadService', () => {
  let service: BulkUploadService;
  let csvParser: { validateStructure: jest.Mock; parseRows: jest.Mock };
  let departmentLookup: { loadCodeToIdMap: jest.Mock };
  let cameraRegistryService: {
    createCamera: jest.Mock;
    applyCameraFieldChanges: jest.Mock;
    findCameraRecordById: jest.Mock;
  };
  let prisma: {
    bulkUploadJob: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    camera: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    csvParser = { validateStructure: jest.fn(), parseRows: jest.fn() };
    departmentLookup = { loadCodeToIdMap: jest.fn().mockResolvedValue(new Map([['HOME', 'dept-1']])) };
    cameraRegistryService = {
      createCamera: jest.fn(),
      applyCameraFieldChanges: jest.fn(),
      findCameraRecordById: jest.fn(),
    };
    prisma = {
      bulkUploadJob: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
      camera: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkUploadService,
        { provide: CsvParserService, useValue: csvParser },
        { provide: DepartmentLookupService, useValue: departmentLookup },
        { provide: CameraRegistryService, useValue: cameraRegistryService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BulkUploadService);
    (writeAuditLogEntry as jest.Mock).mockClear();
  });

  it('validates structure before creating any job', async () => {
    csvParser.validateStructure.mockImplementation(() => {
      throw new BadRequestException('bad file');
    });

    await expect(service.createJob(Buffer.from(''), 'user-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.bulkUploadJob.create).not.toHaveBeenCalled();
  });

  it('counts data rows and creates a job with that total, returning the new jobId', async () => {
    async function* fakeRows() {
      yield { rowNumber: 2, raw: {} };
      yield { rowNumber: 3, raw: {} };
    }
    csvParser.parseRows.mockReturnValueOnce(fakeRows()).mockReturnValueOnce(fakeRows());
    prisma.bulkUploadJob.create.mockResolvedValue({ jobId: 'job-1' });

    const result = await service.createJob(Buffer.from('irrelevant'), 'user-1');

    expect(result).toEqual({ jobId: 'job-1' });
    expect(prisma.bulkUploadJob.create).toHaveBeenCalledWith({
      data: { totalRows: 2, createdBy: 'user-1', status: 'pending' },
    });
  });

  describe('processRowsInBackground', () => {
    function makeRow(overrides: Partial<Record<string, string>> = {}) {
      return {
        name: 'Camera A',
        departmentCode: 'HOME',
        latitude: '23.0',
        longitude: '72.0',
        cameraType: 'ip',
        brand: '',
        model: '',
        addressText: '',
        installedAt: '',
        ...overrides,
      };
    }

    it('creates a new camera for a row with no existing match, and writes a create_camera audit entry', async () => {
      async function* rows() {
        yield { rowNumber: 2, raw: makeRow() };
      }
      csvParser.parseRows.mockReturnValue(rows());
      prisma.camera.findFirst.mockResolvedValue(null);
      cameraRegistryService.createCamera.mockResolvedValue({ cameraId: 'cam-new' });

      await (service as any).processRowsInBackground('job-1', Buffer.from('x'), 'user-1');

      expect(cameraRegistryService.createCamera).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ name: 'Camera A', departmentId: 'dept-1' }),
        'user-1',
      );
      expect(writeAuditLogEntry).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        'create_camera',
        'camera',
        'cam-new',
        expect.objectContaining({ before: null }),
      );
    });

    it('updates an existing camera for a row matching (departmentId, name), and writes an update_camera audit entry', async () => {
      async function* rows() {
        yield { rowNumber: 2, raw: makeRow({ name: 'Existing Camera' }) };
      }
      csvParser.parseRows.mockReturnValue(rows());
      prisma.camera.findFirst.mockResolvedValue({
        cameraId: 'cam-existing',
        departmentId: 'dept-1',
        name: 'Existing Camera',
      });
      cameraRegistryService.findCameraRecordById.mockResolvedValue({
        cameraId: 'cam-existing',
        departmentId: 'dept-1',
        name: 'Old Name',
      });
      cameraRegistryService.applyCameraFieldChanges.mockResolvedValue({
        before: { name: 'Old Name' },
        after: { name: 'Existing Camera' },
      });

      await (service as any).processRowsInBackground('job-1', Buffer.from('x'), 'user-1');

      expect(cameraRegistryService.findCameraRecordById).toHaveBeenCalledWith('cam-existing');
      expect(cameraRegistryService.applyCameraFieldChanges).toHaveBeenCalled();
      expect(writeAuditLogEntry).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        'update_camera',
        'camera',
        'cam-existing',
        expect.objectContaining({ before: { name: 'Old Name' }, after: { name: 'Existing Camera' } }),
      );
    });

    it('writes no audit entry for a matched row where nothing actually changed', async () => {
      async function* rows() {
        yield { rowNumber: 2, raw: makeRow({ name: 'Existing Camera' }) };
      }
      csvParser.parseRows.mockReturnValue(rows());
      prisma.camera.findFirst.mockResolvedValue({
        cameraId: 'cam-existing',
        departmentId: 'dept-1',
        name: 'Existing Camera',
      });
      cameraRegistryService.findCameraRecordById.mockResolvedValue({
        cameraId: 'cam-existing',
        departmentId: 'dept-1',
        name: 'Existing Camera',
      });
      cameraRegistryService.applyCameraFieldChanges.mockResolvedValue(null);

      await (service as any).processRowsInBackground('job-1', Buffer.from('x'), 'user-1');

      expect(writeAuditLogEntry).not.toHaveBeenCalled();
    });

    it('records a row error and does not create/update anything when departmentCode is unknown', async () => {
      async function* rows() {
        yield { rowNumber: 5, raw: makeRow({ departmentCode: 'ZZZZ' }) };
      }
      csvParser.parseRows.mockReturnValue(rows());

      await (service as any).processRowsInBackground('job-1', Buffer.from('x'), 'user-1');

      expect(cameraRegistryService.createCamera).not.toHaveBeenCalled();
      const updateCalls = prisma.bulkUploadJob.update.mock.calls;
      const lastUpdateData = updateCalls[updateCalls.length - 1][0].data;
      expect(lastUpdateData.rowErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            row: 5,
            error: expect.stringContaining('ZZZZ'),
          }),
        ]),
      );
    });

    it('records a row error for a row that fails class-validator rules (e.g. missing name)', async () => {
      async function* rows() {
        yield { rowNumber: 7, raw: makeRow({ name: '' }) };
      }
      csvParser.parseRows.mockReturnValue(rows());

      await (service as any).processRowsInBackground('job-1', Buffer.from('x'), 'user-1');

      expect(cameraRegistryService.createCamera).not.toHaveBeenCalled();
      const updateCalls = prisma.bulkUploadJob.update.mock.calls;
      const lastUpdateData = updateCalls[updateCalls.length - 1][0].data;
      expect(lastUpdateData.rowErrors).toEqual(
        expect.arrayContaining([expect.objectContaining({ row: 7 })]),
      );
    });

    it('marks the job completed after processing all rows', async () => {
      async function* rows() {
        yield { rowNumber: 2, raw: makeRow() };
      }
      csvParser.parseRows.mockReturnValue(rows());
      prisma.camera.findFirst.mockResolvedValue(null);
      cameraRegistryService.createCamera.mockResolvedValue({ cameraId: 'cam-new' });

      await (service as any).processRowsInBackground('job-1', Buffer.from('x'), 'user-1');

      const updateCalls = prisma.bulkUploadJob.update.mock.calls;
      const lastCall = updateCalls[updateCalls.length - 1][0];
      expect(lastCall.where).toEqual({ jobId: 'job-1' });
      expect(lastCall.data.status).toBe('completed');
      expect(lastCall.data.completedAt).toEqual(expect.any(Date));
    });
  });

  describe('getJobStatus', () => {
    it('returns the mapped job status', async () => {
      prisma.bulkUploadJob.findUnique.mockResolvedValue({
        jobId: 'job-1',
        status: 'completed',
        totalRows: 10,
        processedRows: 10,
        succeededCount: 8,
        failedCount: 2,
        rowErrors: [{ row: 3, error: 'bad row' }],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: new Date('2026-01-01T00:01:00Z'),
      });

      const result = await service.getJobStatus('job-1');

      expect(result).toEqual({
        jobId: 'job-1',
        status: 'completed',
        totalRows: 10,
        processedRows: 10,
        succeededCount: 8,
        failedCount: 2,
        rowErrors: [{ row: 3, error: 'bad row' }],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: new Date('2026-01-01T00:01:00Z'),
      });
    });

    it('throws NotFoundException when the job does not exist', async () => {
      prisma.bulkUploadJob.findUnique.mockResolvedValue(null);

      await expect(service.getJobStatus('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
