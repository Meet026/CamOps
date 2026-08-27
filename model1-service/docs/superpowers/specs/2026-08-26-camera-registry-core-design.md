# Camera Registry — Core CRUD + GPS Design

**Status:** Approved by user 2026-08-26. Ready for implementation planning.

**Spec sources:** `../../../../Model1-PRD.md` (FR-1, FR-2, Section 5 folder layout, Section 6a architecture-review addendum, Section 8 API contract, Section 9 NFRs), `../../../../Model1-Low-Level-Design.md` (Section 1 module structure, Section 4 onboarding flow).

## Scope

This is the **first of two planned builds** for the `camera-registry` module. It covers:

- Create a single camera (manual entry)
- List cameras with filters and pagination
- Get one camera's detail
- Update camera fields
- Soft-delete a camera
- GPS coordinates stored as a real PostGIS `GEOGRAPHY(POINT, 4326)`, not plain lat/long columns
- `dept_viewer` row-level scoping via the existing `applyDeptScope` helper
- Audit logging (before/after) on every mutating endpoint, via the existing `@Audit(...)` decorator + `AuditLogInterceptor` + `AuditContextService` pattern established in Phase 1-4

**Explicitly out of scope for this build** (follow-up designs, not built now):

- Bulk CSV/Excel upload with per-row validation and upsert (FR-1)
- CSV export (FR-1)
- Photo upload at onboarding (FR-2)
- Anything from `integration-scoring` (FR-3) — brand/model fields are accepted and stored, but no scoring logic runs; `onvifStatus`/`integrationScore`/`dataConfidence` stay at their database defaults
- Anything from `health-monitoring` or `gis` (later modules)

## Why Split Here

`camera-registry`'s full PRD scope (FR-1 + FR-2) spans single-camera CRUD, bulk upload with its own validation/upsert semantics, CSV export, and photo upload — each a meaningfully separate piece of work. Building core CRUD + GPS first produces a working, testable module on its own, and bulk upload will directly reuse the `createCamera` code path this build establishes rather than duplicating it.

## Architecture

A new module at `src/camera-registry/`, following the exact folder layout from PRD Section 5:

```
camera-registry/
├── camera-registry.module.ts
├── camera-registry.controller.ts
├── camera-registry.service.ts
└── dto/
    ├── create-camera.dto.ts
    ├── update-camera.dto.ts
    └── camera-query.dto.ts
```

**Module dependencies:** `PrismaModule` (global, already available everywhere), `AuditContextModule` (must be imported explicitly — established in the audit before/after work), `common/scoping`'s `applyDeptScope` (a plain function import, not a module dependency), `common/decorators`' `@Roles()` and `@Audit()`.

**No new database migration.** The `camera` table already has every column this build needs (`location_geo`, `ip_address`/`rtsp_port`/`stream_path` are out of scope here — those belong to `health-monitoring`).

## Data Flow

### Create — `POST /cameras`

1. `CreateCameraDto` validates: `name` (string, required), `departmentId` (UUID, required), `latitude`/`longitude` (`@IsLatitude()`/`@IsLongitude()`, required), `cameraType` (`@IsIn(['analog', 'ip'])`, required), `brand`/`model`/`addressText`/`installedAt` (all optional).
2. `CameraRegistryService.createCamera(dto, currentUser)`:
   - Runs one parameterized `prisma.$executeRaw` `INSERT INTO camera (...) VALUES (..., ST_SetSRID(ST_MakePoint($longitude, $latitude), 4326), ...)`.
   - `departmentId` foreign-key violations are caught (Prisma error code `P2003` on raw queries surfaces as a generic error — the service checks for the FK constraint name and translates it to a `BadRequestException` with a clear message) rather than pre-checking department existence with a separate query.
   - Follows with a `$queryRaw SELECT` (see "Read Query Shape" below) to return the newly created row in full, since a raw `INSERT` doesn't return Prisma-shaped data the way `prisma.camera.create()` would.
   - `onvifStatus`, `integrationScore`, `dataConfidence`, `currentStatus` are left unset in the `INSERT`, taking their database column defaults (`'unknown'`, `'needs_verification'`, `'self_reported'`, `'unknown'` respectively).
3. Controller: `@Roles('admin', 'field_officer')`, `@Audit('create_camera', 'camera')`.

### List — `GET /cameras`

1. `CameraQueryDto extends PaginationDto`, adding optional filters: `departmentId` (UUID), `cameraType` (`'analog' | 'ip'`), `integrationScore` (`'easy' | 'medium' | 'hard' | 'needs_verification'`), `currentStatus` (`'online' | 'offline' | 'unknown'`), `isActive` (boolean, **optional with no default** — omitted means both active and inactive cameras are returned; explicitly `true`/`false` narrows to just that subset).
2. Service builds one parameterized `$queryRaw` selecting every camera column plus `ST_X(location_geo::geometry) AS longitude, ST_Y(location_geo::geometry) AS latitude`, with a dynamically constructed `WHERE` clause from whichever filters were provided (parameterized, never string-concatenated) plus `LIMIT`/`OFFSET` from pagination.
3. For `dept_viewer`, `applyDeptScope` injects `departmentId` into the filter set before the query builds — this is the **one required choke point**, per the existing security design; the caller can never override it by also passing their own `departmentId` filter, since `applyDeptScope` always wins.
4. Raw query results are manually mapped from snake_case/raw column names to the camelCase shape the rest of the API uses (Prisma's `$queryRaw` doesn't auto-map the way the query builder does).

### Get One — `GET /cameras/:id`

1. Same raw-query shape as List, filtered to `WHERE camera_id = $1`, plus the same `applyDeptScope` treatment for `dept_viewer`.
2. If no row is found — either because the ID genuinely doesn't exist, **or** because a `dept_viewer` requested a camera outside their department — the response is `404 Not Found` in both cases, with no distinguishing detail. This is deliberate: the PRD's acceptance criteria require that a `dept_viewer` cannot determine another department's camera exists at all, even indirectly (a 403 would leak existence; 404 does not).

### Update — `PATCH /cameras/:id`

1. `UpdateCameraDto` — all fields optional, same validation rules as create where applicable.
2. Service reads the existing row first via the same raw `SELECT` shape used by Get One (also enforcing `applyDeptScope` for `dept_viewer` — an update reaches the same 404-not-403 handling for out-of-scope cameras).
3. Builds one dynamic parameterized `UPDATE`: always sets whichever plain fields are present in the DTO; additionally sets `location_geo = ST_SetSRID(ST_MakePoint($longitude, $latitude), 4326)` only if **both** `latitude` and `longitude` are present in the DTO. `UpdateCameraDto` enforces this pairing with a custom `@ValidateIf`-based rule: if either `latitude` or `longitude` is present, the other becomes required — a lone coordinate is rejected as a 400 with a clear message, since it's meaningless on its own (there's no way to know which axis to leave unchanged).
4. Compares old vs. new values for whichever fields actually changed and calls `auditContext.setChanges(request, before, after)` with only the changed fields (following the `UsersService.updateRole` pattern exactly) — not the entire record, keeping `audit_log.metadata` small.
5. Controller: `@Roles('admin', 'field_officer')`, `@Audit('update_camera', 'camera')`.

### Soft-Delete — `DELETE /cameras/:id`

1. No DTO — the route just takes `:id`.
2. Service reads the existing row (via the same Prisma `findUnique`-shaped lookup `UsersService` uses, since this doesn't touch the spatial column — a plain Prisma call is sufficient here, no raw SQL needed), throws `NotFoundException` if missing or out-of-scope for the caller.
3. Runs a normal `prisma.camera.update({ where: { cameraId }, data: { isActive: false } })` — no raw SQL required since this doesn't touch `location_geo`.
4. Records `auditContext.setChanges(request, { isActive: true }, { isActive: false })`.
5. Controller: `@Roles('admin')` only, `@Audit('delete_camera', 'camera')`.
6. Returns `204 No Content` — matches the existing `logout` endpoint's convention for a mutating action with no meaningful response body.

## Read Query Shape (shared by Create's return, List, Get One, Update's before-read)

```sql
SELECT
  camera_id, department_id, name, address_text, camera_type, brand, model,
  onvif_status, onvif_source, integration_score, data_confidence, photo_url,
  current_status, installed_at, is_active, created_by, created_at, updated_at,
  ST_X(location_geo::geometry) AS longitude,
  ST_Y(location_geo::geometry) AS latitude
FROM camera
WHERE <dynamic, parameterized conditions>
```

This exact column list (everything except `ip_address`/`rtsp_port`/`stream_path`, which belong to the future `health-monitoring` module's concerns and aren't part of this build's DTOs) is centralized in one private service helper method so it isn't duplicated across Create/List/Get/Update.

## Error Handling

- DTO validation failures → 400, standard `class-validator` field-level messages (existing global `ValidationPipe` behavior, no new code needed).
- `departmentId` doesn't exist (FK violation on create) → 400 with a clear message, not a raw Postgres error leaking through (existing global `AllExceptionsFilter` would otherwise turn this into a generic 500 — this needs explicit handling in the service, see Create above).
- Camera not found, or found but out-of-scope for a `dept_viewer` → 404, identical response in both cases.
- Everything else (unexpected DB errors, etc.) → falls through to the existing global `AllExceptionsFilter`, 500, no stack trace leaked, logged with the request's correlation ID — no new code needed, this is already global behavior.

## Roles (from PRD Section 8, applied exactly)

| Endpoint | Roles |
|---|---|
| `POST /cameras` | `admin`, `field_officer` |
| `GET /cameras` | all four roles (`dept_viewer` scoped) |
| `GET /cameras/:id` | all four roles (`dept_viewer` scoped) |
| `PATCH /cameras/:id` | `admin`, `field_officer` |
| `DELETE /cameras/:id` | `admin` only |

## Testing

- **Unit tests, service:** mocked `PrismaService.$executeRaw`/`$queryRaw`/`camera.update`, asserting the *exact* SQL parameters passed (not just "was called with something") for create, list (with each filter individually and combined), get-one, update (both with and without coordinate changes, and the audit before/after call), and soft-delete. Includes a `dept_viewer` scoping test proving `applyDeptScope`'s output actually reaches the query.
- **Unit tests, controller:** delegation only (matches the existing `UsersController` pattern) — controller has no logic of its own to test beyond "did it call the right service method with the right arguments."
- **E2E test:** one full cycle against the real database — create a camera with real coordinates, list it back and confirm it appears with correct lat/long, get it by ID, update its name and location, soft-delete it, confirm it still appears in an unfiltered list but not in `isActive=true`. Plus one dedicated `dept_viewer` cross-department test: a `dept_viewer` in Department A cannot see, by any means (list or direct ID), a camera created in Department B — the PRD's explicit acceptance criterion.

## Open Questions

None — every design decision was resolved during brainstorming with the user (see the design's approval message). If gaps surface during implementation, they'll be handled as plan-defect rulings per the subagent-driven-development process, following the same pattern as Phase 1-4.
