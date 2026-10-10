import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';
import { normalizePlateNumber } from './plate-number.util';
import { WantedNotificationService } from './wanted-notification.service';
import { CreateWantedVehicleDto } from './dto/create-wanted-vehicle.dto';
import {
  CheckPlateResult,
  CreatedWantedVehicle,
  WantedVehicleRecord,
  WantedVehicleStatus,
} from './wanted-list.types';

// Raw row shape as Postgres/Prisma's $queryRaw returns it — snake_case,
// same convention as camera-registry.service.ts's RawCameraRow.
interface RawWantedVehicleRow {
  wanted_vehicle_id: string;
  person_name: string;
  plate_number: string;
  crime_details: string;
  status: string;
  department_id: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

function mapRow(row: RawWantedVehicleRow): WantedVehicleRecord {
  return {
    wantedVehicleId: row.wanted_vehicle_id,
    personName: row.person_name,
    plateNumber: row.plate_number,
    crimeDetails: row.crime_details,
    status: row.status as WantedVehicleRecord['status'],
    departmentId: row.department_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

const WANTED_COLUMNS = Prisma.sql`wanted_vehicle_id, person_name, plate_number, crime_details,
  status, department_id, created_at, updated_at, resolved_at`;

// Prisma surfaces a Postgres unique violation (23505) either directly or
// wrapped in a P2010 raw-query error, depending on the call path.
function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; meta?: { code?: string } } | null;
  return err?.code === '23505' || err?.meta?.code === '23505';
}

// Admins maintain the wanted list here (see
// docs/superpowers/specs/2026-10-10-wanted-plate-camera-alerts-design.md).
// Every insert/resolve fires the wanted_vehicle_changed DB trigger, which
// tells camera workers to reload their in-memory list.
@Injectable()
export class WantedListService {
  private readonly logger = new Logger(WantedListService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContextService,
    private readonly notificationService: WantedNotificationService,
  ) {}

  async listWanted(status?: WantedVehicleStatus): Promise<WantedVehicleRecord[]> {
    const where = status ? Prisma.sql`WHERE status = ${status}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<RawWantedVehicleRow[]>(
      Prisma.sql`SELECT ${WANTED_COLUMNS} FROM wanted_vehicle ${where} ORDER BY created_at DESC LIMIT 500`,
    );
    return rows.map(mapRow);
  }

  async createWanted(request: Request, dto: CreateWantedVehicleDto): Promise<CreatedWantedVehicle> {
    const plate = normalizePlateNumber(dto.plateNumber);
    if (!plate) {
      throw new BadRequestException('plateNumber must contain letters or digits');
    }

    let rows: RawWantedVehicleRow[];
    try {
      rows = await this.prisma.$queryRaw<RawWantedVehicleRow[]>(Prisma.sql`
        INSERT INTO wanted_vehicle (person_name, plate_number, crime_details)
        VALUES (${dto.personName.trim()}, ${plate}, ${dto.crimeDetails.trim()})
        RETURNING ${WANTED_COLUMNS}
      `);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`${plate} is already on the active wanted list`);
      }
      throw error;
    }

    const record = mapRow(rows[0]);
    this.auditContext.setChanges(
      request,
      null,
      { plateNumber: plate, personName: record.personName },
      record.wantedVehicleId,
    );
    // The vehicle is already listed (and pushed to cameras) at this point; a
    // look-back failure must not turn the add into an error the admin
    // retries into a 409, nor skip the audit entry.
    let lookbackAlerts: number | null;
    try {
      lookbackAlerts = await this.notificationService.createLookbackNotifications(
        record.wantedVehicleId,
        plate,
      );
    } catch (error) {
      this.logger.error(`Look-back failed for ${plate}: ${(error as Error).message}`);
      lookbackAlerts = null;
    }
    return { ...record, lookbackAlerts };
  }

  async resolveWanted(request: Request, wantedVehicleId: string): Promise<WantedVehicleRecord> {
    const existing = await this.prisma.$queryRaw<RawWantedVehicleRow[]>(Prisma.sql`
      SELECT ${WANTED_COLUMNS} FROM wanted_vehicle WHERE wanted_vehicle_id = ${wantedVehicleId}::uuid
    `);
    if (existing.length === 0) {
      throw new NotFoundException('Wanted vehicle not found');
    }
    if (existing[0].status === 'resolved') {
      throw new ConflictException('This wanted vehicle is already resolved');
    }

    const rows = await this.prisma.$queryRaw<RawWantedVehicleRow[]>(Prisma.sql`
      UPDATE wanted_vehicle
      SET status = 'resolved', resolved_at = now(), updated_at = now()
      WHERE wanted_vehicle_id = ${wantedVehicleId}::uuid
      RETURNING ${WANTED_COLUMNS}
    `);
    this.auditContext.setChanges(request, { status: 'active' }, { status: 'resolved' }, wantedVehicleId);
    return mapRow(rows[0]);
  }

  async checkPlate(rawPlate: string): Promise<CheckPlateResult> {
    const plate = normalizePlateNumber(rawPlate);
    if (!plate) {
      throw new BadRequestException('plate must not be empty');
    }

    const rows = await this.prisma.$queryRaw<RawWantedVehicleRow[]>(
      Prisma.sql`
        SELECT
          wanted_vehicle_id, person_name, plate_number, crime_details,
          status, department_id, created_at, updated_at, resolved_at
        FROM wanted_vehicle
        WHERE plate_number = ${plate} AND status = 'active'
        LIMIT 1
      `,
    );

    if (rows.length === 0) {
      return { matched: false, wantedVehicle: null };
    }
    return { matched: true, wantedVehicle: mapRow(rows[0]) };
  }
}
