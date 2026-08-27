# Camera Bulk Upload & CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT CONSTRAINT — READ BEFORE STARTING:** Never run `git init`, `git add`, or `git commit`. The user manages all version control themselves. Every task ends with "stop — do not commit" instead of a commit step.
>
> **VERIFICATION STYLE — READ BEFORE STARTING:** No separate report/brief markdown files per task. Implement each task's code, run the real test/verify commands for what that task touched, report results inline. Don't re-run the entire suite after every small task — scope tests to what changed. One full regression pass (`npm test` + `npm run test:e2e` + `npx tsc --noEmit`) at the very end (the Final Task).

**Goal:** Add background-job-based CSV bulk upload (handles up to ~10,000 rows without blocking the server) and synchronous CSV export to the `camera-registry` module, completing FR-1.

**Architecture:** A new `bulk_upload_job` table tracks job state (Postgres as the durability layer — no external queue). `POST /cameras/bulk` does fast structural validation, creates a job row, returns `202` immediately, then processes rows in batches of 50 (bounded concurrency 5) via `setImmediate`-yielding background work in the same Node process. Row-level create/update logic is factored out of the existing `CameraRegistryService` so both the single-camera HTTP endpoints and the bulk job's background rows share identical data-mutation code, while audit-log writing is extracted into one shared function (`writeAuditLogEntry`) callable both from the existing request-scoped interceptor and directly from the job.

**Tech Stack:** `csv-parse` (streaming upload parsing), `csv-stringify` (export), `@nestjs/platform-express`'s `FileInterceptor`/`multer` (multipart upload), Prisma (new `bulk_upload_job` table via `prisma migrate dev`).

**Spec:** `../specs/2026-08-26-camera-bulk-upload-export-design.md`

## Global Constraints

- Never run `git init`/`git add`/`git commit`.
- `.csv` only for v1 — no `.xlsx`/Excel parsing.
- No external queue (Redis/BullMQ) — Postgres (`bulk_upload_job` table) is the only durability layer. A server restart mid-job is not auto-recovered in v1 — an accepted limitation, not a bug to fix here.
- Bulk upload CSV columns, exactly: `name, departmentCode, latitude, longitude, cameraType, brand, model, addressText, installedAt` — `departmentCode` (e.g. `HOME`), not a raw `departmentId` UUID.
- Bulk upload upserts on `(department_id, name)` — matching camera creates or updates only the fields present in that CSV row; a no-op update (identical fields) writes no audit entry.
- Row numbers in error reporting are 1-indexed counting the header as row 1, so they match what a human sees opening the CSV in a spreadsheet.
- `POST /cameras/bulk`: `admin`, `field_officer`, throttled 5 req/min (same tier as login, per PRD Section 6a point 9).
- `GET /cameras/bulk/:jobId`: `admin`, `field_officer`, not scoped to job creator.
- `GET /cameras/export`: `admin`, `auditor` — the one endpoint in this module without `field_officer`.
- Audit entries from bulk-upload rows must be indistinguishable in shape from single-camera endpoint audit entries — same `action`/`entityType`/before-after structure — via one shared `writeAuditLogEntry` function used by both the existing interceptor and the new bulk job.
- No new database migration beyond `bulk_upload_job` — every other column already exists.

---

## File Structure

```
prisma/
└── schema.prisma                          # add BulkUploadJob model (Task 1)

src/
├── common/
│   └── audit/
│       ├── write-audit-log-entry.ts       # extracted shared audit-write function (Task 2)
│       └── write-audit-log-entry.spec.ts
├── camera-registry/
│   ├── camera-registry.service.ts         # add applyCameraFieldChanges (Task 3), bulk job processing (Task 6)
│   ├── camera-registry.service.spec.ts
│   ├── camera-registry.controller.ts      # add bulk upload, job status, export endpoints (Tasks 5, 7, 9)
│   ├── camera-registry.controller.spec.ts
│   ├── bulk-upload/
│   │   ├── bulk-upload.service.ts         # job lifecycle: create job, kick off background processing (Task 6)
│   │   ├── bulk-upload.service.spec.ts
│   │   ├── csv-parser.service.ts          # structural validation + row parsing (Task 4)
│   │   ├── csv-parser.service.spec.ts
│   │   ├── department-lookup.service.ts   # cached code→id map (Task 4)
│   │   └── department-lookup.service.spec.ts
│   ├── export/
│   │   ├── camera-export.service.ts       # CSV generation from filtered camera rows (Task 8)
│   │   └── camera-export.service.spec.ts
│   └── dto/
│       └── bulk-upload-row.dto.ts         # per-row validation DTO (Task 4)

test/
├── camera-bulk-upload.e2e-spec.ts         # Task 10
└── camera-export.e2e-spec.ts              # Task 10
```

**Why this shape:** `bulk-upload/` and `export/` get their own subdirectories under `camera-registry/` rather than growing `camera-registry.service.ts` into an unwieldy file — CSV parsing, department lookup, and job orchestration are each a distinct responsibility. `write-audit-log-entry.ts` lives in `common/audit/` (a new small module) since both `AuditLogInterceptor` (already in `common/`) and the bulk job (in `camera-registry/`) need it — putting it under `camera-registry/` would make `common/` depend on a feature module, which is backwards.

---

## Task 1: Database Migration — `bulk_upload_job` Table

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `../../../model1_fresh_setup.sql` (repo root — NOTE: per the project's schema policy this file is a historical record only; do not re-run it. It is updated here purely so it stays an accurate record of the full schema, matching the pattern already used for every prior schema change in this project)

**Interfaces:**
- Produces: a `BulkUploadJob` Prisma model, `bulk_upload_job` Postgres table.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Add this model, placed after the `Camera` model (before `VendorLookup`):

```prisma
// ----------------------------------------------------------------------------
// Bulk Upload Job
// ----------------------------------------------------------------------------
// Tracks a CSV bulk-upload's background-processing state. Postgres is the
// only durability layer for this job system — no external queue. A server
// restart mid-job is not auto-recovered in v1.
model BulkUploadJob {
  jobId           String    @id @default(dbgenerated("gen_random_uuid()")) @map("job_id") @db.Uuid

  // NOTE: will introspect as String — actual constraint:
  // 'pending' | 'processing' | 'completed' | 'failed'
  status          String    @default("pending")

  totalRows       Int       @map("total_rows")
  processedRows   Int       @default(0) @map("processed_rows")
  succeededCount  Int       @default(0) @map("succeeded_count")
  failedCount     Int       @default(0) @map("failed_count")

  // Array of { row: number, error: string }, appended to as rows fail.
  rowErrors       Json?     @map("row_errors")

  createdBy       String?   @map("created_by") @db.Uuid
  departmentScope String?   @map("department_scope") @db.Uuid

  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz
  completedAt     DateTime? @map("completed_at") @db.Timestamptz

  creator    AppUser?    @relation(fields: [createdBy], references: [userId])
  department Department? @relation(fields: [departmentScope], references: [departmentId])

  @@index([createdBy, createdAt(sort: Desc)], map: "idx_bulk_upload_job_created_by")
  @@map("bulk_upload_job")
}
```

- [ ] **Step 2: Add the reverse relations**

`AppUser` and `Department` need a reverse relation field for the new `creator`/`department` relations above (Prisma requires both sides declared). Modify `prisma/schema.prisma`:

In the `AppUser` model, add to its list of relation fields (alongside `camerasCreated`, `verificationsDone`, etc.):

```prisma
  bulkUploadJobs BulkUploadJob[]
```

In the `Department` model, add to its list of relation fields (alongside `users`, `cameras`):

```prisma
  bulkUploadJobs BulkUploadJob[]
```

- [ ] **Step 3: Run the migration**

```bash
cd model1-service
npx prisma migrate dev --name add_bulk_upload_job
```

Expected: prompts for a migration name if not passed via `--name` (it is, above), then applies successfully — `Your database is now in sync with your schema`. This is the first `migrate dev` run against this database; confirm it does not attempt to touch any existing table's data (it should only be `CREATE TABLE bulk_upload_job`, `ALTER TABLE app_user`/`department` are not needed since the relation is one-directional at the DB level — Prisma relations without an explicit foreign key column on the "many" side's already-existing table don't require altering that table).

- [ ] **Step 4: Regenerate the Prisma Client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client` with no errors.

- [ ] **Step 5: Verify the table exists correctly**

```bash
PGPASSWORD='Meet@0326' psql -U meet -h localhost -p 5432 -d sentinel_model1_db -c "\d bulk_upload_job"
```

Expected: shows all columns from Step 1, correct types, the `status` CHECK constraint, and both foreign keys.

- [ ] **Step 6: Update `model1_fresh_setup.sql` for consistency**

Add the following section to `../../../model1_fresh_setup.sql` (repo root, two directories above `model1-service/`), after the `camera` table's section, so the file stays an accurate historical record — do NOT re-run this file:

```sql
-- ============================================================================
-- SECTION 9a: Bulk Upload Job (added — CSV bulk upload background job tracking)
-- ============================================================================

CREATE TABLE bulk_upload_job (
    job_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    total_rows        INTEGER NOT NULL,
    processed_rows    INTEGER NOT NULL DEFAULT 0,
    succeeded_count   INTEGER NOT NULL DEFAULT 0,
    failed_count      INTEGER NOT NULL DEFAULT 0,
    row_errors        JSONB,
    created_by        UUID REFERENCES app_user(user_id),
    department_scope  UUID REFERENCES department(department_id),
    created_at        TIMESTAMPTZ DEFAULT now(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_bulk_upload_job_created_by ON bulk_upload_job (created_by, created_at DESC);
```

- [ ] **Step 7: Stop — do not commit**

---

## Task 2: Shared Audit-Write Function (Refactor)

**Files:**
- Create: `src/common/audit/write-audit-log-entry.ts`
- Create: `src/common/audit/write-audit-log-entry.spec.ts`
- Modify: `src/common/interceptors/audit-log.interceptor.ts`
- Modify: `src/common/interceptors/audit-log.interceptor.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (existing).
- Produces: `writeAuditLogEntry(prisma: PrismaService, userId: string | null, action: string, entityType: string, metadata: Prisma.InputJsonValue): void` — fire-and-forget, logs failure, never throws. Used by `AuditLogInterceptor` (this task) and later by the bulk-upload job (Task 6).

This task is a pure refactor of already-shipped code: `AuditLogInterceptor`'s inline `prisma.auditLog.create(...).catch(...)` logic is extracted with no behavior change, verified by the interceptor's existing test suite continuing to pass unmodified.

- [ ] **Step 1: Write the failing test**

Create `src/common/audit/write-audit-log-entry.spec.ts`:

```typescript
import { writeAuditLogEntry } from './write-audit-log-entry';
import { PrismaService } from '../../prisma/prisma.service';

describe('writeAuditLogEntry', () => {
  let prisma: { auditLog: { create: jest.Mock } };

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
  });

  it('calls prisma.auditLog.create with the given userId, action, entityType, and metadata', () => {
    writeAuditLogEntry(
      prisma as unknown as PrismaService,
      'user-1',
      'create_camera',
      'camera',
      { correlationId: 'corr-1' },
    );

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'create_camera',
        entityType: 'camera',
        metadata: { correlationId: 'corr-1' },
      },
    });
  });

  it('accepts a null userId', () => {
    writeAuditLogEntry(prisma as unknown as PrismaService, null, 'login', 'app_user', {});

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: { userId: null, action: 'login', entityType: 'app_user', metadata: {} },
    });
  });

  it('does not throw and does not block the caller when the write itself rejects', () => {
    prisma.auditLog.create.mockRejectedValue(new Error('db write failed'));

    expect(() =>
      writeAuditLogEntry(prisma as unknown as PrismaService, 'user-1', 'create_camera', 'camera', {}),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- write-audit-log-entry.spec.ts`
Expected: FAIL — `Cannot find module './write-audit-log-entry'`

- [ ] **Step 3: Write `write-audit-log-entry.ts`**

Create `src/common/audit/write-audit-log-entry.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const logger = new Logger('AuditLog');

// Fire-and-forget: writes one audit_log row. Never throws, never blocks the
// caller — a broken audit log must never fail the underlying operation,
// whether that's an HTTP request (via AuditLogInterceptor) or a background
// bulk-upload row (called directly, no request/interceptor involved).
export function writeAuditLogEntry(
  prisma: PrismaService,
  userId: string | null,
  action: string,
  entityType: string,
  metadata: Prisma.InputJsonValue,
): void {
  prisma.auditLog
    .create({
      data: { userId, action, entityType, metadata },
    })
    .catch((error: Error) => {
      logger.error(`Failed to write audit log for action "${action}": ${error.message}`);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- write-audit-log-entry.spec.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Refactor `AuditLogInterceptor` to use it**

Modify `src/common/interceptors/audit-log.interceptor.ts` — replace its contents:

```typescript
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_KEY, AuditMetadata } from '../decorators/audit.decorator';
import { AuditContextService } from '../context/audit-context.service';
import { writeAuditLogEntry } from '../audit/write-audit-log-entry';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly auditContext: AuditContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditMeta = this.reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const correlationId: string | undefined = request.correlationId;
    const userId: string | null = request.user?.userId ?? null;

    return next.handle().pipe(
      tap(() => {
        const changes = this.auditContext.getChanges(request);
        const metadata: Prisma.InputJsonValue = changes
          ? { correlationId, before: changes.before, after: changes.after }
          : { correlationId };

        writeAuditLogEntry(this.prisma, userId, auditMeta.action, auditMeta.entityType, metadata);
      }),
    );
  }
}
```

Note: the `Logger`-based error logging that used to live inline is now inside `writeAuditLogEntry` itself (Step 3) — this is why `Logger` is no longer imported here.

- [ ] **Step 6: Run the interceptor's existing test suite to confirm no behavior change**

Run: `npm test -- audit-log.interceptor.spec.ts`
Expected: PASS, all 6 existing tests green, completely unmodified — this is the proof the refactor didn't change externally observable behavior. If any test needs a change to pass, that indicates the refactor broke something; do not modify the test to make it pass, fix the refactored code instead.

- [ ] **Step 7: Stop — do not commit**

---

## Task 3: `applyCameraFieldChanges` (Refactor `updateCamera`)

**Files:**
- Modify: `src/camera-registry/camera-registry.service.ts`
- Modify: `src/camera-registry/camera-registry.service.spec.ts`

**Interfaces:**
- Produces:
  - `CameraRegistryService.applyCameraFieldChanges(cameraId: string, dto: UpdateCameraDto, existing: CameraRecord): Promise<{ before: Record<string, string | number | boolean | null>; after: Record<string, string | number | boolean | null> } | null>` — does the diffing and the direct DB write (plain fields + conditional spatial update), returns `null` if nothing changed. Used by both `updateCamera` (this task) and the bulk-upload job (Task 6).
  - `CameraRegistryService.findCameraRecordById(cameraId: string): Promise<CameraRecord | null>` — a thin **public** wrapper around the already-private `findCameraRow`, with no role/scoping check at all (unlike `getCameraById`, which is scoping-aware and requires an `AuthenticatedUser`). This exists specifically for the bulk-upload job (Task 6), which already found the camera unscoped via `prisma.camera.findFirst` and needs a full `CameraRecord` shape to pass into `applyCameraFieldChanges` — it has no real `AuthenticatedUser` context to fabricate for a `getCameraById` call, and fabricating one would be a scoping-check workaround, not a legitimate use of that method.

This is a pure refactor of `updateCamera` plus one new small read method: `updateCamera`'s existing diffing/SQL-building logic is extracted verbatim into `applyCameraFieldChanges`; `updateCamera` becomes a thin wrapper calling it. The existing `camera-registry.service.spec.ts` tests for `updateCamera` must continue passing unmodified — this is the proof the refactor is behavior-preserving.

- [ ] **Step 1: Confirm the existing `updateCamera` tests still describe the wanted behavior**

Read the current `describe('updateCamera', ...)` block in `src/camera-registry/camera-registry.service.spec.ts` — no changes needed to it in this task. Run it now to confirm it passes before starting the refactor:

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS (20 tests, the full file's current state from the prior build).

- [ ] **Step 2: Write the failing test for `applyCameraFieldChanges` directly**

Add to `src/camera-registry/camera-registry.service.spec.ts`, inside the top-level `describe('CameraRegistryService', ...)` block, as a new `describe` alongside the existing ones:

```typescript
  describe('applyCameraFieldChanges', () => {
    const existingRow = { ...fakeCreatedRow, name: 'Old Name' };

    it('returns before/after and writes the DB when a plain field changes', async () => {
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.applyCameraFieldChanges('cam-1', { name: 'New Name' }, existingRow);

      expect(result).toEqual({ before: { name: 'Old Name' }, after: { name: 'New Name' } });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('includes location_geo in the write when both latitude and longitude change', async () => {
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.applyCameraFieldChanges(
        'cam-1',
        { latitude: 24.0, longitude: 73.0 },
        existingRow,
      );

      expect(result).toEqual({
        before: { latitude: 23.0225, longitude: 72.5714 },
        after: { latitude: 24.0, longitude: 73.0 },
      });
      const [sqlFragment] = prisma.$executeRaw.mock.calls[0];
      expect(JSON.stringify(sqlFragment)).toContain('location_geo');
    });

    it('returns null and writes nothing when the dto contains no actual changes', async () => {
      const result = await service.applyCameraFieldChanges('cam-1', { name: 'Old Name' }, existingRow);

      expect(result).toBeNull();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('findCameraRecordById', () => {
    it('returns the mapped camera record with no scoping check applied', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeCreatedRow]);

      const result = await service.findCameraRecordById('cam-1');

      expect(result?.cameraId).toBe('cam-1');
    });

    it('returns null when the camera does not exist (no exception thrown)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.findCameraRecordById('nonexistent');

      expect(result).toBeNull();
    });
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: FAIL — `service.applyCameraFieldChanges is not a function` and `service.findCameraRecordById is not a function`

- [ ] **Step 4: Extract `applyCameraFieldChanges` and refactor `updateCamera`**

Modify `src/camera-registry/camera-registry.service.ts` — replace the entire `updateCamera` method with:

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

    const changes = await this.applyCameraFieldChanges(cameraId, dto, existing);

    if (changes) {
      this.auditContext.setChanges(request, changes.before, changes.after);
    }

    const updated = await this.findCameraRow(cameraId);
    if (!updated) {
      throw new Error(`Camera ${cameraId} was updated but could not be re-read`);
    }
    return updated;
  }

  // Data-mutation logic only — does NOT call auditContext.setChanges, so it
  // can be called from contexts with no live HTTP request (the bulk-upload
  // background job, Task 6) as well as from updateCamera above. Returns the
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
    ];

    for (const [dtoKey, column] of plainFieldMap) {
      const newValue = dto[dtoKey];
      if (newValue === undefined) continue;
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
      return null;
    }

    setClauses.push(Prisma.sql`updated_at = now()`);

    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE camera SET ${Prisma.join(setClauses, ', ')} WHERE camera_id = ${cameraId}::uuid`,
    );

    return { before, after };
  }

  // Public, unscoped read by ID — no AuthenticatedUser required, unlike
  // getCameraById. Exists for the bulk-upload job (Task 6), which already
  // found the camera unscoped via a direct Prisma query and needs a full
  // CameraRecord to pass into applyCameraFieldChanges, with no real
  // AuthenticatedUser context to fabricate for a scoping-aware call.
  async findCameraRecordById(cameraId: string): Promise<CameraRecord | null> {
    return this.findCameraRow(cameraId);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS, all tests green — the 3 new `applyCameraFieldChanges` tests, the 2 new `findCameraRecordById` tests, plus every pre-existing `updateCamera` test unmodified and still passing (proving the refactor preserved behavior).

- [ ] **Step 6: Stop — do not commit**

---

## Task 4: CSV Structural Validation, Row DTO, and Department Lookup

**Files:**
- Create: `src/camera-registry/dto/bulk-upload-row.dto.ts`
- Create: `src/camera-registry/dto/bulk-upload-row.dto.spec.ts`
- Create: `src/camera-registry/bulk-upload/department-lookup.service.ts`
- Create: `src/camera-registry/bulk-upload/department-lookup.service.spec.ts`
- Create: `src/camera-registry/bulk-upload/csv-parser.service.ts`
- Create: `src/camera-registry/bulk-upload/csv-parser.service.spec.ts`

**Interfaces:**
- Produces:
  - `BulkUploadRowDto` — same field set as `CreateCameraDto` but with `departmentCode: string` instead of `departmentId: string`.
  - `DepartmentLookupService.loadCodeToIdMap(): Promise<Map<string, string>>` — queries all departments once, returns `code → departmentId`.
  - `CsvParserService.validateStructure(fileBuffer: Buffer): void` — throws `BadRequestException` if headers are wrong/missing/file is empty; does not parse row data.
  - `CsvParserService.parseRows(fileBuffer: Buffer): AsyncGenerator<{ rowNumber: number; raw: Record<string, string> }>` — streams parsed rows one at a time, 1-indexed counting the header as row 1 (so the first data row is row 2).

- [ ] **Step 1: Install dependencies**

```bash
npm install csv-parse csv-stringify
npm install --save-dev @types/multer
```

- [ ] **Step 2: Write the failing test for `BulkUploadRowDto`**

Create `src/camera-registry/dto/bulk-upload-row.dto.spec.ts`:

```typescript
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BulkUploadRowDto } from './bulk-upload-row.dto';

describe('BulkUploadRowDto', () => {
  const validPayload = {
    name: 'Main Gate Camera',
    departmentCode: 'HOME',
    latitude: 23.0225,
    longitude: 72.5714,
    cameraType: 'ip',
  };

  it('accepts a minimal valid payload', async () => {
    const dto = plainToInstance(BulkUploadRowDto, validPayload);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing departmentCode', async () => {
    const { departmentCode, ...rest } = validPayload;
    const dto = plainToInstance(BulkUploadRowDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'departmentCode')).toBe(true);
  });

  it('rejects an out-of-range latitude', async () => {
    const dto = plainToInstance(BulkUploadRowDto, { ...validPayload, latitude: 999 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('rejects an invalid cameraType', async () => {
    const dto = plainToInstance(BulkUploadRowDto, { ...validPayload, cameraType: 'drone' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cameraType')).toBe(true);
  });

  it('rejects a missing name', async () => {
    const { name, ...rest } = validPayload;
    const dto = plainToInstance(BulkUploadRowDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- bulk-upload-row.dto.spec.ts`
Expected: FAIL — `Cannot find module './bulk-upload-row.dto'`

- [ ] **Step 4: Write `bulk-upload-row.dto.ts`**

Create `src/camera-registry/dto/bulk-upload-row.dto.ts`:

```typescript
import {
  IsDateString,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

const CAMERA_TYPES = ['analog', 'ip'] as const;

// Same field set as CreateCameraDto, except departmentCode (e.g. "HOME")
// instead of a raw departmentId UUID — field staff filling out a CSV know
// department codes, not UUIDs. The bulk-upload service resolves
// departmentCode -> departmentId via DepartmentLookupService before reusing
// CreateCameraDto/UpdateCameraDto internally.
export class BulkUploadRowDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  departmentCode!: string;

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

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- bulk-upload-row.dto.spec.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 6: Write the failing test for `DepartmentLookupService`**

Create `src/camera-registry/bulk-upload/department-lookup.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DepartmentLookupService } from './department-lookup.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DepartmentLookupService', () => {
  let service: DepartmentLookupService;
  let prisma: { department: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { department: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DepartmentLookupService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DepartmentLookupService);
  });

  it('returns a Map from department code to departmentId', async () => {
    prisma.department.findMany.mockResolvedValue([
      { departmentId: 'dept-1', code: 'HOME' },
      { departmentId: 'dept-2', code: 'RTO' },
    ]);

    const map = await service.loadCodeToIdMap();

    expect(map.get('HOME')).toBe('dept-1');
    expect(map.get('RTO')).toBe('dept-2');
    expect(map.size).toBe(2);
  });

  it('returns an empty Map when there are no departments', async () => {
    prisma.department.findMany.mockResolvedValue([]);

    const map = await service.loadCodeToIdMap();

    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- department-lookup.service.spec.ts`
Expected: FAIL — `Cannot find module './department-lookup.service'`

- [ ] **Step 8: Write `department-lookup.service.ts`**

Create `src/camera-registry/bulk-upload/department-lookup.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DepartmentLookupService {
  constructor(private readonly prisma: PrismaService) {}

  // Loaded once per bulk-upload job (not once per row) — departments don't
  // change mid-job, so re-querying per row would be wasted round trips at
  // a 10,000-row scale.
  async loadCodeToIdMap(): Promise<Map<string, string>> {
    const departments = await this.prisma.department.findMany({
      select: { departmentId: true, code: true },
    });
    return new Map(departments.map((d) => [d.code, d.departmentId]));
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- department-lookup.service.spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 10: Write the failing test for `CsvParserService`**

Create `src/camera-registry/bulk-upload/csv-parser.service.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { CsvParserService } from './csv-parser.service';

describe('CsvParserService', () => {
  let service: CsvParserService;

  beforeEach(() => {
    service = new CsvParserService();
  });

  const validHeader =
    'name,departmentCode,latitude,longitude,cameraType,brand,model,addressText,installedAt\n';

  describe('validateStructure', () => {
    it('does not throw for a valid header row', () => {
      const buffer = Buffer.from(validHeader + 'Camera A,HOME,23.0,72.0,ip,,,,\n');
      expect(() => service.validateStructure(buffer)).not.toThrow();
    });

    it('throws BadRequestException for an empty file', () => {
      const buffer = Buffer.from('');
      expect(() => service.validateStructure(buffer)).toThrow(BadRequestException);
    });

    it('throws BadRequestException when a required header column is missing', () => {
      const buffer = Buffer.from('name,departmentCode,latitude,longitude,cameraType\n');
      expect(() => service.validateStructure(buffer)).toThrow(BadRequestException);
    });

    it('throws BadRequestException when headers are present but misspelled', () => {
      const buffer = Buffer.from(
        'name,deptCode,latitude,longitude,cameraType,brand,model,addressText,installedAt\n',
      );
      expect(() => service.validateStructure(buffer)).toThrow(BadRequestException);
    });
  });

  describe('parseRows', () => {
    it('yields each data row with a 1-indexed rowNumber counting the header as row 1', async () => {
      const buffer = Buffer.from(
        validHeader + 'Camera A,HOME,23.0,72.0,ip,,,,\nCamera B,RTO,22.0,71.0,analog,,,,\n',
      );

      const rows = [];
      for await (const row of service.parseRows(buffer)) {
        rows.push(row);
      }

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        rowNumber: 2,
        raw: {
          name: 'Camera A',
          departmentCode: 'HOME',
          latitude: '23.0',
          longitude: '72.0',
          cameraType: 'ip',
          brand: '',
          model: '',
          addressText: '',
          installedAt: '',
        },
      });
      expect(rows[1].rowNumber).toBe(3);
      expect(rows[1].raw.name).toBe('Camera B');
    });

    it('counts total data rows correctly for a larger file', async () => {
      const dataRows = Array.from(
        { length: 20 },
        (_, i) => `Camera ${i},HOME,23.0,72.0,ip,,,,`,
      ).join('\n');
      const buffer = Buffer.from(validHeader + dataRows + '\n');

      const rows = [];
      for await (const row of service.parseRows(buffer)) {
        rows.push(row);
      }

      expect(rows).toHaveLength(20);
      expect(rows[19].rowNumber).toBe(21);
    });
  });
});
```

- [ ] **Step 11: Run test to verify it fails**

Run: `npm test -- csv-parser.service.spec.ts`
Expected: FAIL — `Cannot find module './csv-parser.service'`

- [ ] **Step 12: Write `csv-parser.service.ts`**

Create `src/camera-registry/bulk-upload/csv-parser.service.ts`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse';
import { Readable } from 'stream';

const EXPECTED_HEADERS = [
  'name',
  'departmentCode',
  'latitude',
  'longitude',
  'cameraType',
  'brand',
  'model',
  'addressText',
  'installedAt',
];

export interface ParsedCsvRow {
  rowNumber: number;
  raw: Record<string, string>;
}

@Injectable()
export class CsvParserService {
  // Fast, synchronous check run before any job is created — a structurally
  // broken file (wrong headers, empty) never gets a bulk_upload_job row.
  validateStructure(fileBuffer: Buffer): void {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty');
    }

    const firstLine = fileBuffer.toString('utf-8').split('\n')[0]?.trim();
    if (!firstLine) {
      throw new BadRequestException('Uploaded file has no header row');
    }

    const headers = firstLine.split(',').map((h) => h.trim());
    const missing = EXPECTED_HEADERS.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      throw new BadRequestException(
        `CSV is missing required column(s): ${missing.join(', ')}`,
      );
    }
  }

  // Streams rows one at a time rather than parsing the whole file into an
  // array up front — matters at a 10,000-row scale so memory use stays
  // proportional to one row, not the whole file.
  async *parseRows(fileBuffer: Buffer): AsyncGenerator<ParsedCsvRow> {
    const parser = Readable.from(fileBuffer).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }),
    );

    let rowNumber = 1; // header is row 1
    for await (const record of parser) {
      rowNumber += 1;
      yield { rowNumber, raw: record as Record<string, string> };
    }
  }
}
```

- [ ] **Step 13: Run test to verify it passes**

Run: `npm test -- csv-parser.service.spec.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 14: Stop — do not commit**

---

## Task 5: Bulk Upload Endpoint — Structural Validation, Job Creation, `202` Response

**Files:**
- Create: `src/camera-registry/bulk-upload/bulk-upload.service.ts`
- Create: `src/camera-registry/bulk-upload/bulk-upload.service.spec.ts`
- Modify: `src/camera-registry/camera-registry.controller.ts`
- Modify: `src/camera-registry/camera-registry.controller.spec.ts`
- Modify: `src/camera-registry/camera-registry.module.ts`

**Interfaces:**
- Consumes: `CsvParserService.validateStructure` (Task 4), `PrismaService`.
- Produces: `BulkUploadService.createJob(fileBuffer: Buffer, createdBy: string): Promise<{ jobId: string }>` — validates structure, counts data rows, creates the `bulk_upload_job` row, kicks off background processing (stubbed as a no-op in this task; real processing logic is Task 6), returns the new job's ID. `POST /cameras/bulk` → `202 { jobId }`.

This task deliberately stops short of implementing the actual row-processing loop — that's Task 6, once `applyCameraFieldChanges`/`writeAuditLogEntry`/`DepartmentLookupService` are all in place and this task has proven the endpoint's synchronous contract (structural validation, job creation, immediate 202) works correctly on its own.

- [ ] **Step 1: Write the failing test**

Create `src/camera-registry/bulk-upload/bulk-upload.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BulkUploadService } from './bulk-upload.service';
import { CsvParserService } from './csv-parser.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('BulkUploadService', () => {
  let service: BulkUploadService;
  let csvParser: { validateStructure: jest.Mock; parseRows: jest.Mock };
  let prisma: { bulkUploadJob: { create: jest.Mock } };

  beforeEach(async () => {
    csvParser = { validateStructure: jest.fn(), parseRows: jest.fn() };
    prisma = { bulkUploadJob: { create: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkUploadService,
        { provide: CsvParserService, useValue: csvParser },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BulkUploadService);
    // processRowsInBackground is exercised in Task 6 — stub it out here so
    // this task's tests only exercise the synchronous createJob contract.
    jest.spyOn(service as any, 'processRowsInBackground').mockResolvedValue(undefined);
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
      yield { rowNumber: 4, raw: {} };
    }
    csvParser.parseRows.mockReturnValue(fakeRows());
    prisma.bulkUploadJob.create.mockResolvedValue({ jobId: 'job-1' });

    const result = await service.createJob(Buffer.from('irrelevant'), 'user-1');

    expect(result).toEqual({ jobId: 'job-1' });
    expect(prisma.bulkUploadJob.create).toHaveBeenCalledWith({
      data: { totalRows: 3, createdBy: 'user-1', status: 'pending' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- bulk-upload.service.spec.ts`
Expected: FAIL — `Cannot find module './bulk-upload.service'`

- [ ] **Step 3: Write `bulk-upload.service.ts`**

Create `src/camera-registry/bulk-upload/bulk-upload.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CsvParserService } from './csv-parser.service';

@Injectable()
export class BulkUploadService {
  constructor(
    private readonly csvParser: CsvParserService,
    private readonly prisma: PrismaService,
  ) {}

  async createJob(fileBuffer: Buffer, createdBy: string): Promise<{ jobId: string }> {
    // Fast structural check — throws BadRequestException before any job
    // row is created if the file is fundamentally broken.
    this.csvParser.validateStructure(fileBuffer);

    let totalRows = 0;
    for await (const _row of this.csvParser.parseRows(fileBuffer)) {
      totalRows += 1;
    }

    const job = await this.prisma.bulkUploadJob.create({
      data: { totalRows, createdBy, status: 'pending' },
    });

    // Fire-and-forget: does not block the 202 response. Real per-row
    // processing is implemented in Task 6 — this task only needs the call
    // site and the method to exist so the background/foreground split is
    // established now.
    void this.processRowsInBackground(job.jobId, fileBuffer, createdBy);

    return { jobId: job.jobId };
  }

  private async processRowsInBackground(
    _jobId: string,
    _fileBuffer: Buffer,
    _createdBy: string,
  ): Promise<void> {
    // Implemented in Task 6.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- bulk-upload.service.spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 5: Write the failing controller test**

Add to `src/camera-registry/camera-registry.controller.spec.ts` — add this import at the top:

```typescript
import { BulkUploadService } from './bulk-upload/bulk-upload.service';
```

Add `bulkUploadService: Record<string, jest.Mock>` alongside the existing `service` variable declaration, initialize it in `beforeEach`, and provide it in the `TestingModule`:

```typescript
  let bulkUploadService: Record<string, jest.Mock>;
```

In `beforeEach`, after the existing `service = {...}` assignment:

```typescript
    bulkUploadService = { createJob: jest.fn() };
```

Update the `TestingModule.compile()` call's `providers` array to also include:

```typescript
      providers: [
        { provide: CameraRegistryService, useValue: service },
        { provide: BulkUploadService, useValue: bulkUploadService },
      ],
```

Then add the test itself:

```typescript
  it('uploadBulk delegates to BulkUploadService.createJob with the file buffer and current user id', async () => {
    const fakeFile = { buffer: Buffer.from('csv content') } as Express.Multer.File;
    bulkUploadService.createJob.mockResolvedValue({ jobId: 'job-1' });

    const result = await controller.uploadBulk(fakeFile, currentUser);

    expect(bulkUploadService.createJob).toHaveBeenCalledWith(fakeFile.buffer, 'user-1');
    expect(result).toEqual({ jobId: 'job-1' });
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: FAIL — `controller.uploadBulk is not a function`

- [ ] **Step 7: Add the `uploadBulk` endpoint**

Modify `src/camera-registry/camera-registry.controller.ts` — add these imports:

```typescript
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { BulkUploadService } from './bulk-upload/bulk-upload.service';
```

(merge `UseInterceptors`/`UploadedFile` into the existing `@nestjs/common` import line rather than adding a duplicate import statement)

Update the constructor to also inject `BulkUploadService`:

```typescript
  constructor(
    private readonly cameraRegistryService: CameraRegistryService,
    private readonly bulkUploadService: BulkUploadService,
  ) {}
```

Add the new endpoint method:

```typescript
  @Roles('admin', 'field_officer')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('bulk')
  async uploadBulk(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.bulkUploadService.createJob(file.buffer, currentUser.userId);
  }
```

Note: this route must be declared **before** the `@Get(':id')`/`@Patch(':id')`/`@Delete(':id')` routes in the file are affected by route ordering only for path *segments* that could collide — `POST /cameras/bulk` doesn't collide with any existing `:id`-parameterized route since they're different HTTP methods and `bulk` isn't itself a `GET`/`PATCH`/`DELETE` path, so no reordering of existing methods is required. Add this new method anywhere in the class (after `create` is a reasonable place, kept in this instruction for whoever implements it to place consistently).

- [ ] **Step 8: Update `camera-registry.module.ts`**

Modify `src/camera-registry/camera-registry.module.ts` — add the imports:

```typescript
import { BulkUploadService } from './bulk-upload/bulk-upload.service';
import { CsvParserService } from './bulk-upload/csv-parser.service';
import { DepartmentLookupService } from './bulk-upload/department-lookup.service';
```

Add all three to the `providers` array (alongside `CameraRegistryService`).

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 10: Stop — do not commit**

---

## Task 6: Background Row Processing — Create/Update Dispatch, Batching, Progress Updates

**Files:**
- Modify: `src/camera-registry/bulk-upload/bulk-upload.service.ts`
- Modify: `src/camera-registry/bulk-upload/bulk-upload.service.spec.ts`
- Modify: `src/camera-registry/camera-registry.module.ts`

**Interfaces:**
- Consumes: `CameraRegistryService.createCamera`, `CameraRegistryService.applyCameraFieldChanges`, `CameraRegistryService.findCameraRecordById` (all Task 3), `DepartmentLookupService.loadCodeToIdMap` (Task 4), `writeAuditLogEntry` (Task 2), `BulkUploadRowDto` (Task 4).
- Produces: the real implementation of `processRowsInBackground` — the actual per-row create/update/error logic, batching, and job progress updates.

- [ ] **Step 1: Write the failing tests**

Replace the `jest.spyOn(service as any, 'processRowsInBackground').mockResolvedValue(undefined);` line in `src/camera-registry/bulk-upload/bulk-upload.service.spec.ts`'s `beforeEach` — this task tests the real method, so remove that stub line entirely and instead add the dependencies it now needs. Replace the whole file's `beforeEach` and imports section with:

```typescript
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
    bulkUploadJob: { create: jest.Mock; update: jest.Mock };
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
      bulkUploadJob: { create: jest.fn(), update: jest.fn().mockResolvedValue({}) },
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
        expect.objectContaining({ name: 'Camera A', departmentId: 'dept-1' }),
        'user-1',
      );
      expect(writeAuditLogEntry).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        'create_camera',
        'camera',
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- bulk-upload.service.spec.ts`
Expected: FAIL — the `processRowsInBackground` tests fail since it's still a no-op stub (e.g. `createCamera` never called).

- [ ] **Step 3: Implement `processRowsInBackground`**

Modify `src/camera-registry/bulk-upload/bulk-upload.service.ts` — replace its entire contents:

```typescript
import { Injectable, Logger } from '@nestjs/common';
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
```

**Note for the implementer:** `processSingleRow` calls `this.cameraRegistryService.findCameraRecordById(existing.cameraId)` — the unscoped read added in Task 3 — to get a full `CameraRecord` shape for `applyCameraFieldChanges`'s `existing` parameter. This is deliberately not `getCameraById` (which requires a real `AuthenticatedUser` and performs a `dept_viewer` scoping check): the row was already found via `prisma.camera.findFirst` with no department restriction, and there is no real authenticated user context inside a background job to construct a legitimate `AuthenticatedUser` for. Fabricating one (e.g. `{ role: 'admin' }`) would be a scoping-check workaround; using the unscoped read method instead is honest about what's actually happening.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- bulk-upload.service.spec.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Manually verify end-to-end against the real database**

```bash
npm run start:dev
```

In a second terminal, create a small test CSV:

```bash
cat > /tmp/test-cameras.csv << 'EOF'
name,departmentCode,latitude,longitude,cameraType,brand,model,addressText,installedAt
Bulk Test Camera 1,HOME,23.01,72.51,ip,,,,
Bulk Test Camera 2,RTO,22.51,71.51,analog,,,,
Bulk Test Camera Bad,ZZZZ,23.0,72.0,ip,,,,
EOF
```

Log in as an admin/field_officer, then upload:

```bash
curl -s -X POST http://localhost:3000/api/v1/cameras/bulk \
  -H "Authorization: Bearer <accessToken>" \
  -F "file=@/tmp/test-cameras.csv"
```

Expected: `202` with a `jobId`. Poll (once Task 7's status endpoint exists — for this task, confirm via psql instead):

```bash
PGPASSWORD='Meet@0326' psql -U meet -h localhost -p 5432 -d sentinel_model1_db -c "SELECT status, total_rows, processed_rows, succeeded_count, failed_count, row_errors FROM bulk_upload_job ORDER BY created_at DESC LIMIT 1;"
```

Expected (may need a moment for the background job to finish on a 3-row file — should be near-instant): `status='completed'`, `total_rows=3`, `succeeded_count=2`, `failed_count=1`, `row_errors` containing one entry mentioning `ZZZZ`. Confirm the two valid cameras exist:

```bash
PGPASSWORD='Meet@0326' psql -U meet -h localhost -p 5432 -d sentinel_model1_db -c "SELECT name, department_id FROM camera WHERE name LIKE 'Bulk Test Camera%';"
```

Clean up:

```bash
PGPASSWORD='Meet@0326' psql -U meet -h localhost -p 5432 -d sentinel_model1_db -c "DELETE FROM audit_log WHERE entity_type = 'camera'; DELETE FROM camera WHERE name LIKE 'Bulk Test Camera%'; DELETE FROM bulk_upload_job;"
```

Stop the dev server.

- [ ] **Step 6: Stop — do not commit**

---

## Task 7: Job Status Endpoint

**Files:**
- Create: `src/camera-registry/bulk-upload/bulk-upload.service.spec.ts` (add to existing file)
- Modify: `src/camera-registry/bulk-upload/bulk-upload.service.ts`
- Modify: `src/camera-registry/camera-registry.controller.ts`
- Modify: `src/camera-registry/camera-registry.controller.spec.ts`

**Interfaces:**
- Produces: `BulkUploadService.getJobStatus(jobId: string): Promise<JobStatus>` — throws `NotFoundException` if the job doesn't exist. `GET /cameras/bulk/:jobId` → 200 or 404.

- [ ] **Step 1: Write the failing test**

Add to `src/camera-registry/bulk-upload/bulk-upload.service.spec.ts`, inside the top-level `describe`:

```typescript
  describe('getJobStatus', () => {
    it('returns the mapped job status', async () => {
      (prisma as any).bulkUploadJob.findUnique = jest.fn().mockResolvedValue({
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
      (prisma as any).bulkUploadJob.findUnique = jest.fn().mockResolvedValue(null);

      await expect(service.getJobStatus('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- bulk-upload.service.spec.ts`
Expected: FAIL — `service.getJobStatus is not a function`

- [ ] **Step 3: Add `getJobStatus`**

Modify `src/camera-registry/bulk-upload/bulk-upload.service.ts` — add `NotFoundException` to the `@nestjs/common` import, and add this method to the class:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- bulk-upload.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Write the failing controller test**

Add to `src/camera-registry/camera-registry.controller.spec.ts`:

```typescript
  it('getBulkJobStatus delegates to BulkUploadService.getJobStatus with the jobId', async () => {
    const jobStatus = { jobId: 'job-1', status: 'completed' };
    bulkUploadService.getJobStatus = jest.fn().mockResolvedValue(jobStatus);

    const result = await controller.getBulkJobStatus('job-1');

    expect(bulkUploadService.getJobStatus).toHaveBeenCalledWith('job-1');
    expect(result).toEqual(jobStatus);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: FAIL — `controller.getBulkJobStatus is not a function`

- [ ] **Step 7: Add the `getBulkJobStatus` endpoint**

Modify `src/camera-registry/camera-registry.controller.ts` — add the method:

```typescript
  @Roles('admin', 'field_officer')
  @Get('bulk/:jobId')
  async getBulkJobStatus(@Param('jobId') jobId: string) {
    return this.bulkUploadService.getJobStatus(jobId);
  }
```

**Route ordering note:** this must be declared in the controller class **before** the `@Get(':id')` method (`getOne`) — NestJS matches routes in declaration order, and `bulk/:jobId` needs to win against the more general `:id` pattern for a path like `/cameras/bulk/abc-123`. Verify the method order in the final file has `getBulkJobStatus` (or the whole `bulk`-prefixed group) positioned before `getOne`.

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 9: Manually verify route ordering works correctly**

```bash
npm run start:dev
```

```bash
curl -s -w "\nHTTP:%{http_code}\n" http://localhost:3000/api/v1/cameras/bulk/00000000-0000-0000-0000-000000000000 -H "Authorization: Bearer <accessToken>"
```

Expected: `404` with a message about the bulk upload job not being found — NOT a UUID-parsing error or a "camera not found" message, which would indicate the request was incorrectly routed to `getOne` instead of `getBulkJobStatus`. Stop the dev server.

- [ ] **Step 10: Stop — do not commit**

---

## Task 8: CSV Export Service

**Files:**
- Create: `src/camera-registry/export/camera-export.service.ts`
- Create: `src/camera-registry/export/camera-export.service.spec.ts`
- Modify: `src/camera-registry/camera-registry.module.ts`

**Interfaces:**
- Consumes: `CameraRegistryService`'s read logic — this task adds a new method to `CameraRegistryService` itself (`listCamerasUnpaginated`) rather than duplicating the `CAMERA_SELECT_SQL` query pattern in a separate file, since it's the same read shape as `listCameras` minus `LIMIT`/`OFFSET`.
- Produces: `CameraRegistryService.listCamerasUnpaginated(filters, currentUser): Promise<CameraRecord[]>`, `CameraExportService.generateCsv(cameras: CameraRecord[]): string`.

- [ ] **Step 1: Write the failing test for `listCamerasUnpaginated`**

Add to `src/camera-registry/camera-registry.service.spec.ts`:

```typescript
  describe('listCamerasUnpaginated', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };

    it('returns all matching rows with no LIMIT/OFFSET in the query', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeCreatedRow]);

      const result = await service.listCamerasUnpaginated({ isActive: true }, admin);

      expect(result).toHaveLength(1);
      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).not.toContain('LIMIT');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: FAIL — `service.listCamerasUnpaginated is not a function`

- [ ] **Step 3: Add `listCamerasUnpaginated`**

Modify `src/camera-registry/camera-registry.service.ts` — add this method after `listCameras`:

```typescript
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

    const whereClause =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<RawCameraRow[]>(
      Prisma.sql`${Prisma.raw(CAMERA_SELECT_SQL)} ${whereClause} ORDER BY created_at DESC`,
    );

    return rows.map(mapRow);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Write the failing test for `CameraExportService`**

Create `src/camera-registry/export/camera-export.service.spec.ts`:

```typescript
import { CameraExportService } from './camera-export.service';
import { CameraRecord } from '../camera-registry.service';

describe('CameraExportService', () => {
  let service: CameraExportService;

  beforeEach(() => {
    service = new CameraExportService();
  });

  const sampleCamera: CameraRecord = {
    cameraId: 'cam-1',
    departmentId: 'dept-1',
    name: 'Camera A',
    addressText: null,
    cameraType: 'ip',
    brand: 'Hikvision',
    model: 'DS-2CD',
    onvifStatus: 'unknown',
    onvifSource: null,
    integrationScore: 'needs_verification',
    dataConfidence: 'self_reported',
    photoUrl: null,
    currentStatus: 'unknown',
    installedAt: null,
    isActive: true,
    createdBy: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    longitude: 72.5714,
    latitude: 23.0225,
  };

  it('generates a CSV header row with the expected columns', () => {
    const csv = service.generateCsv([]);
    const headerLine = csv.split('\n')[0];
    expect(headerLine).toContain('cameraId');
    expect(headerLine).toContain('name');
    expect(headerLine).toContain('latitude');
    expect(headerLine).toContain('longitude');
    expect(headerLine).toContain('integrationScore');
  });

  it('generates one data row per camera with correct values', () => {
    const csv = service.generateCsv([sampleCamera]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Camera A');
    expect(lines[1]).toContain('Hikvision');
    expect(lines[1]).toContain('23.0225');
  });

  it('returns just the header row for an empty camera list', () => {
    const csv = service.generateCsv([]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- camera-export.service.spec.ts`
Expected: FAIL — `Cannot find module './camera-export.service'`

- [ ] **Step 7: Write `camera-export.service.ts`**

Create `src/camera-registry/export/camera-export.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { CameraRecord } from '../camera-registry.service';

const EXPORT_COLUMNS: Array<keyof CameraRecord> = [
  'cameraId',
  'departmentId',
  'name',
  'addressText',
  'cameraType',
  'brand',
  'model',
  'onvifStatus',
  'onvifSource',
  'integrationScore',
  'dataConfidence',
  'currentStatus',
  'installedAt',
  'isActive',
  'latitude',
  'longitude',
  'createdAt',
  'updatedAt',
];

@Injectable()
export class CameraExportService {
  generateCsv(cameras: CameraRecord[]): string {
    const rows = cameras.map((camera) =>
      EXPORT_COLUMNS.map((column) => {
        const value = camera[column];
        if (value === null || value === undefined) return '';
        if (value instanceof Date) return value.toISOString();
        return String(value);
      }),
    );

    return stringify([EXPORT_COLUMNS, ...rows]);
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- camera-export.service.spec.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 9: Register `CameraExportService` in the module**

Modify `src/camera-registry/camera-registry.module.ts` — add the import and add it to `providers`:

```typescript
import { CameraExportService } from './export/camera-export.service';
```

- [ ] **Step 10: Stop — do not commit**

---

## Task 9: Export Endpoint

**Files:**
- Modify: `src/camera-registry/camera-registry.controller.ts`
- Modify: `src/camera-registry/camera-registry.controller.spec.ts`

**Interfaces:**
- Consumes: `CameraRegistryService.listCamerasUnpaginated` (Task 8), `CameraExportService.generateCsv` (Task 8).
- Produces: `GET /cameras/export` → `200`, `Content-Type: text/csv`, CSV body.

- [ ] **Step 1: Write the failing test**

Add to `src/camera-registry/camera-registry.controller.spec.ts` — add these imports:

```typescript
import { CameraExportService } from './export/camera-export.service';
```

Add `cameraExportService: Record<string, jest.Mock>` and `mockResponse` setup, initialize in `beforeEach`, provide in the `TestingModule`. Then add the test:

```typescript
  it('exportCsv writes CSV content to the response with correct headers', async () => {
    const cameras = [{ cameraId: 'cam-1', name: 'Camera A' }];
    service.listCamerasUnpaginated = jest.fn().mockResolvedValue(cameras);
    cameraExportService.generateCsv = jest.fn().mockReturnValue('cameraId,name\ncam-1,Camera A\n');
    const mockResponse = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    await controller.exportCsv({} as any, currentUser, mockResponse as any);

    expect(service.listCamerasUnpaginated).toHaveBeenCalled();
    expect(cameraExportService.generateCsv).toHaveBeenCalledWith(cameras);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename="cameras-export-'),
    );
    expect(mockResponse.send).toHaveBeenCalledWith('cameraId,name\ncam-1,Camera A\n');
  });
```

Add `cameraExportService = { generateCsv: jest.fn() };` to `beforeEach`, and `{ provide: CameraExportService, useValue: cameraExportService }` to the providers array. Also add `listCamerasUnpaginated: jest.fn()` to the `service` object in `beforeEach`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: FAIL — `controller.exportCsv is not a function`

- [ ] **Step 3: Add the `exportCsv` endpoint**

Modify `src/camera-registry/camera-registry.controller.ts` — add the imports:

```typescript
import { Res } from '@nestjs/common';
import type { Response } from 'express';
import { CameraExportService } from './export/camera-export.service';
```

(merge `Res` into the existing `@nestjs/common` import)

Update the constructor to also inject `CameraExportService`:

```typescript
  constructor(
    private readonly cameraRegistryService: CameraRegistryService,
    private readonly bulkUploadService: BulkUploadService,
    private readonly cameraExportService: CameraExportService,
  ) {}
```

Add the endpoint. **This must be declared before `@Get(':id')`** for the same route-ordering reason as `bulk/:jobId` — `/cameras/export` would otherwise incorrectly match `getOne`'s `:id` pattern with `id='export'`:

```typescript
  @Roles('admin', 'auditor')
  @Get('export')
  async exportCsv(
    @Query() query: CameraQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const cameras = await this.cameraRegistryService.listCamerasUnpaginated(
      {
        departmentId: query.departmentId,
        cameraType: query.cameraType,
        integrationScore: query.integrationScore,
        currentStatus: query.currentStatus,
        isActive: query.isActive,
      },
      currentUser,
    );

    const csv = this.cameraExportService.generateCsv(cameras);
    const timestamp = new Date().toISOString().slice(0, 10);

    response.setHeader('Content-Type', 'text/csv');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="cameras-export-${timestamp}.csv"`,
    );
    response.send(csv);
  }
```

**Route ordering note:** verify in the final file that `exportCsv` (`@Get('export')`) and `getBulkJobStatus` (`@Get('bulk/:jobId')`) both appear before `getOne` (`@Get(':id')`) in the class body — NestJS matches routes in declaration order within a controller, and the more specific literal paths (`export`, `bulk/:jobId`) must win against the general `:id` pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Manually verify export against the real database**

```bash
npm run start:dev
```

Create a test camera, then:

```bash
curl -s -o /tmp/export-test.csv -w "\nHTTP:%{http_code}\n" http://localhost:3000/api/v1/cameras/export -H "Authorization: Bearer <accessToken>"
cat /tmp/export-test.csv
```

Expected: `200`, and `/tmp/export-test.csv` contains a header row plus the test camera's data. Confirm `/cameras/export` did NOT get routed to `getOne` (which would 404 or error trying to parse `"export"` as a camera ID) — the successful CSV output itself confirms correct routing. Clean up the test camera and the temp file afterward. Stop the dev server.

- [ ] **Step 6: Stop — do not commit**

---

## Task 10: End-to-End Tests — Full Upload Lifecycle, Export, Re-upload Idempotency

**Files:**
- Create: `test/camera-bulk-upload.e2e-spec.ts`
- Create: `test/camera-export.e2e-spec.ts`

**Interfaces:**
- Consumes: the full bulk-upload and export flow (Tasks 1-9).

- [ ] **Step 1: Write the bulk upload e2e test**

Create `test/camera-bulk-upload.e2e-spec.ts`. Uses the same real department IDs already established in `test/camera-registry.e2e-spec.ts` (HOME, RTO):

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Camera Bulk Upload (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-bulk-admin@sentinel.local';
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME
  const DEPARTMENT_B_ID = '1de2e83f-ab28-4d0a-8825-05fdc9e008c3'; // RTO

  let adminToken: string;

  async function cleanup() {
    const users = await prisma.appUser.findMany({ where: { email: adminEmail } });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.bulkUploadJob.deleteMany({ where: { createdBy: { in: userIds } } });
    }
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Bulk Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: adminEmail } });
  }

  async function waitForJobCompletion(jobId: string, token: string, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/cameras/bulk/${jobId}`)
        .set('Authorization', `Bearer ${token}`);
      if (response.body.status === 'completed' || response.body.status === 'failed') {
        return response.body;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
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

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('uploads a CSV with mixed valid/invalid rows, processes in the background, and reports correct results', async () => {
    const csvContent = [
      'name,departmentCode,latitude,longitude,cameraType,brand,model,addressText,installedAt',
      'E2E Bulk Camera 1,HOME,23.01,72.51,ip,,,,',
      'E2E Bulk Camera 2,RTO,22.51,71.51,analog,,,,',
      'E2E Bulk Camera Bad Dept,ZZZZ,23.0,72.0,ip,,,,',
      ',HOME,23.0,72.0,ip,,,,', // missing name
    ].join('\n');

    const uploadResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csvContent), 'test-cameras.csv');

    expect(uploadResponse.status).toBe(202);
    expect(uploadResponse.body.jobId).toEqual(expect.any(String));

    const finalStatus = await waitForJobCompletion(uploadResponse.body.jobId, adminToken);

    expect(finalStatus.status).toBe('completed');
    expect(finalStatus.totalRows).toBe(4);
    expect(finalStatus.succeededCount).toBe(2);
    expect(finalStatus.failedCount).toBe(2);
    expect(finalStatus.rowErrors).toHaveLength(2);
    expect(finalStatus.rowErrors.some((e: any) => e.row === 4 && e.error.includes('ZZZZ'))).toBe(
      true,
    );

    const createdCameras = await prisma.camera.findMany({
      where: { name: { in: ['E2E Bulk Camera 1', 'E2E Bulk Camera 2'] } },
    });
    expect(createdCameras).toHaveLength(2);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'create_camera', entityType: 'camera' },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(2);
  });

  it('re-uploading the same CSV updates existing rows instead of creating duplicates', async () => {
    const csvContent = [
      'name,departmentCode,latitude,longitude,cameraType,brand,model,addressText,installedAt',
      'E2E Bulk Camera 1,HOME,25.0,75.0,ip,NewBrand,,,',
    ].join('\n');

    const uploadResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csvContent), 'test-cameras-2.csv');

    const finalStatus = await waitForJobCompletion(uploadResponse.body.jobId, adminToken);
    expect(finalStatus.succeededCount).toBe(1);

    const matchingCameras = await prisma.camera.findMany({
      where: { name: 'E2E Bulk Camera 1' },
    });
    expect(matchingCameras).toHaveLength(1); // still just one, not two
    expect(matchingCameras[0].brand).toBe('NewBrand');

    const updateAuditRows = await prisma.auditLog.findMany({
      where: { action: 'update_camera', entityType: 'camera' },
    });
    expect(updateAuditRows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a bulk upload for a non-admin/field_officer role', async () => {
    const viewerEmail = 'e2e-bulk-viewer@sentinel.local';
    await prisma.appUser.deleteMany({ where: { email: viewerEmail } });
    await prisma.appUser.create({
      data: {
        email: viewerEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'dept_viewer',
        departmentId: DEPARTMENT_A_ID,
      },
    });
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: viewerEmail, password });

    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras/bulk')
      .set('Authorization', `Bearer ${viewerLogin.body.accessToken}`)
      .attach('file', Buffer.from('name,departmentCode\n'), 'test.csv');

    expect(response.status).toBe(403);

    await prisma.appUser.deleteMany({ where: { email: viewerEmail } });
  });

  it('rejects a CSV with missing required headers before creating any job', async () => {
    const badCsv = 'name,departmentCode\nCamera,HOME\n';

    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(badCsv), 'bad.csv');

    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent job ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras/bulk/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the bulk upload e2e test**

Run: `npm run test:e2e -- camera-bulk-upload.e2e-spec.ts`
Expected: PASS, all 5 tests green. If the background job doesn't complete within the polling timeout, check the server logs for errors in `processRowsInBackground` — do not increase the timeout to paper over a real failure.

- [ ] **Step 3: Write the export e2e test**

Create `test/camera-export.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { parse } from 'csv-parse/sync';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Camera Export (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-export-admin@sentinel.local';
  const auditorEmail = 'e2e-export-auditor@sentinel.local';
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME

  let adminToken: string;
  let auditorToken: string;

  async function cleanup() {
    const users = await prisma.appUser.findMany({
      where: { email: { in: [adminEmail, auditorEmail] } },
    });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Export Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, auditorEmail] } } });
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
      data: { email: auditorEmail, passwordHash: await bcrypt.hash(password, 10), role: 'auditor' },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;

    const auditorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: auditorEmail, password });
    auditorToken = auditorLogin.body.accessToken;

    await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Export Camera A',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('exports a CSV containing the created camera, accessible to an admin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');

    const records = parse(response.text, { columns: true });
    expect(records.some((r: any) => r.name === 'E2E Export Camera A')).toBe(true);
  });

  it('is accessible to an auditor', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras/export')
      .set('Authorization', `Bearer ${auditorToken}`);

    expect(response.status).toBe(200);
  });

  it('respects filters, e.g. cameraType=analog returning none of the ip test cameras', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras/export?cameraType=analog')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const records = parse(response.text, { columns: true });
    expect(records.some((r: any) => r.name === 'E2E Export Camera A')).toBe(false);
  });

  it('rejects export for a field_officer (not in the admin/auditor role pair)', async () => {
    const fieldOfficerEmail = 'e2e-export-field-officer@sentinel.local';
    await prisma.appUser.deleteMany({ where: { email: fieldOfficerEmail } });
    await prisma.appUser.create({
      data: {
        email: fieldOfficerEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'field_officer',
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fieldOfficerEmail, password });

    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras/export')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(response.status).toBe(403);

    await prisma.appUser.deleteMany({ where: { email: fieldOfficerEmail } });
  });
});
```

- [ ] **Step 4: Run the export e2e test**

Run: `npm run test:e2e -- camera-export.e2e-spec.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Stop — do not commit**

---

## Final Task: Full Regression Pass

**Files:** none created — verification only

- [ ] **Step 1: Run the entire unit test suite**

```bash
cd model1-service
npm test
```

Expected: every suite from this build plus every suite from the prior camera-registry core build and Phase 1-4 passes.

- [ ] **Step 2: Run the entire e2e test suite**

```bash
npm run test:e2e
```

Expected: all e2e suites pass, including the two new ones from Task 10.

- [ ] **Step 3: Run the TypeScript compiler**

```bash
npx tsc --noEmit -p tsconfig.build.json
```

Expected: zero errors. This has caught real bugs jest's per-file compilation missed in every prior plan — do not skip it.

- [ ] **Step 4: Manually verify the full upload → poll → export cycle one more time, end to end**

```bash
npm run start:dev
```

Upload a real CSV (reuse the one from Task 6 Step 5 or Task 10's e2e fixtures), poll its job status via curl until `completed`, then run `GET /cameras/export` and confirm the uploaded cameras appear in the exported CSV. Clean up all test data (cameras, audit_log rows, the bulk_upload_job row, any test users) afterward via psql. Stop the dev server.

- [ ] **Step 5: Stop — do not commit. Report completion to the user.**

Summarize: what was built (background job bulk upload handling up to 10,000 rows without blocking the event loop, job status polling, CSV export), what passed (exact test counts), and confirm the refactored `applyCameraFieldChanges`/`writeAuditLogEntry` functions are now the shared foundation both single-camera and bulk-camera operations use for data mutation and audit logging respectively.
