import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePlateNumber } from './plate-number.util';
import { CheckPlateResult, WantedVehicleRecord } from './wanted-list.types';

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

// This table is populated and maintained outside this application —
// departments own their wanted-list records in their own systems (see
// docs/superpowers/specs/2026-09-12-wanted-list-design.md). This service
// is deliberately read-only: it exists only to answer "is this plate on
// the wanted list right now" during Vehicle Search.
@Injectable()
export class WantedListService {
  constructor(private readonly prisma: PrismaService) {}

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
