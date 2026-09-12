import { BadGatewayException, BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { CameraQueryDto } from './dto/camera-query.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import { applyDeptScope, AuthenticatedUser } from '../common/scoping/dept-scope.helper';
import { STORAGE_PROVIDER } from '../storage/storage-provider.token';
import type { StorageProvider } from '../storage/storage-provider.interface';

export interface CameraRecord {
  cameraId: string;
  departmentId: string;
  name: string;
  addressText: string | null;
  cameraType: string;
  brand: string | null;
  model: string | null;
  onvifStatus: string;
  onvifSource: string | null;
  integrationScore: string;
  dataConfidence: string;
  photoUrl: string | null;
  currentStatus: string;
  installedAt: Date | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  longitude: number;
  latitude: number;
  ipAddress: string | null;
  rtspPort: number | null;
  streamPath: string | null;
}

// Raw row shape as Postgres/Prisma's $queryRaw returns it — snake_case
// column names, plus the ST_X/ST_Y-derived longitude/latitude aliases.
interface RawCameraRow {
  camera_id: string;
  department_id: string;
  name: string;
  address_text: string | null;
  camera_type: string;
  brand: string | null;
  model: string | null;
  onvif_status: string;
  onvif_source: string | null;
  integration_score: string;
  data_confidence: string;
  photo_url: string | null;
  current_status: string;
  installed_at: Date | null;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  longitude: number;
  latitude: number;
  ip_address: string | null;
  rtsp_port: number | null;
  stream_path: string | null;
}

function mapRow(row: RawCameraRow): CameraRecord {
  return {
    cameraId: row.camera_id,
    departmentId: row.department_id,
    name: row.name,
    addressText: row.address_text,
    cameraType: row.camera_type,
    brand: row.brand,
    model: row.model,
    onvifStatus: row.onvif_status,
    onvifSource: row.onvif_source,
    integrationScore: row.integration_score,
    dataConfidence: row.data_confidence,
    photoUrl: row.photo_url,
    currentStatus: row.current_status,
    installedAt: row.installed_at,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    longitude: row.longitude,
    latitude: row.latitude,
    ipAddress: row.ip_address,
    rtspPort: row.rtsp_port,
    streamPath: row.stream_path,
  };
}

// Shared by createCamera's return, listCameras, getCameraById, and
// updateCamera's before/after reads — the identical column list every read
// needs, centralized here instead of duplicated four times.
const CAMERA_SELECT_SQL = `
  SELECT
    camera_id, department_id, name, address_text, camera_type, brand, model,
    onvif_status, onvif_source, integration_score, data_confidence, photo_url,
    current_status, installed_at, is_active, created_by, created_at, updated_at,
    ip_address, rtsp_port, stream_path,
    ST_X(location_geo::geometry) AS longitude,
    ST_Y(location_geo::geometry) AS latitude
  FROM camera
`;

@Injectable()
export class CameraRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContextService,
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,
  ) {}

  // `request` is optional: the bulk-upload background job calls this method
  // with no live HTTP request (it writes its own audit_log row directly via
  // writeAuditLogEntry instead — see BulkUploadService), so there is nothing
  // for AuditContextService to attach changes to in that case.
  async createCamera(
    request: Request | undefined,
    dto: CreateCameraDto,
    createdBy: string,
  ): Promise<CameraRecord> {
    let insertedId: string;
    try {
      const rows = await this.prisma.$queryRaw<{ camera_id: string }[]>`
        INSERT INTO camera (
          department_id, name, location_geo, address_text, camera_type,
          brand, model, installed_at, created_by
        ) VALUES (
          ${dto.departmentId}::uuid,
          ${dto.name},
          ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326),
          ${dto.addressText ?? null},
          ${dto.cameraType},
          ${dto.brand ?? null},
          ${dto.model ?? null},
          ${dto.installedAt ? new Date(dto.installedAt) : null},
          ${createdBy}::uuid
        )
        RETURNING camera_id
      `;
      insertedId = rows[0].camera_id;
    } catch (error) {
      throw this.translateInsertError(error);
    }

    const created = await this.findCameraRow(insertedId);
    if (!created) {
      throw new Error(`Camera ${insertedId} was inserted but could not be re-read`);
    }

    // Only the fields an admin actually filled in on the create form — not
    // the whole CameraRecord (which includes Date-typed fields AuditFieldValues
    // can't represent, and derived/default fields like currentStatus that
    // aren't meaningful as a "change" on a brand-new row).
    if (request) {
      this.auditContext.setChanges(
        request,
        null,
        {
          name: created.name,
          departmentId: created.departmentId,
          cameraType: created.cameraType,
          brand: created.brand,
          model: created.model,
          addressText: created.addressText,
          latitude: created.latitude,
          longitude: created.longitude,
        },
        created.cameraId,
      );
    }

    return created;
  }

  private translateInsertError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('camera_department_id_fkey')) {
      return new BadRequestException('departmentId does not refer to an existing department');
    }
    return error instanceof Error ? error : new Error(message);
  }

  // Shared by createCamera's return, listCameras, getCameraById, and
  // updateCamera's before/after reads — one parameterized lookup by ID.
  // Prisma.raw(CAMERA_SELECT_SQL) is safe here specifically because
  // CAMERA_SELECT_SQL is a hardcoded constant with no user input anywhere
  // in it; the actual user-supplied value (cameraId) still goes through
  // the parameterized `${cameraId}::uuid` slot, never through Prisma.raw.
  private async findCameraRow(cameraId: string): Promise<CameraRecord | null> {
    const rows = await this.prisma.$queryRaw<RawCameraRow[]>(
      Prisma.sql`${Prisma.raw(CAMERA_SELECT_SQL)} WHERE camera_id = ${cameraId}::uuid`,
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listCameras(
    query: CameraQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<CameraRecord[]> {
    const scoped = applyDeptScope(
      {
        departmentId: query.departmentId,
        cameraType: query.cameraType,
        integrationScore: query.integrationScore,
        currentStatus: query.currentStatus,
        isActive: query.isActive,
        search: query.search,
      },
      currentUser,
    );

    const conditions: Prisma.Sql[] = [];
    if (scoped.departmentId) {
      conditions.push(Prisma.sql`department_id = ${scoped.departmentId}::uuid`);
    }
    if (scoped.cameraType) {
      conditions.push(Prisma.sql`camera_type = ${scoped.cameraType}`);
    }
    if (scoped.integrationScore) {
      conditions.push(Prisma.sql`integration_score = ${scoped.integrationScore}`);
    }
    if (scoped.currentStatus) {
      conditions.push(Prisma.sql`current_status = ${scoped.currentStatus}`);
    }
    if (scoped.isActive !== undefined) {
      conditions.push(Prisma.sql`is_active = ${scoped.isActive}`);
    }
    if (scoped.search) {
      conditions.push(
        Prisma.sql`(name ILIKE ${'%' + scoped.search + '%'} OR address_text ILIKE ${'%' + scoped.search + '%'})`,
      );
    }

    const whereClause =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const offset = (query.page - 1) * query.limit;

    const rows = await this.prisma.$queryRaw<RawCameraRow[]>(
      Prisma.sql`${Prisma.raw(CAMERA_SELECT_SQL)} ${whereClause} ORDER BY created_at DESC LIMIT ${query.limit} OFFSET ${offset}`,
    );

    return rows.map(mapRow);
  }

  // Same filtering/scoping logic as listCameras, without pagination — used
  // by CSV export, which always returns the full filtered set in one
  // response rather than one page at a time.
  async listCamerasUnpaginated(
    filters: {
      departmentId?: string;
      cameraType?: string;
      integrationScore?: string;
      currentStatus?: string;
      isActive?: boolean;
      search?: string;
    },
    currentUser: AuthenticatedUser,
  ): Promise<CameraRecord[]> {
    const scoped = applyDeptScope(filters, currentUser);

    const conditions: Prisma.Sql[] = [];
    if (scoped.departmentId) {
      conditions.push(Prisma.sql`department_id = ${scoped.departmentId}::uuid`);
    }
    if (scoped.cameraType) {
      conditions.push(Prisma.sql`camera_type = ${scoped.cameraType}`);
    }
    if (scoped.integrationScore) {
      conditions.push(Prisma.sql`integration_score = ${scoped.integrationScore}`);
    }
    if (scoped.currentStatus) {
      conditions.push(Prisma.sql`current_status = ${scoped.currentStatus}`);
    }
    if (scoped.isActive !== undefined) {
      conditions.push(Prisma.sql`is_active = ${scoped.isActive}`);
    }
    if (scoped.search) {
      conditions.push(
        Prisma.sql`(name ILIKE ${'%' + scoped.search + '%'} OR address_text ILIKE ${'%' + scoped.search + '%'})`,
      );
    }

    const whereClause =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<RawCameraRow[]>(
      Prisma.sql`${Prisma.raw(CAMERA_SELECT_SQL)} ${whereClause} ORDER BY created_at DESC`,
    );

    return rows.map(mapRow);
  }

  async getCameraById(cameraId: string, currentUser: AuthenticatedUser): Promise<CameraRecord> {
    const camera = await this.findCameraRow(cameraId);

    if (!camera) {
      throw new NotFoundException(`Camera ${cameraId} not found`);
    }

    // A dept_viewer requesting a camera outside their department gets the
    // exact same NotFoundException as a genuinely nonexistent ID — never a
    // 403, and never a message that distinguishes "wrong department" from
    // "doesn't exist". This is deliberate: a dept_viewer must not be able
    // to confirm another department's camera exists at all.
    if (currentUser.role === 'dept_viewer' && camera.departmentId !== currentUser.departmentId) {
      throw new NotFoundException(`Camera ${cameraId} not found`);
    }

    return camera;
  }

  async updateCamera(
    request: Request,
    cameraId: string,
    dto: UpdateCameraDto,
    currentUser: AuthenticatedUser,
  ): Promise<CameraRecord> {
    // Reuses getCameraById so the same 404-not-403 dept_viewer scoping
    // check applies to updates too — a dept_viewer can't discover or edit
    // a camera outside their department via PATCH any more than via GET.
    const existing = await this.getCameraById(cameraId, currentUser);

    const changes = await this.applyCameraFieldChanges(cameraId, dto, existing);

    if (changes) {
      this.auditContext.setChanges(request, changes.before, changes.after, cameraId);
    }

    const updated = await this.findCameraRow(cameraId);
    if (!updated) {
      throw new Error(`Camera ${cameraId} was updated but could not be re-read`);
    }
    return updated;
  }

  // Data-mutation logic only — does NOT call auditContext.setChanges, so it
  // can be called from contexts with no live HTTP request (the bulk-upload
  // background job) as well as from updateCamera above. Returns the
  // before/after pair if anything actually changed, or null for a no-op.
  async applyCameraFieldChanges(
    cameraId: string,
    dto: UpdateCameraDto,
    existing: CameraRecord,
  ): Promise<{
    before: Record<string, string | number | boolean | null>;
    after: Record<string, string | number | boolean | null>;
  } | null> {
    const setClauses: Prisma.Sql[] = [];
    const before: Record<string, string | number | boolean | null> = {};
    const after: Record<string, string | number | boolean | null> = {};

    const plainFieldMap: Array<[keyof UpdateCameraDto, string]> = [
      ['name', 'name'],
      ['cameraType', 'camera_type'],
      ['brand', 'brand'],
      ['model', 'model'],
      ['addressText', 'address_text'],
      ['rtspPort', 'rtsp_port'],
      ['streamPath', 'stream_path'],
    ];

    for (const [dtoKey, column] of plainFieldMap) {
      const newValue = dto[dtoKey];
      if (newValue === undefined) continue;
      const oldValue = existing[dtoKey] as string | number | null;
      if (oldValue === newValue) continue;
      setClauses.push(Prisma.sql`${Prisma.raw(column)} = ${newValue}`);
      before[dtoKey] = oldValue;
      after[dtoKey] = newValue;
    }

    // ip_address is a Postgres `inet` column — $executeRaw binds a plain
    // string param as `text`, which Postgres won't implicitly cast, so this
    // one field needs an explicit ::inet cast unlike the others above.
    if (dto.ipAddress !== undefined && existing.ipAddress !== dto.ipAddress) {
      setClauses.push(Prisma.sql`ip_address = ${dto.ipAddress}::inet`);
      before.ipAddress = existing.ipAddress;
      after.ipAddress = dto.ipAddress;
    }

    if (dto.installedAt !== undefined) {
      const newDate = new Date(dto.installedAt);
      const oldDate = existing.installedAt;
      const oldDateStr = oldDate ? oldDate.toISOString().slice(0, 10) : null;
      if (oldDateStr !== dto.installedAt) {
        setClauses.push(Prisma.sql`installed_at = ${newDate}`);
        before.installedAt = oldDateStr;
        after.installedAt = dto.installedAt;
      }
    }

    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      const coordinatesChanged =
        existing.latitude !== dto.latitude || existing.longitude !== dto.longitude;
      if (coordinatesChanged) {
        setClauses.push(
          Prisma.sql`location_geo = ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)`,
        );
        before.latitude = existing.latitude;
        before.longitude = existing.longitude;
        after.latitude = dto.latitude;
        after.longitude = dto.longitude;
      }
    }

    if (setClauses.length === 0) {
      return null;
    }

    setClauses.push(Prisma.sql`updated_at = now()`);

    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE camera SET ${Prisma.join(setClauses, ', ')} WHERE camera_id = ${cameraId}::uuid`,
    );

    return { before, after };
  }

  // Public, unscoped read by ID — no AuthenticatedUser required, unlike
  // getCameraById. Exists for the bulk-upload job, which already found the
  // camera unscoped via a direct Prisma query and needs a full CameraRecord
  // to pass into applyCameraFieldChanges, with no real AuthenticatedUser
  // context to fabricate for a scoping-aware call.
  async findCameraRecordById(cameraId: string): Promise<CameraRecord | null> {
    return this.findCameraRow(cameraId);
  }

  async softDeleteCamera(
    request: Request,
    cameraId: string,
    currentUser: AuthenticatedUser,
  ): Promise<void> {
    // Reuses getCameraById for the same existence + dept_viewer scoping
    // check as every other single-camera operation.
    await this.getCameraById(cameraId, currentUser);

    await this.prisma.camera.update({
      where: { cameraId },
      data: { isActive: false },
    });

    this.auditContext.setChanges(request, { isActive: true }, { isActive: false }, cameraId);
  }

  async updateCameraPhoto(
    request: Request,
    cameraId: string,
    fileBuffer: Buffer,
    currentUser: AuthenticatedUser,
  ): Promise<CameraRecord> {
    const existing = await this.getCameraById(cameraId, currentUser);

    // Unlike the AI provider, there's no meaningful "unknown" fallback for
    // "the photo didn't get stored" — this endpoint's entire job is the
    // upload, so a storage failure must be visible to the caller, not
    // silently swallowed. Wrapped explicitly as BadGatewayException rather
    // than left to bubble up as a generic 500.
    let photoUrl: string;
    try {
      photoUrl = await this.storageProvider.save(fileBuffer, cameraId);
    } catch (error) {
      throw new BadGatewayException(
        `Failed to upload photo: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await this.prisma.$executeRaw`
      UPDATE camera SET photo_url = ${photoUrl}, updated_at = now() WHERE camera_id = ${cameraId}::uuid
    `;

    this.auditContext.setChanges(request, { photoUrl: existing.photoUrl }, { photoUrl }, cameraId);

    const updated = await this.findCameraRow(cameraId);
    if (!updated) {
      throw new Error(`Camera ${cameraId} was updated but could not be re-read`);
    }
    return updated;
  }
}
