# Camera Bulk Upload & CSV Export Design

**Status:** Approved by user 2026-08-26. Ready for implementation planning.

**Spec sources:** `../../../../Model1-PRD.md` (FR-1's bulk upload + export requirements, Section 6a point 5 on upsert idempotency, Section 6a point 9 on rate limiting, Section 8 API contract), the already-built `camera-registry` module (`src/camera-registry/`) from the core CRUD design.

## Scope

This build covers the remaining two `camera-registry` endpoints from FR-1:

- `POST /cameras/bulk` — CSV bulk upload, processed as a background job, upserting on `(department_id, name)`
- `GET /cameras/bulk/:jobId` — job status/progress/results polling
- `GET /cameras/export` — synchronous CSV export of the filtered camera list

**Explicitly out of scope:** Excel (`.xlsx`) parsing (CSV only for v1), any external job queue infrastructure (Redis/BullMQ — see "Why In-Process Batching" below), retrying a job automatically after a server restart mid-processing.

## Why This Needed Its Own Design (Beyond the Core CRUD Build)

The PRD's literal requirement ("validate every row and report per-row errors, not fail the whole batch") was originally scoped as a synchronous request/response operation. During design, the user specified a concrete non-functional requirement — smoothly handling a 10,000-row upload without blocking the server — which changes the shape of the solution from "one HTTP request, one response" to "accept the file, process in the background, poll for results." This is the industry-standard pattern for bulk/long-running operations (Stripe, GitHub, and AWS's bulk APIs all use this shape).

## Database Schema Change

One new table, added via `npx prisma migrate dev` (per the project's established schema-change policy — PRD Section 6):

```sql
CREATE TABLE bulk_upload_job (
    job_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    total_rows        INTEGER NOT NULL,
    processed_rows    INTEGER NOT NULL DEFAULT 0,
    succeeded_count   INTEGER NOT NULL DEFAULT 0,
    failed_count      INTEGER NOT NULL DEFAULT 0,
    row_errors        JSONB,                    -- array of {row: number, error: string}
    created_by        UUID REFERENCES app_user(user_id),
    department_scope  UUID REFERENCES department(department_id),
    created_at        TIMESTAMPTZ DEFAULT now(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_bulk_upload_job_created_by ON bulk_upload_job (created_by, created_at DESC);
```

`department_scope` is nullable and informational only (records which department most rows targeted, for future reporting) — it is never used for access control on `GET /cameras/bulk/:jobId`, since any `admin`/`field_officer` can check any job's status per the roles table below.

Postgres itself is the durability layer for job state — no Redis, no external queue. This is a deliberate scale trade-off for this project's size, not an oversight: if real load ever exceeds what in-process batching handles, a real queue is the natural upgrade path, but adding that infrastructure now would be premature for a project with no queue system anywhere else.

## Data Flow

### Upload — `POST /cameras/bulk`

1. Accepts a `multipart/form-data` file upload (field name `file`).
2. **Structural validation, synchronous, before any job is created:**
   - File must be present, non-empty, `.csv` extension.
   - Header row must contain exactly: `name, departmentCode, latitude, longitude, cameraType, brand, model, addressText, installedAt`.
   - Failure here returns `400` immediately — no job is ever created for a structurally broken file.
3. On structural success: create a `bulk_upload_job` row (`status='pending'`, `total_rows` = data row count), return `202 Accepted` with `{ jobId }` immediately.
4. **Background processing** (does not block the HTTP response, already sent):
   - Parse the CSV via `csv-parse` (streaming), in batches of 50 rows.
   - Load the full `department` table once at job start (code → id map), reused for every row — departments don't change mid-job, so this avoids N department lookups.
   - For each row in a batch (bounded concurrency: 5 at a time within the batch):
     - Validate against `CreateCameraDto`'s existing `class-validator` rules, plus resolve `departmentCode` → `departmentId` against the cached map.
     - On validation failure: append `{ row, error }` to the job's accumulating error list, increment `failed_count`.
     - On success: check for an existing camera on `(departmentId, name)`. If none exists, build a `CreateCameraDto` from the row and call `CameraRegistryService.createCamera(dto, uploaderUserId)` directly — the exact same method the single-camera `POST /cameras` endpoint calls, so a row that creates a camera behaves identically either way. `createCamera` itself has no audit side effect (see "Audit Logging" below — the `@Audit` decorator that normally triggers a write lives on the *controller* route, not the service method, so calling the service method directly from the bulk job does not accidentally fire a request-scoped audit path that doesn't exist here). The bulk job writes its own audit entry immediately after, using the row's own before (`null`, since this is a create) and after values.
     - If a camera already exists on `(departmentId, name)`: build an `UpdateCameraDto` from the row's fields, then call `CameraRegistryService.applyCameraFieldChanges(cameraId, dto, existing)` — the data-mutation logic factored out of `updateCamera` (see "Audit Logging" below for the exact refactor), which does the diffing and the direct Prisma/raw-SQL update (including the spatial `ST_SetSRID`/`ST_MakePoint` write when latitude/longitude changed) without touching `AuditContextService`. It returns the `{ before, after }` pair if anything changed, or `null` for a no-op row. The bulk job then writes its own audit entry with that result, the same way it does for creates.
     - Either way (create or update), if nothing actually needed to change (an update row that exactly matches the existing camera), no audit entry is written for that row, matching the single-camera endpoint's existing "no-op update writes nothing" behavior.
   - After each batch: update `processed_rows`/`succeeded_count`/`failed_count`/`row_errors` on the job row in one write (not per-row), then yield to the event loop (`await new Promise(resolve => setImmediate(resolve))`) before starting the next batch, so other concurrent requests get interleaved processing time.
   - When all rows are processed: set `status='completed'`, `completed_at=now()`.
   - If an unexpected error terminates the whole job (not a per-row validation failure, but something like a lost DB connection): set `status='failed'`, leave `row_errors` reflecting whatever was captured before the failure.
5. Controller: `@Roles('admin', 'field_officer')`, throttled 5 requests/min per PRD Section 6a point 9 (same tier as login).

### Job Status — `GET /cameras/bulk/:jobId`

1. Returns the current `bulk_upload_job` row, mapped to camelCase: `{ jobId, status, totalRows, processedRows, succeededCount, failedCount, rowErrors, createdAt, completedAt }`.
2. `404` if the job ID doesn't exist.
3. Controller: `@Roles('admin', 'field_officer')` — not scoped to the job's creator; any admin/field_officer can check any job, since these roles routinely need visibility into each other's uploads (e.g. an admin checking on a field officer's upload).

### Export — `GET /cameras/export`

1. Accepts `CameraQueryDto`'s filter fields (`departmentId`, `cameraType`, `integrationScore`, `currentStatus`, `isActive`) but **not** pagination — export always returns the complete filtered set in one response, not one page.
2. `dept_viewer` scoping is **not applicable** here — `auditor` and `admin` are the only two roles with export access, and neither is department-scoped (an `auditor`'s whole purpose is cross-department audit visibility, matching FR-6's role definitions).
3. Reuses the same `CAMERA_SELECT_SQL`-based read logic as `listCameras`, without the `LIMIT`/`OFFSET`.
4. Converts the resulting rows to CSV text (headers matching the export's own column set — a superset of the upload columns, including the read-only fields like `cameraId`, `onvifStatus`, `integrationScore`, `currentStatus`, `isActive`, `createdAt`).
5. Response: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="cameras-export-<ISO-date>.csv"`, raw CSV body.
6. Controller: `@Roles('admin', 'auditor')` — this is the one endpoint in the module with a role pair that doesn't include `field_officer`, matching the PRD's API contract table exactly.
7. This is a synchronous, no-job-needed operation — the row counts here are the size of a filtered query result, not raw file uploads, so there's no risk of blocking the event loop the way a 10,000-row upload would.

## Audit Logging Across Many Rows in One Request

The existing `AuditLogInterceptor` fires once per HTTP request, reading a single before/after pair from `AuditContextService`, which is keyed off a live `request` object (`request.auditChanges`). This mechanism is unchanged and continues to be exactly how the single-camera `POST /cameras` and `PATCH /cameras/:id` endpoints get audited, since those run inside a real request/response cycle.

A bulk upload's background processing is **not** driven by that interceptor at all — it runs after the `202` response has already been sent, so by the time any row is processed, there is no request/response cycle left for an interceptor to hook into, and no live `request` object to key state off of. Rather than stretch the request-scoped mechanism to cover a case where there is no request, the actual `audit_log` write logic already living inside `AuditLogInterceptor` (build the `{ userId, action, entityType, metadata }` row and call `prisma.auditLog.create`, with the same fire-and-forget error handling) is extracted into a small shared function:

```typescript
writeAuditLogEntry(
  prisma: PrismaService,
  userId: string | null,
  action: string,
  entityType: string,
  metadata: Record<string, unknown>,
): void  // fire-and-forget, same as today — never awaited by the caller
```

in `src/common/audit/write-audit-log-entry.ts`. `AuditLogInterceptor` is refactored to call this function with the single before/after pair it reads from `AuditContextService`, instead of building the `prisma.auditLog.create` call inline as it does today — its externally observable behavior is unchanged. The bulk-upload background job calls the same function directly, once per row that actually resulted in a create or update, with that row's own before/after values and the uploading user's ID (captured once at job start, before the request object goes away). A row whose update was a no-op writes no audit entry, same as the single-camera endpoint.

This keeps `create_camera`/`update_camera` audit entries from bulk upload byte-for-byte identical in shape to ones created through the single-camera endpoints — same action names, same before/after structure, same one function that knows how to write an `audit_log` row — while being honest that a background job has no request to route through an interceptor at all, and that the service-layer data-mutation logic itself (creating/updating a camera row) carries no audit side effect of its own in either code path; the audit write is always triggered by whichever caller has the context to trigger it (the interceptor for HTTP requests, the bulk job directly for background rows).

**One small refactor to already-shipped code this requires:** `CameraRegistryService.updateCamera` and `softDeleteCamera` currently call `this.auditContext.setChanges(request, before, after)` directly inside the method body, coupling the data-mutation logic to the request-scoped audit mechanism. The field-level diffing logic inside `updateCamera` (comparing old vs. new values, building the SQL `SET` clauses) is extracted into a new private method, `applyCameraFieldChanges(cameraId, dto, existing): Promise<{ before, after } | null>` (returns `null` if nothing actually changed), that does the DB write but does **not** call `setChanges` itself. `updateCamera` becomes a thin wrapper: call `applyCameraFieldChanges`, then call `this.auditContext.setChanges(request, before, after)` with its result if non-null, exactly preserving today's single-camera behavior. The bulk job's update path calls `applyCameraFieldChanges` directly and passes its result to `writeAuditLogEntry` instead. `createCamera` needs no equivalent change, since it already has no audit call inside it — the `@Audit('create_camera', 'camera')` decorator on the controller route is what triggers its audit entry today, and the bulk job's create path calls `writeAuditLogEntry` in its place for the same reason.

## New Dependencies

- `csv-parse` — streaming CSV parsing (upload).
- `csv-stringify` — CSV generation (export). Both from the same maintained `csv` package family already widely used in the Node ecosystem; no heavier "Excel-capable" library needed since `.xlsx` is out of scope.
- `@nestjs/platform-express`'s built-in `FileInterceptor` (from `@nestjs/platform-express`, already a transitive dependency of the NestJS scaffold) for handling the `multipart/form-data` upload — no new package needed for this part.

## Roles Summary

| Endpoint | Roles | Notes |
|---|---|---|
| `POST /cameras/bulk` | `admin`, `field_officer` | 5 req/min throttle; 202 + jobId |
| `GET /cameras/bulk/:jobId` | `admin`, `field_officer` | Not scoped to job creator |
| `GET /cameras/export` | `admin`, `auditor` | The one endpoint without `field_officer` |

## Testing

- **Unit tests, CSV parsing/structural validation:** correct header detection, rejection of malformed/empty files, rejection of a non-`.csv` upload.
- **Unit tests, row validation:** each `CreateCameraDto` rule fires correctly per row; `departmentCode` resolution succeeds/fails correctly against a mocked department map.
- **Unit tests, batch processing logic:** mocked Prisma, verifying correct create-vs-update dispatch (matching on `(departmentId, name)`), correct error accumulation shape, correct progress-counter updates per batch (not per row), and the event-loop-yield behavior between batches.
- **Unit tests, job status service:** returns the mapped job shape, 404s on unknown job ID.
- **Unit tests, export:** correct CSV text generation from a set of camera rows, correct headers/content-disposition.
- **E2E test, upload → poll → verify:** upload a small real CSV (~10 rows: some valid creates, one valid update of an existing camera, a couple of deliberately invalid rows — bad department code, missing required field), poll `GET /cameras/bulk/:jobId` until `status='completed'`, assert final counts match expectations, assert the row-level errors are present and correctly numbered, and assert the actual `camera` and `audit_log` rows exist correctly in the database for succeeded rows.
- **E2E test, export:** create a few cameras with distinguishing field values, call `GET /cameras/export` with a filter, parse the returned CSV text, and confirm it contains exactly the expected filtered rows with correct data.
- **E2E test, re-upload idempotency:** upload the same CSV twice; the second upload's succeeded rows should be updates (not duplicate creates) — confirmed by camera count staying the same and `updated_at` changing.

## Open Questions

None — every design decision was resolved during brainstorming with the user, including the explicit non-functional requirement (10,000-row smooth handling) that shaped the background-job architecture.
