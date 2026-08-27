# Camera Registry — Core CRUD + GPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT CONSTRAINT — READ BEFORE STARTING:** Never run `git init`, `git add`, or `git commit`. The user manages all version control themselves. Every task ends with "stop — do not commit" instead of a commit step.
>
> **VERIFICATION STYLE — READ BEFORE STARTING:** Do not write separate report/brief markdown files per task. Implement each task's code, run the real test/verify commands for what that task touched, and report results inline. Do not re-run the entire test suite after every small task — run the tests scoped to what you just changed. One full regression pass (`npm test` + `npm run test:e2e` + `npx tsc --noEmit`) happens once, at the very end (the Final Task), not after each task.

**Goal:** Build the `camera-registry` module's core CRUD (create, list, get-one, update, soft-delete) with GPS coordinates stored as real PostGIS points, `dept_viewer` row scoping, and audit logging — the first business module built on top of the Phase 1-4 backend foundation.

**Architecture:** A new NestJS module (`src/camera-registry/`) following the existing `module.ts`/`controller.ts`/`service.ts`/`dto/` pattern already used by `users`. Plain fields go through Prisma's normal query builder where possible; the PostGIS `location_geo` column is read/written exclusively via parameterized `$queryRaw`/`$executeRaw`, since Prisma cannot express `GEOGRAPHY` operations natively (confirmed in `prisma/schema.prisma`'s own doc comment on `Camera.locationGeo`). Every mutating endpoint follows the `before → change → auditContext.setChanges(request, before, after)` pattern established in `UsersService.updateRole`.

**Tech Stack:** NestJS, Prisma (`$queryRaw`/`$executeRaw` for spatial columns), `class-validator`, PostgreSQL + PostGIS (`ST_MakePoint`, `ST_SetSRID`, `ST_X`, `ST_Y`).

**Spec:** `../specs/2026-08-26-camera-registry-core-design.md`

## Global Constraints

- Never run `git init`/`git add`/`git commit`. No report files per task — inline verification only, one full regression at the end.
- All spatial (`location_geo`) reads/writes use `prisma.$queryRaw`/`prisma.$executeRaw` with parameterized queries — never string-concatenated SQL, never the plain Prisma query builder for this column (Prisma cannot express `GEOGRAPHY` operations).
- Every other field uses plain Prisma calls where the operation doesn't also need to touch `location_geo` in the same query.
- Roles, exactly as specified: `POST`/`PATCH` → `admin` + `field_officer`; `DELETE` → `admin` only; `GET` (list and get-one) → all four roles, with `dept_viewer` scoped via `applyDeptScope` from `src/common/scoping/dept-scope.helper.ts`.
- `dept_viewer` accessing a camera outside their department (list filter or direct ID) gets the exact same result as if the camera didn't exist — 404, never 403, never a distinguishing error message. This is a hard security requirement, not a nicety.
- Every mutating endpoint (create, update, delete) is decorated `@Audit(action, 'camera')` and records before/after via `AuditContextService.setChanges(request, before, after)` — only the fields that actually changed, not the whole record.
- `GET /cameras`'s `isActive` filter has **no default** — omitted means both active and inactive cameras are returned; `true`/`false` narrows to exactly that subset.
- A lone `latitude` or `longitude` in `UpdateCameraDto` (one present, the other absent) is a 400 validation error — never silently ignored, never treated as "no change."
- `departmentId` foreign-key violations on create surface as a clean 400, not a raw Postgres error leaking through the global exception filter as a 500.
- No new database migration — every column this module needs already exists in `prisma/schema.prisma` and the live database.

---

## File Structure

```
src/camera-registry/
├── camera-registry.module.ts
├── camera-registry.controller.ts
├── camera-registry.controller.spec.ts
├── camera-registry.service.ts
├── camera-registry.service.spec.ts
└── dto/
    ├── create-camera.dto.ts
    ├── update-camera.dto.ts
    └── camera-query.dto.ts

test/
└── camera-registry.e2e-spec.ts
```

`camera-registry.service.ts` contains one private helper (`buildCameraSelectSql` or similar — exact name decided in Task 2) that centralizes the shared "select every camera column plus `ST_X`/`ST_Y` as longitude/latitude" SQL fragment, since Create's return, List, Get One, and Update's before-read all need the identical column list. This avoids duplicating that SQL string four times.

---

## Task 1: DTOs

**Files:**
- Create: `src/camera-registry/dto/create-camera.dto.ts`
- Create: `src/camera-registry/dto/update-camera.dto.ts`
- Create: `src/camera-registry/dto/camera-query.dto.ts`
- Test: `src/camera-registry/dto/create-camera.dto.spec.ts`
- Test: `src/camera-registry/dto/update-camera.dto.spec.ts`
- Test: `src/camera-registry/dto/camera-query.dto.spec.ts`

**Interfaces:**
- Consumes: `PaginationDto` from `src/common/dto/pagination.dto.ts` — `{ page: number = 1, limit: number = 25 }`, extended by `CameraQueryDto`.
- Produces: `CreateCameraDto`, `UpdateCameraDto`, `CameraQueryDto` classes, consumed by Task 3's controller and Task 2's service.

- [ ] **Step 1: Write the failing test for `CreateCameraDto`**

Create `src/camera-registry/dto/create-camera.dto.spec.ts`:

```typescript
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCameraDto } from './create-camera.dto';

describe('CreateCameraDto', () => {
  const validPayload = {
    name: 'Main Gate Camera',
    departmentId: '706b50a5-b637-4d7b-8a0a-d63ed164f598',
    latitude: 23.0225,
    longitude: 72.5714,
    cameraType: 'ip',
  };

  it('accepts a minimal valid payload', async () => {
    const dto = plainToInstance(CreateCameraDto, validPayload);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a full payload including optional fields', async () => {
    const dto = plainToInstance(CreateCameraDto, {
      ...validPayload,
      brand: 'Hikvision',
      model: 'DS-2CD2143G0-I',
      addressText: 'Near Main Gate, Sector 5',
      installedAt: '2026-01-15',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing name', async () => {
    const { name, ...rest } = validPayload;
    const dto = plainToInstance(CreateCameraDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a missing departmentId', async () => {
    const { departmentId, ...rest } = validPayload;
    const dto = plainToInstance(CreateCameraDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'departmentId')).toBe(true);
  });

  it('rejects a non-UUID departmentId', async () => {
    const dto = plainToInstance(CreateCameraDto, { ...validPayload, departmentId: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'departmentId')).toBe(true);
  });

  it('rejects an out-of-range latitude', async () => {
    const dto = plainToInstance(CreateCameraDto, { ...validPayload, latitude: 200 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('rejects an out-of-range longitude', async () => {
    const dto = plainToInstance(CreateCameraDto, { ...validPayload, longitude: -200 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'longitude')).toBe(true);
  });

  it('rejects a cameraType that is not analog or ip', async () => {
    const dto = plainToInstance(CreateCameraDto, { ...validPayload, cameraType: 'wireless' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cameraType')).toBe(true);
  });

  it('rejects a missing cameraType', async () => {
    const { cameraType, ...rest } = validPayload;
    const dto = plainToInstance(CreateCameraDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cameraType')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- create-camera.dto.spec.ts`
Expected: FAIL — `Cannot find module './create-camera.dto'`

- [ ] **Step 3: Write `create-camera.dto.ts`**

Create `src/camera-registry/dto/create-camera.dto.ts`:

```typescript
import {
  IsDateString,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

const CAMERA_TYPES = ['analog', 'ip'] as const;

export class CreateCameraDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsUUID()
  departmentId!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsIn(CAMERA_TYPES)
  cameraType!: (typeof CAMERA_TYPES)[number];

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  addressText?: string;

  @IsOptional()
  @IsDateString()
  installedAt?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- create-camera.dto.spec.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Write the failing test for `UpdateCameraDto`**

Create `src/camera-registry/dto/update-camera.dto.spec.ts`:

```typescript
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCameraDto } from './update-camera.dto';

describe('UpdateCameraDto', () => {
  it('accepts an empty payload (no fields changed)', async () => {
    const dto = plainToInstance(UpdateCameraDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts updating just the name', async () => {
    const dto = plainToInstance(UpdateCameraDto, { name: 'Renamed Camera' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts updating both latitude and longitude together', async () => {
    const dto = plainToInstance(UpdateCameraDto, { latitude: 23.03, longitude: 72.58 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects latitude provided without longitude', async () => {
    const dto = plainToInstance(UpdateCameraDto, { latitude: 23.03 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'longitude')).toBe(true);
  });

  it('rejects longitude provided without latitude', async () => {
    const dto = plainToInstance(UpdateCameraDto, { longitude: 72.58 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('rejects an out-of-range latitude even when longitude is present', async () => {
    const dto = plainToInstance(UpdateCameraDto, { latitude: 999, longitude: 72.58 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('rejects an invalid cameraType', async () => {
    const dto = plainToInstance(UpdateCameraDto, { cameraType: 'drone' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cameraType')).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- update-camera.dto.spec.ts`
Expected: FAIL — `Cannot find module './update-camera.dto'`

- [ ] **Step 7: Write `update-camera.dto.ts`**

Create `src/camera-registry/dto/update-camera.dto.ts`:

```typescript
import {
  IsDateString,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

const CAMERA_TYPES = ['analog', 'ip'] as const;

export class UpdateCameraDto {
  @IsOptional()
  @IsString()
  name?: string;

  // A lone latitude or longitude is meaningless — there's no way to know
  // which axis to leave unchanged. If either is present, the other becomes
  // required, so a camera's location only ever moves as a complete pair.
  @ValidateIf((dto) => dto.longitude !== undefined)
  @IsLatitude()
  latitude?: number;

  @ValidateIf((dto) => dto.latitude !== undefined)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsIn(CAMERA_TYPES)
  cameraType?: (typeof CAMERA_TYPES)[number];

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  addressText?: string;

  @IsOptional()
  @IsDateString()
  installedAt?: string;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- update-camera.dto.spec.ts`
Expected: PASS, all 7 tests green.

- [ ] **Step 9: Write the failing test for `CameraQueryDto`**

Create `src/camera-registry/dto/camera-query.dto.spec.ts`:

```typescript
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CameraQueryDto } from './camera-query.dto';

describe('CameraQueryDto', () => {
  it('defaults page/limit from PaginationDto and leaves filters undefined', async () => {
    const dto = plainToInstance(CameraQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(25);
    expect(dto.isActive).toBeUndefined();
  });

  it('accepts a full set of valid filters', async () => {
    const dto = plainToInstance(CameraQueryDto, {
      departmentId: '706b50a5-b637-4d7b-8a0a-d63ed164f598',
      cameraType: 'ip',
      integrationScore: 'easy',
      currentStatus: 'online',
      isActive: 'true',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.isActive).toBe(true);
  });

  it('parses isActive=false correctly, not as a truthy string', async () => {
    const dto = plainToInstance(CameraQueryDto, { isActive: 'false' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.isActive).toBe(false);
  });

  it('rejects an invalid cameraType filter', async () => {
    const dto = plainToInstance(CameraQueryDto, { cameraType: 'drone' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cameraType')).toBe(true);
  });

  it('rejects an invalid integrationScore filter', async () => {
    const dto = plainToInstance(CameraQueryDto, { integrationScore: 'impossible' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'integrationScore')).toBe(true);
  });

  it('rejects an invalid currentStatus filter', async () => {
    const dto = plainToInstance(CameraQueryDto, { currentStatus: 'sleeping' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'currentStatus')).toBe(true);
  });

  it('rejects a non-UUID departmentId filter', async () => {
    const dto = plainToInstance(CameraQueryDto, { departmentId: 'nope' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'departmentId')).toBe(true);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npm test -- camera-query.dto.spec.ts`
Expected: FAIL — `Cannot find module './camera-query.dto'`

- [ ] **Step 11: Write `camera-query.dto.ts`**

Create `src/camera-registry/dto/camera-query.dto.ts`:

```typescript
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const CAMERA_TYPES = ['analog', 'ip'] as const;
const INTEGRATION_SCORES = ['easy', 'medium', 'hard', 'needs_verification'] as const;
const CURRENT_STATUSES = ['online', 'offline', 'unknown'] as const;

export class CameraQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsIn(CAMERA_TYPES)
  cameraType?: (typeof CAMERA_TYPES)[number];

  @IsOptional()
  @IsIn(INTEGRATION_SCORES)
  integrationScore?: (typeof INTEGRATION_SCORES)[number];

  @IsOptional()
  @IsIn(CURRENT_STATUSES)
  currentStatus?: (typeof CURRENT_STATUSES)[number];

  // No default — omitted means both active and inactive cameras are
  // returned. Explicit true/false narrows to exactly that subset.
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npm test -- camera-query.dto.spec.ts`
Expected: PASS, all 7 tests green.

- [ ] **Step 13: Stop — do not commit**

---

## Task 2: Service — Create and the Shared Read Helper

**Files:**
- Create: `src/camera-registry/camera-registry.service.ts`
- Create: `src/camera-registry/camera-registry.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`src/prisma/prisma.service.ts`), `AuditContextService` (`src/common/context/audit-context.service.ts`), `AuthenticatedUser`/`applyDeptScope` (`src/common/scoping/dept-scope.helper.ts`), `CreateCameraDto` (Task 1).
- Produces: `CameraRegistryService` class with `createCamera(dto: CreateCameraDto, createdBy: string): Promise<CameraRecord>`. Also produces the `CameraRecord` interface (the shape returned by every read: all camera columns in camelCase, plus `latitude`/`longitude` as numbers) and a private `findCameraRow(cameraId: string): Promise<CameraRecord | null>` helper — Task 4/5/6 will call this same helper for get-one, update's before-read, and are told its exact signature here so they don't redefine it.

This task establishes the file and its first method; Tasks 4-7 add List, Get One, Update, Soft-Delete to the same class.

- [ ] **Step 1: Write the failing test**

Create `src/camera-registry/camera-registry.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CameraRegistryService } from './camera-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';

describe('CameraRegistryService', () => {
  let service: CameraRegistryService;
  let prisma: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
  let auditContext: { setChanges: jest.Mock };

  const fakeCreatedRow = {
    camera_id: 'cam-1',
    department_id: 'dept-1',
    name: 'Main Gate Camera',
    address_text: null,
    camera_type: 'ip',
    brand: null,
    model: null,
    onvif_status: 'unknown',
    onvif_source: null,
    integration_score: 'needs_verification',
    data_confidence: 'self_reported',
    photo_url: null,
    current_status: 'unknown',
    installed_at: null,
    is_active: true,
    created_by: 'user-1',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    longitude: 72.5714,
    latitude: 23.0225,
  };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
    auditContext = { setChanges: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CameraRegistryService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditContextService, useValue: auditContext },
      ],
    }).compile();

    service = module.get(CameraRegistryService);
  });

  describe('createCamera', () => {
    const dto = {
      name: 'Main Gate Camera',
      departmentId: 'dept-1',
      latitude: 23.0225,
      longitude: 72.5714,
      cameraType: 'ip' as const,
    };

    it('runs an INSERT then a SELECT, and returns the mapped camelCase record', async () => {
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.$queryRaw.mockResolvedValue([fakeCreatedRow]);

      const result = await service.createCamera(dto, 'user-1');

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        cameraId: 'cam-1',
        departmentId: 'dept-1',
        name: 'Main Gate Camera',
        addressText: null,
        cameraType: 'ip',
        brand: null,
        model: null,
        onvifStatus: 'unknown',
        onvifSource: null,
        integrationScore: 'needs_verification',
        dataConfidence: 'self_reported',
        photoUrl: null,
        currentStatus: 'unknown',
        installedAt: null,
        isActive: true,
        createdBy: 'user-1',
        createdAt: fakeCreatedRow.created_at,
        updatedAt: fakeCreatedRow.updated_at,
        longitude: 72.5714,
        latitude: 23.0225,
      });
    });

    it('translates a departmentId foreign-key violation into a BadRequestException', async () => {
      const fkError = Object.assign(new Error('insert or update on table "camera" violates foreign key constraint "camera_department_id_fkey"'), {
        code: 'P2010',
        meta: { code: '23503', message: 'insert or update on table "camera" violates foreign key constraint "camera_department_id_fkey"' },
      });
      prisma.$executeRaw.mockRejectedValue(fkError);

      await expect(service.createCamera(dto, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('does not call auditContext.setChanges on create (only update/delete record before/after)', async () => {
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.$queryRaw.mockResolvedValue([fakeCreatedRow]);

      await service.createCamera(dto, 'user-1');

      expect(auditContext.setChanges).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: FAIL — `Cannot find module './camera-registry.service'`

- [ ] **Step 3: Write `camera-registry.service.ts`**

Create `src/camera-registry/camera-registry.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';
import { CreateCameraDto } from './dto/create-camera.dto';

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
  };
}

// Shared by createCamera's return, listCameras, getCameraById, and
// updateCamera's before-read — the identical column list every read needs,
// centralized here instead of duplicated four times.
const CAMERA_SELECT_SQL = `
  SELECT
    camera_id, department_id, name, address_text, camera_type, brand, model,
    onvif_status, onvif_source, integration_score, data_confidence, photo_url,
    current_status, installed_at, is_active, created_by, created_at, updated_at,
    ST_X(location_geo::geometry) AS longitude,
    ST_Y(location_geo::geometry) AS latitude
  FROM camera
`;

@Injectable()
export class CameraRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContextService,
  ) {}

  async createCamera(dto: CreateCameraDto, createdBy: string): Promise<CameraRecord> {
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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Stop — do not commit**

---

## Task 3: Module and Controller — Create Endpoint

**Files:**
- Create: `src/camera-registry/camera-registry.module.ts`
- Create: `src/camera-registry/camera-registry.controller.ts`
- Create: `src/camera-registry/camera-registry.controller.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `CameraRegistryService.createCamera(dto, createdBy)` (Task 2), `@Roles()` (`src/common/decorators/roles.decorator.ts`), `@Audit()` (`src/common/decorators/audit.decorator.ts`), `@CurrentUser()` (`src/common/decorators/current-user.decorator.ts`), `AuthenticatedUser` (`src/common/scoping/dept-scope.helper.ts`), `CreateCameraDto` (Task 1).
- Produces: `POST /cameras` → 201, full `CameraRecord`. `CameraRegistryModule`, imported into `AppModule`.

- [ ] **Step 1: Write the failing test**

Create `src/camera-registry/camera-registry.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CameraRegistryController } from './camera-registry.controller';
import { CameraRegistryService } from './camera-registry.service';
import { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

describe('CameraRegistryController', () => {
  let controller: CameraRegistryController;
  let service: { createCamera: jest.Mock };

  const currentUser: AuthenticatedUser = {
    userId: 'user-1',
    role: 'admin',
    departmentId: null,
  };

  beforeEach(async () => {
    service = { createCamera: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CameraRegistryController],
      providers: [{ provide: CameraRegistryService, useValue: service }],
    }).compile();

    controller = module.get(CameraRegistryController);
  });

  it('create delegates to CameraRegistryService.createCamera with the dto and current user id', async () => {
    const dto = {
      name: 'Main Gate Camera',
      departmentId: 'dept-1',
      latitude: 23.0225,
      longitude: 72.5714,
      cameraType: 'ip' as const,
    };
    const createdCamera = { cameraId: 'cam-1', ...dto };
    service.createCamera.mockResolvedValue(createdCamera);

    const result = await controller.create(dto, currentUser);

    expect(service.createCamera).toHaveBeenCalledWith(dto, 'user-1');
    expect(result).toEqual(createdCamera);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: FAIL — `Cannot find module './camera-registry.controller'`

- [ ] **Step 3: Write `camera-registry.controller.ts`**

Create `src/camera-registry/camera-registry.controller.ts`:

```typescript
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CameraRegistryService } from './camera-registry.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

@Controller('cameras')
export class CameraRegistryController {
  constructor(private readonly cameraRegistryService: CameraRegistryService) {}

  @Roles('admin', 'field_officer')
  @Audit('create_camera', 'camera')
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async create(@Body() dto: CreateCameraDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.cameraRegistryService.createCamera(dto, currentUser.userId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: PASS, 1 test green.

- [ ] **Step 5: Write `camera-registry.module.ts`**

Create `src/camera-registry/camera-registry.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { CameraRegistryController } from './camera-registry.controller';
import { CameraRegistryService } from './camera-registry.service';
import { AuditContextModule } from '../common/context/audit-context.module';

@Module({
  imports: [AuditContextModule],
  controllers: [CameraRegistryController],
  providers: [CameraRegistryService],
  exports: [CameraRegistryService],
})
export class CameraRegistryModule {}
```

- [ ] **Step 6: Wire `CameraRegistryModule` into `app.module.ts`**

Modify `src/app.module.ts` — add the import:

```typescript
import { CameraRegistryModule } from './camera-registry/camera-registry.module';
```

And add `CameraRegistryModule` to the `imports` array, after `AuthModule`.

- [ ] **Step 7: Manually verify the create endpoint against the real database**

```bash
npm run start:dev
```

In a second terminal, log in as the seeded admin (or a test user created via the pattern established in `test/auth.e2e-spec.ts`), then:

```bash
curl -s -X POST http://localhost:3000/api/v1/cameras \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"name":"Test Camera","departmentId":"<a real department_id from the department table>","latitude":23.0225,"longitude":72.5714,"cameraType":"ip"}'
```

Expected: `201`, a JSON body with `cameraId`, `latitude: 23.0225`, `longitude: 72.5714`, `onvifStatus: "unknown"`, `integrationScore: "needs_verification"`. Verify directly in Postgres:

```bash
PGPASSWORD='Meet@0326' psql -U meet -h localhost -p 5432 -d sentinel_model1_db -c "SELECT camera_id, name, ST_AsText(location_geo) FROM camera WHERE name = 'Test Camera';"
```

Expected: `ST_AsText(location_geo)` shows `POINT(72.5714 23.0225)` — confirming the point was stored correctly (longitude first, then latitude, matching `ST_MakePoint`'s parameter order). Delete this manually-created test camera afterward:

```bash
PGPASSWORD='Meet@0326' psql -U meet -h localhost -p 5432 -d sentinel_model1_db -c "DELETE FROM audit_log WHERE entity_type = 'camera'; DELETE FROM camera WHERE name = 'Test Camera';"
```

Stop the dev server.

- [ ] **Step 8: Stop — do not commit**

---

## Task 4: List Endpoint (Filters, Pagination, Dept Scoping)

**Files:**
- Modify: `src/camera-registry/camera-registry.service.ts`
- Modify: `src/camera-registry/camera-registry.service.spec.ts`
- Modify: `src/camera-registry/camera-registry.controller.ts`
- Modify: `src/camera-registry/camera-registry.controller.spec.ts`

**Interfaces:**
- Consumes: `CameraQueryDto` (Task 1), `applyDeptScope`/`AuthenticatedUser` (`src/common/scoping/dept-scope.helper.ts`), `CAMERA_SELECT_SQL`/`RawCameraRow`/`mapRow`/`CameraRecord`/`Prisma` (already present in the file from Task 2).
- Produces: `CameraRegistryService.listCameras(query: CameraQueryDto, currentUser: AuthenticatedUser): Promise<CameraRecord[]>`. `GET /cameras` → 200, array of `CameraRecord`.

This task adds `listCameras` as a new method — it does not modify `findCameraRow` or anything else from Task 2, which are already correct as written.

- [ ] **Step 1: Write the failing tests**

Add to `src/camera-registry/camera-registry.service.spec.ts`, inside the existing `describe('CameraRegistryService', ...)` block, alongside the existing `describe('createCamera', ...)`:

```typescript
  describe('listCameras', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };
    const deptViewer: AuthenticatedUser = {
      userId: 'user-2',
      role: 'dept_viewer',
      departmentId: 'dept-1',
    };

    const rawRow = {
      camera_id: 'cam-1',
      department_id: 'dept-1',
      name: 'Camera A',
      address_text: null,
      camera_type: 'ip',
      brand: null,
      model: null,
      onvif_status: 'unknown',
      onvif_source: null,
      integration_score: 'needs_verification',
      data_confidence: 'self_reported',
      photo_url: null,
      current_status: 'unknown',
      installed_at: null,
      is_active: true,
      created_by: 'user-1',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
      longitude: 72.5714,
      latitude: 23.0225,
    };

    it('returns all cameras with no filters when isActive is omitted (default 25/page 1)', async () => {
      prisma.$queryRaw.mockResolvedValue([rawRow]);

      const result = await service.listCameras({ page: 1, limit: 25 }, admin);

      expect(result).toHaveLength(1);
      expect(result[0].cameraId).toBe('cam-1');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('scopes the query to the dept_viewer\'s own department, ignoring any departmentId they pass', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras(
        { page: 1, limit: 25, departmentId: 'attacker-dept' },
        deptViewer,
      );

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('dept-1');
      expect(serializedQuery).not.toContain('attacker-dept');
    });

    it('does not scope the query for an admin (no WHERE clause at all when no filters given)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras({ page: 1, limit: 25 }, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      // CAMERA_SELECT_SQL's own column list always contains "department_id"
      // (it's a selected column), so the real signal that no filter was
      // applied is the absence of a WHERE clause entirely, not the column
      // name's absence.
      expect(serializedQuery).not.toContain('WHERE');
    });

    it('applies the isActive=true filter when explicitly requested', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras({ page: 1, limit: 25, isActive: true }, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('is_active');
    });

    it('omits the isActive filter entirely when not provided (no WHERE clause)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras({ page: 1, limit: 25 }, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      // Same reasoning as the admin-scoping test above: "is_active" is
      // always present as a selected column, so check for the absent
      // WHERE clause instead of the column name.
      expect(serializedQuery).not.toContain('WHERE');
    });

    it('applies pagination as LIMIT/OFFSET', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras({ page: 3, limit: 10 }, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('LIMIT');
      expect(serializedQuery).toContain('OFFSET');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: FAIL — `service.listCameras is not a function`

- [ ] **Step 3: Add `listCameras`**

Modify `src/camera-registry/camera-registry.service.ts` — add this new method to the class, after `findCameraRow` (leave `findCameraRow` itself untouched, it's already correct from Task 2):

```typescript
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

    const whereClause =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const offset = (query.page - 1) * query.limit;

    const rows = await this.prisma.$queryRaw<RawCameraRow[]>(
      Prisma.sql`${Prisma.raw(CAMERA_SELECT_SQL)} ${whereClause} ORDER BY created_at DESC LIMIT ${query.limit} OFFSET ${offset}`,
    );

    return rows.map(mapRow);
  }
```

Add the necessary imports at the top of the file:

```typescript
import { CameraQueryDto } from './dto/camera-query.dto';
import { applyDeptScope, AuthenticatedUser } from '../common/scoping/dept-scope.helper';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS, all tests green (3 from Task 2 + 6 new from this task = 9 total).

- [ ] **Step 5: Write the failing controller test**

Add to `src/camera-registry/camera-registry.controller.spec.ts`, inside the existing `describe` block:

```typescript
  it('list delegates to CameraRegistryService.listCameras with the query and current user', async () => {
    const query = { page: 1, limit: 25 } as any;
    const cameras = [{ cameraId: 'cam-1' }];
    service.listCameras = jest.fn().mockResolvedValue(cameras);

    const result = await controller.list(query, currentUser);

    expect(service.listCameras).toHaveBeenCalledWith(query, currentUser);
    expect(result).toEqual(cameras);
  });
```

Also update the `beforeEach` block's `service` object to include `listCameras: jest.fn()` alongside `createCamera: jest.fn()`.

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: FAIL — `controller.list is not a function`

- [ ] **Step 7: Add the `list` endpoint to the controller**

Modify `src/camera-registry/camera-registry.controller.ts` — add the import:

```typescript
import { Get, Query } from '@nestjs/common';
```

(merge into the existing `@nestjs/common` import line rather than adding a duplicate import statement)

Add the import:

```typescript
import { CameraQueryDto } from './dto/camera-query.dto';
```

Add the method to the class:

```typescript
  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get()
  async list(@Query() query: CameraQueryDto, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.cameraRegistryService.listCameras(query, currentUser);
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 9: Manually verify against the real database**

```bash
npm run start:dev
```

Create two test cameras (one via the Task 3 curl pattern, in two different departments if you have more than one seeded), then:

```bash
curl -s http://localhost:3000/api/v1/cameras -H "Authorization: Bearer <accessToken>" | head -c 500
```

Expected: a JSON array containing both cameras, each with correct `latitude`/`longitude`. Test the `isActive` filter behavior:

```bash
curl -s "http://localhost:3000/api/v1/cameras?isActive=true" -H "Authorization: Bearer <accessToken>"
```

Expected: same cameras (both still active). Clean up the test cameras via psql afterward, same as Task 3 Step 7. Stop the dev server.

- [ ] **Step 10: Stop — do not commit**

---

## Task 5: Get-One Endpoint (with 404-not-403 Scoping)

**Files:**
- Modify: `src/camera-registry/camera-registry.service.ts`
- Modify: `src/camera-registry/camera-registry.service.spec.ts`
- Modify: `src/camera-registry/camera-registry.controller.ts`
- Modify: `src/camera-registry/camera-registry.controller.spec.ts`

**Interfaces:**
- Consumes: `findCameraRow` (Task 2/4, same file, made accessible to this method since it's in the same class), `applyDeptScope` (Task 4).
- Produces: `CameraRegistryService.getCameraById(cameraId: string, currentUser: AuthenticatedUser): Promise<CameraRecord>` — throws `NotFoundException` if missing OR out-of-scope. `GET /cameras/:id` → 200 or 404.

- [ ] **Step 1: Write the failing tests**

Add to `src/camera-registry/camera-registry.service.spec.ts`:

```typescript
  describe('getCameraById', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };
    const deptViewer: AuthenticatedUser = {
      userId: 'user-2',
      role: 'dept_viewer',
      departmentId: 'dept-1',
    };

    const rawRow = {
      camera_id: 'cam-1',
      department_id: 'dept-1',
      name: 'Camera A',
      address_text: null,
      camera_type: 'ip',
      brand: null,
      model: null,
      onvif_status: 'unknown',
      onvif_source: null,
      integration_score: 'needs_verification',
      data_confidence: 'self_reported',
      photo_url: null,
      current_status: 'unknown',
      installed_at: null,
      is_active: true,
      created_by: 'user-1',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
      longitude: 72.5714,
      latitude: 23.0225,
    };

    it('returns the camera when found and the caller is not scoped', async () => {
      prisma.$queryRaw.mockResolvedValue([rawRow]);

      const result = await service.getCameraById('cam-1', admin);

      expect(result.cameraId).toBe('cam-1');
    });

    it('returns the camera when found and it belongs to the dept_viewer\'s own department', async () => {
      prisma.$queryRaw.mockResolvedValue([rawRow]);

      const result = await service.getCameraById('cam-1', deptViewer);

      expect(result.cameraId).toBe('cam-1');
    });

    it('throws NotFoundException when the camera does not exist at all', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.getCameraById('nonexistent', admin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException (never a different error) when a dept_viewer requests a camera in a different department', async () => {
      const rowInOtherDept = { ...rawRow, department_id: 'dept-999' };
      prisma.$queryRaw.mockResolvedValue([rowInOtherDept]);

      await expect(service.getCameraById('cam-1', deptViewer)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
```

Add `NotFoundException` to the existing `@nestjs/common` import in the test file's import list.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: FAIL — `service.getCameraById is not a function`

- [ ] **Step 3: Add `getCameraById`**

Modify `src/camera-registry/camera-registry.service.ts` — add this method to the class, after `findCameraRow`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS, all tests green (9 from Tasks 2/4 + 4 new = 13 total).

- [ ] **Step 5: Write the failing controller test**

Add to `src/camera-registry/camera-registry.controller.spec.ts`:

```typescript
  it('getOne delegates to CameraRegistryService.getCameraById with the id and current user', async () => {
    const camera = { cameraId: 'cam-1' };
    service.getCameraById = jest.fn().mockResolvedValue(camera);

    const result = await controller.getOne('cam-1', currentUser);

    expect(service.getCameraById).toHaveBeenCalledWith('cam-1', currentUser);
    expect(result).toEqual(camera);
  });
```

Add `getCameraById: jest.fn()` to the `beforeEach` block's `service` object.

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: FAIL — `controller.getOne is not a function`

- [ ] **Step 7: Add the `getOne` endpoint**

Modify `src/camera-registry/camera-registry.controller.ts` — add `Param` to the existing `@nestjs/common` import line, then add the method:

```typescript
  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser() currentUser: AuthenticatedUser) {
    return this.cameraRegistryService.getCameraById(id, currentUser);
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 9: Stop — do not commit**

---

## Task 6: Update Endpoint (Field + Location Changes, Before/After Audit)

**Files:**
- Modify: `src/camera-registry/camera-registry.service.ts`
- Modify: `src/camera-registry/camera-registry.service.spec.ts`
- Modify: `src/camera-registry/camera-registry.controller.ts`
- Modify: `src/camera-registry/camera-registry.controller.spec.ts`

**Interfaces:**
- Consumes: `getCameraById` (Task 5, reused for the before-read and scoping check), `UpdateCameraDto` (Task 1), `AuditContextService.setChanges(request, before, after)` (existing, `src/common/context/audit-context.service.ts`).
- Produces: `CameraRegistryService.updateCamera(request: Request, cameraId: string, dto: UpdateCameraDto, currentUser: AuthenticatedUser): Promise<CameraRecord>`. `PATCH /cameras/:id` → 200 or 404.

- [ ] **Step 1: Write the failing tests**

Add to `src/camera-registry/camera-registry.service.spec.ts` — first add this import at the top:

```typescript
import { Request } from 'express';
```

Then add:

```typescript
  describe('updateCamera', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };
    const fakeRequest = {} as Request;

    const existingRow = {
      camera_id: 'cam-1',
      department_id: 'dept-1',
      name: 'Old Name',
      address_text: null,
      camera_type: 'ip',
      brand: null,
      model: null,
      onvif_status: 'unknown',
      onvif_source: null,
      integration_score: 'needs_verification',
      data_confidence: 'self_reported',
      photo_url: null,
      current_status: 'unknown',
      installed_at: null,
      is_active: true,
      created_by: 'user-1',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
      longitude: 72.5714,
      latitude: 23.0225,
    };

    it('updates a plain field, leaving location untouched, and records before/after', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([existingRow]) // before-read via getCameraById
        .mockResolvedValueOnce([{ ...existingRow, name: 'New Name' }]); // after-read
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.updateCamera(fakeRequest, 'cam-1', { name: 'New Name' }, admin);

      expect(result.name).toBe('New Name');
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        { name: 'Old Name' },
        { name: 'New Name' },
      );
    });

    it('updates location when both latitude and longitude are provided', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([existingRow])
        .mockResolvedValueOnce([{ ...existingRow, latitude: 24.0, longitude: 73.0 }]);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.updateCamera(
        fakeRequest,
        'cam-1',
        { latitude: 24.0, longitude: 73.0 },
        admin,
      );

      const [sqlFragment] = prisma.$executeRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('location_geo');
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        { latitude: 23.0225, longitude: 72.5714 },
        { latitude: 24.0, longitude: 73.0 },
      );
    });

    it('does not touch location_geo in the SQL when no coordinates are provided', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([existingRow])
        .mockResolvedValueOnce([{ ...existingRow, name: 'New Name' }]);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.updateCamera(fakeRequest, 'cam-1', { name: 'New Name' }, admin);

      const [sqlFragment] = prisma.$executeRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).not.toContain('location_geo');
    });

    it('does not call setChanges when the update contains no actual field changes', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([existingRow])
        .mockResolvedValueOnce([existingRow]);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.updateCamera(fakeRequest, 'cam-1', { name: 'Old Name' }, admin);

      expect(auditContext.setChanges).not.toHaveBeenCalled();
    });

    it('throws NotFoundException before attempting any write when the camera does not exist', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.updateCamera(fakeRequest, 'nonexistent', { name: 'New Name' }, admin),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: FAIL — `service.updateCamera is not a function`

- [ ] **Step 3: Add `updateCamera`**

Modify `src/camera-registry/camera-registry.service.ts` — add the import:

```typescript
import { Request } from 'express';
import { UpdateCameraDto } from './dto/update-camera.dto';
```

Add this method to the class, after `getCameraById`:

```typescript
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

    const setClauses: Prisma.Sql[] = [];
    const before: Record<string, string | number | boolean | null> = {};
    const after: Record<string, string | number | boolean | null> = {};

    const plainFieldMap: Array<[keyof UpdateCameraDto, string]> = [
      ['name', 'name'],
      ['cameraType', 'camera_type'],
      ['brand', 'brand'],
      ['model', 'model'],
      ['addressText', 'address_text'],
    ];

    for (const [dtoKey, column] of plainFieldMap) {
      const newValue = dto[dtoKey];
      if (newValue === undefined) continue;
      // CameraRecord's field names are identical to UpdateCameraDto's
      // (both camelCase: name, cameraType, brand, model, addressText) —
      // dtoKey indexes both structures directly, no remapping needed.
      const oldValue = existing[dtoKey] as string | null;
      if (oldValue === newValue) continue;
      setClauses.push(Prisma.sql`${Prisma.raw(column)} = ${newValue}`);
      before[dtoKey] = oldValue;
      after[dtoKey] = newValue;
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
      return existing;
    }

    setClauses.push(Prisma.sql`updated_at = now()`);

    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE camera SET ${Prisma.join(setClauses, ', ')} WHERE camera_id = ${cameraId}::uuid`,
    );

    this.auditContext.setChanges(request, before, after);

    const updated = await this.findCameraRow(cameraId);
    if (!updated) {
      throw new Error(`Camera ${cameraId} was updated but could not be re-read`);
    }
    return updated;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS, all tests green (13 from Tasks 2/4/5 + 5 new = 18 total).

- [ ] **Step 5: Write the failing controller test**

Add to `src/camera-registry/camera-registry.controller.spec.ts` — add this import at the top:

```typescript
import { Request } from 'express';
```

Then add:

```typescript
  it('update delegates to CameraRegistryService.updateCamera with the request, id, dto, and current user', async () => {
    const fakeRequest = {} as Request;
    const dto = { name: 'New Name' };
    const updatedCamera = { cameraId: 'cam-1', name: 'New Name' };
    service.updateCamera = jest.fn().mockResolvedValue(updatedCamera);

    const result = await controller.update(fakeRequest, 'cam-1', dto, currentUser);

    expect(service.updateCamera).toHaveBeenCalledWith(fakeRequest, 'cam-1', dto, currentUser);
    expect(result).toEqual(updatedCamera);
  });
```

Add `updateCamera: jest.fn()` to the `beforeEach` block's `service` object.

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: FAIL — `controller.update is not a function`

- [ ] **Step 7: Add the `update` endpoint**

Modify `src/camera-registry/camera-registry.controller.ts` — add `Patch`, `Req` to the existing `@nestjs/common` import line, add `import type { Request } from 'express';` and `import { UpdateCameraDto } from './dto/update-camera.dto';`, then add the method:

```typescript
  @Roles('admin', 'field_officer')
  @Audit('update_camera', 'camera')
  @Patch(':id')
  async update(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() dto: UpdateCameraDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.cameraRegistryService.updateCamera(request, id, dto, currentUser);
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 9: Stop — do not commit**

---

## Task 7: Soft-Delete Endpoint

**Files:**
- Modify: `src/camera-registry/camera-registry.service.ts`
- Modify: `src/camera-registry/camera-registry.service.spec.ts`
- Modify: `src/camera-registry/camera-registry.controller.ts`
- Modify: `src/camera-registry/camera-registry.controller.spec.ts`

**Interfaces:**
- Consumes: `getCameraById` (Task 5, for the existence/scoping check), `AuditContextService.setChanges` (existing).
- Produces: `CameraRegistryService.softDeleteCamera(request: Request, cameraId: string, currentUser: AuthenticatedUser): Promise<void>`. `DELETE /cameras/:id` → 204.

- [ ] **Step 1: Write the failing tests**

Add to `src/camera-registry/camera-registry.service.spec.ts`:

```typescript
  describe('softDeleteCamera', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };
    const fakeRequest = {} as Request;

    const activeRow = {
      camera_id: 'cam-1',
      department_id: 'dept-1',
      name: 'Camera A',
      address_text: null,
      camera_type: 'ip',
      brand: null,
      model: null,
      onvif_status: 'unknown',
      onvif_source: null,
      integration_score: 'needs_verification',
      data_confidence: 'self_reported',
      photo_url: null,
      current_status: 'unknown',
      installed_at: null,
      is_active: true,
      created_by: 'user-1',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
      longitude: 72.5714,
      latitude: 23.0225,
    };

    it('sets isActive to false via a plain Prisma update and records before/after', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([activeRow]);
      (prisma as any).camera = { update: jest.fn().mockResolvedValue({}) };

      await service.softDeleteCamera(fakeRequest, 'cam-1', admin);

      expect((prisma as any).camera.update).toHaveBeenCalledWith({
        where: { cameraId: 'cam-1' },
        data: { isActive: false },
      });
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        { isActive: true },
        { isActive: false },
      );
    });

    it('throws NotFoundException and writes nothing when the camera does not exist', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      (prisma as any).camera = { update: jest.fn() };

      await expect(service.softDeleteCamera(fakeRequest, 'nonexistent', admin)).rejects.toThrow(
        NotFoundException,
      );
      expect((prisma as any).camera.update).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: FAIL — `service.softDeleteCamera is not a function`

- [ ] **Step 3: Add `softDeleteCamera`**

Modify `src/camera-registry/camera-registry.service.ts` — add this method to the class, after `updateCamera`:

```typescript
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

    this.auditContext.setChanges(request, { isActive: true }, { isActive: false });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS, all tests green (18 from prior tasks + 2 new = 20 total).

- [ ] **Step 5: Write the failing controller test**

Add to `src/camera-registry/camera-registry.controller.spec.ts`:

```typescript
  it('remove delegates to CameraRegistryService.softDeleteCamera with the request, id, and current user', async () => {
    const fakeRequest = {} as Request;
    service.softDeleteCamera = jest.fn().mockResolvedValue(undefined);

    await controller.remove(fakeRequest, 'cam-1', currentUser);

    expect(service.softDeleteCamera).toHaveBeenCalledWith(fakeRequest, 'cam-1', currentUser);
  });
```

Add `softDeleteCamera: jest.fn()` to the `beforeEach` block's `service` object.

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: FAIL — `controller.remove is not a function`

- [ ] **Step 7: Add the `remove` endpoint**

Modify `src/camera-registry/camera-registry.controller.ts` — add `Delete` to the existing `@nestjs/common` import line, then add the method:

```typescript
  @Roles('admin')
  @Audit('delete_camera', 'camera')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(
    @Req() request: Request,
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.cameraRegistryService.softDeleteCamera(request, id, currentUser);
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 9: Stop — do not commit**

---

## Task 8: End-to-End Test — Full Lifecycle and Department Isolation

**Files:**
- Create: `test/camera-registry.e2e-spec.ts`

**Interfaces:**
- Consumes: the full `camera-registry` module (Tasks 2-7), the existing `test/auth.e2e-spec.ts` pattern for creating test users and logging in.

- [ ] **Step 1: Write the e2e test**

Create `test/camera-registry.e2e-spec.ts`. First, find a real department to test against — this test needs at least two distinct `department_id` values from the live `department` table (seeded by `model1_fresh_setup.sql`), so it can prove cross-department isolation. Read the two department codes/IDs first:

```bash
PGPASSWORD='Meet@0326' psql -U meet -h localhost -p 5432 -d sentinel_model1_db -c "SELECT department_id, code FROM department ORDER BY code LIMIT 2;"
```

Use those two real `department_id` values in the test below (do not hardcode fake UUIDs — the `departmentId` foreign key must resolve to real rows).

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Camera Registry (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-camera-admin@sentinel.local';
  const deptAViewerEmail = 'e2e-camera-deptA-viewer@sentinel.local';

  // Replace these two with real department_id values from your database —
  // see this task's Step 1 instructions for the psql query to run first.
  const DEPARTMENT_A_ID = 'REPLACE_WITH_REAL_DEPARTMENT_ID_A';
  const DEPARTMENT_B_ID = 'REPLACE_WITH_REAL_DEPARTMENT_ID_B';

  let adminToken: string;
  let deptAViewerToken: string;
  let createdCameraIdInDeptB: string;

  async function cleanup() {
    const users = await prisma.appUser.findMany({
      where: { email: { in: [adminEmail, deptAViewerEmail] } },
    });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Test Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, deptAViewerEmail] } } });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    await cleanup();

    await prisma.appUser.create({
      data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 10), role: 'admin' },
    });
    await prisma.appUser.create({
      data: {
        email: deptAViewerEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'dept_viewer',
        departmentId: DEPARTMENT_A_ID,
      },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;

    const deptAViewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: deptAViewerEmail, password });
    deptAViewerToken = deptAViewerLogin.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('completes the full create -> list -> get -> update -> soft-delete lifecycle', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Test Camera Lifecycle',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0225,
        longitude: 72.5714,
        cameraType: 'ip',
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.latitude).toBe(23.0225);
    expect(createResponse.body.longitude).toBe(72.5714);
    expect(createResponse.body.integrationScore).toBe('needs_verification');
    const cameraId = createResponse.body.cameraId;

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((c: any) => c.cameraId === cameraId)).toBe(true);

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.name).toBe('E2E Test Camera Lifecycle');

    const updateResponse = await request(app.getHttpServer())
      .patch(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'E2E Test Camera Renamed', latitude: 24.0, longitude: 73.0 });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.name).toBe('E2E Test Camera Renamed');
    expect(updateResponse.body.latitude).toBe(24.0);
    expect(updateResponse.body.longitude).toBe(73.0);

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'update_camera', entityType: 'camera' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow!.metadata).toMatchObject({
      before: { name: 'E2E Test Camera Lifecycle' },
      after: { name: 'E2E Test Camera Renamed' },
    });

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteResponse.status).toBe(204);

    const listAfterDeleteActiveOnly = await request(app.getHttpServer())
      .get('/api/v1/cameras?isActive=true')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAfterDeleteActiveOnly.body.some((c: any) => c.cameraId === cameraId)).toBe(false);

    const listAfterDeleteUnfiltered = await request(app.getHttpServer())
      .get('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`);
    const deletedCamera = listAfterDeleteUnfiltered.body.find((c: any) => c.cameraId === cameraId);
    expect(deletedCamera).toBeDefined();
    expect(deletedCamera.isActive).toBe(false);
  });

  it('prevents a dept_viewer from seeing or fetching a camera in a different department', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Test Camera Dept B Only',
        departmentId: DEPARTMENT_B_ID,
        latitude: 22.0,
        longitude: 71.0,
        cameraType: 'analog',
      });
    expect(createResponse.status).toBe(201);
    createdCameraIdInDeptB = createResponse.body.cameraId;

    const listAsDeptAViewer = await request(app.getHttpServer())
      .get('/api/v1/cameras')
      .set('Authorization', `Bearer ${deptAViewerToken}`);
    expect(listAsDeptAViewer.status).toBe(200);
    expect(
      listAsDeptAViewer.body.some((c: any) => c.cameraId === createdCameraIdInDeptB),
    ).toBe(false);

    const getAsDeptAViewer = await request(app.getHttpServer())
      .get(`/api/v1/cameras/${createdCameraIdInDeptB}`)
      .set('Authorization', `Bearer ${deptAViewerToken}`);
    expect(getAsDeptAViewer.status).toBe(404);

    const updateAsDeptAViewer = await request(app.getHttpServer())
      .patch(`/api/v1/cameras/${createdCameraIdInDeptB}`)
      .set('Authorization', `Bearer ${deptAViewerToken}`)
      .send({ name: 'Attempted Hijack' });
    // dept_viewer isn't in the PATCH allowlist (admin, field_officer only)
    // — RolesGuard rejects before the service's own 404 scoping ever runs.
    expect(updateAsDeptAViewer.status).toBe(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/cameras/${createdCameraIdInDeptB}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });

  it('rejects camera creation for a non-admin/field_officer role', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${deptAViewerToken}`)
      .send({
        name: 'E2E Test Camera Should Not Be Created',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });

    expect(response.status).toBe(403);
  });

  it('rejects a departmentId that does not correspond to a real department', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Test Camera Bad Department',
        departmentId: '00000000-0000-0000-0000-000000000000',
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Fill in the real department IDs**

Before running, replace `DEPARTMENT_A_ID` and `DEPARTMENT_B_ID`'s placeholder strings with the two real `department_id` UUIDs from the psql query in Step 1.

- [ ] **Step 3: Run the e2e test**

Run: `npm run test:e2e -- camera-registry.e2e-spec.ts`
Expected: PASS, all 4 tests green. This is a real integration test against the live database — if any test fails, check that `DEPARTMENT_A_ID`/`DEPARTMENT_B_ID` are genuinely different real department IDs, not placeholders left unfilled.

- [ ] **Step 4: Stop — do not commit**

---

## Final Task: Full Regression Pass

**Files:** none created — verification only

- [ ] **Step 1: Run the entire unit test suite**

```bash
cd model1-service
npm test
```

Expected: every suite from this module (DTOs, service, controller) plus every suite from Phase 1-4 passes. Expected total: the Phase 1-4 baseline (17 suites / 68 tests, per the prior plan's final state) plus this module's new suites — 3 DTO spec files, 1 service spec file, 1 controller spec file = 5 new suites, roughly 45-55 new test cases across Tasks 1-7's step counts.

- [ ] **Step 2: Run the entire e2e test suite**

```bash
npm run test:e2e
```

Expected: the Phase 1-4 baseline (5 suites / 13 tests) plus `camera-registry.e2e-spec.ts` (4 tests) — all green.

- [ ] **Step 3: Run the TypeScript compiler**

```bash
npx tsc --noEmit -p tsconfig.build.json
```

Expected: zero errors. This step has caught real bugs jest's per-file compilation missed in every prior plan — do not skip it.

- [ ] **Step 4: Manually verify PostGIS storage is correct end-to-end**

```bash
npm run start:dev
```

Create a camera via curl (same pattern as Task 3 Step 7) with a known, distinctive latitude/longitude, then confirm directly in Postgres:

```bash
PGPASSWORD='Meet@0326' psql -U meet -h localhost -p 5432 -d sentinel_model1_db -c "SELECT name, ST_X(location_geo::geometry) AS longitude, ST_Y(location_geo::geometry) AS latitude FROM camera WHERE name = '<the test camera name>';"
```

Expected: the stored `longitude`/`latitude` match exactly what was sent in the create request. Clean up the test camera (and its audit_log rows) afterward. Stop the dev server.

- [ ] **Step 5: Stop — do not commit. Report completion to the user.**

Summarize: what was built (5 endpoints, PostGIS spatial handling, dept_viewer scoping, audit before/after), what passed (exact test counts from Steps 1-2), and confirm the module is ready to serve as the reused foundation when bulk upload (a follow-up design) is built on top of `createCamera`.
