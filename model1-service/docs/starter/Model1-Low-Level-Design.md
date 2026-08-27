# Model 1 — Low-Level Architecture Design
### Registry & GIS Foundation | NestJS Modular Monolith

This document goes one level deeper than the high-level architecture — actual folder structure, database tables, API contracts, and step-by-step internal flows for each feature. Use this as the blueprint to start scaffolding code.

> **Updated post-architecture-review** (see `Model1-PRD.md` Section 6a for the full rationale): refresh-token revocation, `camera_status_history` surrogate key, health-check `ip_address`/`rtsp_port`/`stream_path` columns, enforced `dept_viewer` scoping helper, bulk-upload upsert idempotency, a pinned Claude API contract for AI lookup + vision-based OCR, Cloudinary photo storage, rate limiting, pagination limits, `/api/v1` prefix, correlation IDs, and a `/livez` liveness endpoint. Every section below reflects these decisions; changed sections are marked inline.

---

## 1. NestJS Module & Folder Structure

NestJS organizes code into **modules** (self-contained feature units, each with its own controller, service, and data-access logic). Here's the full folder layout:

```
model1-service/
├── src/
│   ├── main.ts                        # App bootstrap
│   ├── app.module.ts                  # Root module, imports all feature modules
│   │
│   ├── common/                        # Shared across all modules
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts      # Verifies login token on protected routes
│   │   │   └── roles.guard.ts         # Checks role-based permissions (RBAC)
│   │   ├── decorators/
│   │   │   └── roles.decorator.ts     # @Roles('admin', 'field-officer') annotation
│   │   ├── interceptors/
│   │   │   └── audit-log.interceptor.ts  # Auto-logs who did what, when (+ correlation ID)
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts  # Standardized error responses
│   │   ├── middleware/
│   │   │   └── correlation-id.middleware.ts  # Request ID → logs + audit_log.metadata (post-review addition)
│   │   ├── dto/
│   │   │   └── pagination.dto.ts      # Reusable page/limit query params — default 25, max 100 (post-review addition)
│   │   ├── scoping/
│   │   │   └── dept-scope.helper.ts   # applyDeptScope() — the ONE enforced choke point for dept_viewer row scoping (post-review addition)
│   │   └── storage/
│   │       ├── storage-provider.interface.ts   # save() / getUrl() (post-review addition)
│   │       └── cloudinary-storage.provider.ts  # only implementation for v1
│   │
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts         # POST /auth/login, /auth/refresh, /auth/logout
│   │   ├── auth.service.ts            # Password check, JWT issuing
│   │   ├── refresh-token.service.ts   # Issues/validates/revokes hashed refresh tokens (post-review addition)
│   │   └── strategies/
│   │       └── jwt.strategy.ts
│   │
│   ├── camera-registry/               # MODULE 1: Core camera CRUD + onboarding
│   │   ├── camera-registry.module.ts
│   │   ├── camera-registry.controller.ts
│   │   ├── camera-registry.service.ts
│   │   ├── entities/
│   │   │   ├── camera.entity.ts
│   │   │   └── department.entity.ts
│   │   ├── dto/
│   │   │   ├── create-camera.dto.ts
│   │   │   ├── update-camera.dto.ts
│   │   │   ├── bulk-upload-camera.dto.ts
│   │   │   └── camera-query.dto.ts
│   │   └── repositories/
│   │       └── camera.repository.ts
│   │
│   ├── integration-scoring/           # MODULE 2: ONVIF/vendor lookup + AI fallback
│   │   ├── integration-scoring.module.ts
│   │   ├── integration-scoring.controller.ts
│   │   ├── integration-scoring.service.ts
│   │   ├── entities/
│   │   │   ├── vendor-lookup.entity.ts       # Your curated brand/model → ONVIF table
│   │   │   └── scoring-verification.entity.ts # Human-verified AI guesses
│   │   ├── dto/
│   │   │   └── score-camera.dto.ts
│   │   └── providers/
│   │       ├── ai-lookup.provider.ts   # Claude API (claude-haiku-4-5) — brand/model → ONVIF guess
│   │       └── ocr.provider.ts         # Thin wrapper over the same Claude vision call — no separate OCR engine (post-review decision)
│   │
│   ├── health-monitoring/             # MODULE 3: Uptime tracking + history
│   │   ├── health-monitoring.module.ts
│   │   ├── health-monitoring.controller.ts
│   │   ├── health-monitoring.service.ts
│   │   ├── entities/
│   │   │   └── camera-status-history.entity.ts   # TimescaleDB hypertable, surrogate BIGSERIAL id (post-review addition)
│   │   ├── jobs/
│   │   │   └── health-check.cron.ts    # Scheduled job; skips cameras with ip_address IS NULL, TCP port check only
│   │   └── dto/
│   │       └── status-query.dto.ts
│   │
│   ├── gis/                           # MODULE 4: Map data, gap analysis, overlap detection
│   │   ├── gis.module.ts
│   │   ├── gis.controller.ts
│   │   ├── gis.service.ts
│   │   ├── dto/
│   │   │   ├── map-bounds-query.dto.ts
│   │   │   └── overlap-query.dto.ts
│   │   └── services/
│   │       ├── gap-analysis.service.ts
│   │       └── overlap-detection.service.ts
│   │
│   └── users/                         # User accounts + roles (for RBAC)
│       ├── users.module.ts
│       ├── users.service.ts
│       └── entities/
│           └── user.entity.ts
│
├── test/
├── ormconfig.ts                       # Database connection config
└── package.json
```

**Why this structure matters:** each top-level folder under `src/` is a NestJS module with a clean public interface (its controller + exported service methods). Other modules only ever call each other through these exported services — never reach directly into another module's entities/repositories. This is the discipline that keeps a modular monolith from turning into spaghetti, and it's exactly what would let you physically split a module into its own microservice later without a rewrite, if you ever needed to.

---

## 2. Database Schema (PostgreSQL + PostGIS + TimescaleDB)

### 2.1 Core Tables

```sql
-- Departments (Police, RTO, Food & Civil Supplies, etc.)
CREATE TABLE department (
    department_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    code            TEXT UNIQUE NOT NULL,      -- e.g. 'HOME', 'RTO', 'FCS'
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Users (field officers, admins, department viewers)
CREATE TABLE app_user (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL,             -- 'admin' | 'field_officer' | 'dept_viewer' | 'auditor'
    department_id   UUID REFERENCES department(department_id),  -- NULL for admin/auditor
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Refresh tokens (added post-architecture-review) — enables short-lived
-- access tokens (15 min) with a revocable 7-day refresh flow. token_hash
-- stores a HASH of the token, never the raw value, so a DB leak alone
-- doesn't hand out valid sessions. Logout / revocation = delete the row
-- (or set revoked_at).
CREATE TABLE refresh_token (
    token_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX idx_refresh_token_user ON refresh_token (user_id);

-- The core camera registry table
CREATE TABLE camera (
    camera_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id       UUID NOT NULL REFERENCES department(department_id),
    name                TEXT NOT NULL,
    location_geo        GEOGRAPHY(POINT, 4326) NOT NULL,   -- PostGIS: lat/long point
    address_text        TEXT,                              -- human-readable address, optional
    camera_type         TEXT NOT NULL,          -- 'analog' | 'ip'
    brand               TEXT,
    model               TEXT,
    onvif_status         TEXT NOT NULL DEFAULT 'unknown',   -- 'yes' | 'no' | 'unknown'
    onvif_source         TEXT,                   -- 'lookup_table' | 'ai_guess' | 'user_confirmed'
    integration_score    TEXT NOT NULL DEFAULT 'needs_verification', -- 'easy'|'medium'|'hard'|'needs_verification'
    data_confidence      TEXT NOT NULL DEFAULT 'self_reported',      -- 'verified_in_person'|'verified_api'|'self_reported'
    photo_url            TEXT,                   -- proof-of-existence photo, or label photo (stored via Cloudinary — see Section 5a)
    -- Health-monitoring target, added post-architecture-review. All
    -- nullable/optional — most field officers won't know this at onboarding
    -- time, and that's fine (same "unknown is valid" philosophy as
    -- onvif_status). NULL ip_address = the health-check cron skips this
    -- camera and leaves current_status as 'unknown'. Model 1 only does a
    -- basic TCP port reachability check here, not a full RTSP handshake —
    -- that belongs to Model 2.
    ip_address            INET,
    rtsp_port             INTEGER,
    stream_path           TEXT,
    current_status        TEXT NOT NULL DEFAULT 'unknown',   -- 'online' | 'offline' | 'unknown'
    installed_at          DATE,
    created_by            UUID REFERENCES app_user(user_id),
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now(),
    -- Bulk-upload idempotency (added post-architecture-review): re-uploading
    -- the same CSV updates the existing row for a department+name pair
    -- instead of creating a duplicate.
    CONSTRAINT uq_camera_department_name UNIQUE (department_id, name)
);

-- Spatial index — required for any fast map/distance query
CREATE INDEX idx_camera_location ON camera USING GIST (location_geo);
-- Common filter index
CREATE INDEX idx_camera_department ON camera (department_id);
CREATE INDEX idx_camera_integration_score ON camera (integration_score);
```

### 2.2 Integration-Scoring Support Tables

```sql
-- Your own curated brand/model → ONVIF lookup table (the "fast path")
CREATE TABLE vendor_lookup (
    lookup_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand           TEXT NOT NULL,
    model_pattern   TEXT NOT NULL,        -- e.g. 'DS-2CD2%' (supports wildcard matching)
    onvif_status    TEXT NOT NULL,        -- 'yes' | 'no'
    sdk_available   BOOLEAN DEFAULT false,
    source          TEXT,                 -- 'official_datasheet' | 'community' | 'ai_verified'
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_vendor_lookup_brand_model ON vendor_lookup (brand, model_pattern);

-- Tracks every AI guess made, pending human verification
CREATE TABLE scoring_verification (
    verification_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id            UUID NOT NULL REFERENCES camera(camera_id),
    ai_suggested_onvif   TEXT,             -- what the AI guessed
    ai_confidence_note   TEXT,             -- raw AI response, for audit
    verified_by          UUID REFERENCES app_user(user_id),
    verified_at           TIMESTAMPTZ,
    final_onvif_status    TEXT,            -- set once a human confirms/corrects
    status                TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'rejected'
    created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_scoring_verification_status ON scoring_verification (status);
```

### 2.3 Health Monitoring (TimescaleDB Hypertable)

```sql
-- id is a surrogate BIGSERIAL primary key (added post-architecture-review),
-- not a composite (camera_id, checked_at) key. Two health checks landing in
-- the same millisecond under concurrent cron execution isn't actually
-- impossible, and Prisma also requires a stable unique identifier for
-- row-level CRUD — one boring auto-increment column avoids both problems.
CREATE TABLE camera_status_history (
    id              BIGSERIAL PRIMARY KEY,
    camera_id       UUID NOT NULL REFERENCES camera(camera_id),
    status          TEXT NOT NULL,         -- 'online' | 'offline'
    checked_at      TIMESTAMPTZ NOT NULL,
    response_time_ms INTEGER               -- optional: how long the ping took
);

-- Convert to a TimescaleDB hypertable — auto-partitions by time internally
SELECT create_hypertable('camera_status_history', 'checked_at');

CREATE INDEX idx_status_history_camera_time ON camera_status_history (camera_id, checked_at DESC);
```

### 2.4 Audit Log

```sql
CREATE TABLE audit_log (
    audit_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES app_user(user_id),
    action          TEXT NOT NULL,         -- 'create_camera' | 'update_camera' | 'export_data' | 'delete_camera'
    entity_type     TEXT NOT NULL,         -- 'camera' | 'vendor_lookup'
    entity_id       UUID,
    metadata        JSONB,                 -- before/after values, correlation ID, etc.
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_user ON audit_log (user_id, created_at DESC);
```

---

## 3. API Endpoints (Per Module)

All endpoints are served under the `/api/v1` prefix (added post-architecture-review so the public contract can stay stable once Models 2–5 depend on it) — e.g. `/api/v1/cameras`, not shown per-row below for brevity.

### Auth Module
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Login — returns an access token (15 min) + refresh token (7 days) |
| `POST` | `/auth/refresh` | Exchange a valid refresh token for a new access token |
| `POST` | `/auth/logout` | Revoke the caller's refresh token (deletes/marks `revoked_at` on its row) |

### Camera Registry Module
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/cameras` | Create a single camera (manual entry) |
| `POST` | `/cameras/bulk` | Bulk upload via CSV/Excel — **upserts** on `(department_id, name)`, does not duplicate on re-upload |
| `GET` | `/cameras` | List/search cameras (filters: department, status, score; paginated, default 25/max 100) |
| `GET` | `/cameras/:id` | Get one camera's full detail |
| `PATCH` | `/cameras/:id` | Update camera fields |
| `DELETE` | `/cameras/:id` | Soft-delete (marks inactive, doesn't hard-delete for audit trail) |
| `GET` | `/cameras/export` | Export filtered results as CSV |

### Integration Scoring Module
| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/scoring/lookup` | Given brand+model (or photo), returns ONVIF status + score |
| `POST` | `/scoring/lookup/photo` | Upload label photo → OCR → lookup |
| `GET` | `/scoring/pending-verification` | List AI guesses awaiting human review |
| `POST` | `/scoring/verify/:verificationId` | Human confirms/corrects an AI guess |

### Health Monitoring Module
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health/:cameraId/history` | Get uptime history for one camera |
| `GET` | `/health/:cameraId/current` | Get current online/offline status |
| `GET` | `/health/at-risk` | List cameras flagged as trending toward failure |
| `POST` | `/health/:cameraId/check-now` | Manually trigger an immediate health check — a no-op returning `'unknown'` if `ip_address` is null |

### GIS Module
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/gis/cameras-in-bounds` | Get cameras within a map viewport (for rendering pins) |
| `GET` | `/gis/gap-analysis` | Returns under-covered zones |
| `GET` | `/gis/overlap-detection` | Returns pairs of cameras with suspicious proximity |
| `GET` | `/gis/heatmap` | Returns incident-density heatmap data (differentiator feature) |

### Ops (Application-Level, No Module)
| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/livez` | Service liveness probe — distinct from camera health monitoring, public, no auth |

---

## 4. Internal Flow: Onboarding a Camera (Manual Entry with GPS)

This is the step-by-step of what actually happens inside the backend when a field officer submits the "add camera" form:

```
1. Frontend (React) — Field officer fills form:
   - Department (dropdown)
   - Camera name
   - Brand + Model (dropdown/autocomplete, OR skip if unknown)
   - Tap "Use current location" → browser Geolocation API → lat/long auto-filled
   - Optional: photo upload

2. POST /cameras hits camera-registry.controller.ts
       ↓
3. DTO validation (create-camera.dto.ts)
   - class-validator decorators check: lat/long in valid range, department_id exists, etc.
   - If invalid → 400 Bad Request with field-level error messages
       ↓
4. camera-registry.service.ts — createCamera(dto):
   a. Insert base camera row (status: 'unknown' for onvif, 'needs_verification' for score)
      — uses INSERT ... ON CONFLICT (department_id, name) DO UPDATE (upsert) so bulk
        re-uploads of the same file update rows instead of duplicating them
   b. IF brand + model were provided:
        → Call integration-scoring.service.ts internally (same process, direct function call — 
          this is the benefit of the modular monolith: no network round-trip)
        → Scoring service checks vendor_lookup table first
        → If not found, calls ai-lookup.provider.ts (Claude API, model claude-haiku-4-5)
        → Updates camera.onvif_status, onvif_source, integration_score accordingly
   c. IF no brand/model provided → leave as 'needs_verification', done
       ↓
5. audit-log.interceptor.ts automatically logs:
   { action: 'create_camera', user_id, entity_id: new camera_id,
     metadata: { correlationId, ...before/after } }
       ↓
6. Response returned to frontend: full camera object including computed score
```

---

## 5. Internal Flow: Integration-Readiness Scoring (Detailed)

This is the logic living inside `integration-scoring.service.ts`. **Post-architecture-review decisions baked into this flow:** the AI provider is pinned to the Claude API (model `claude-haiku-4-5`, 8s timeout, 1 retry with exponential backoff before falling back to `'unknown'`), and there is no separate OCR engine — `ocr.provider.ts` sends the label photo directly to the same Claude API using its vision capability.

```
FUNCTION scoreCamera(brand, model, photoUrl):

    IF photoUrl provided AND (brand OR model) missing:
        // ocr.provider.ts — NOT a traditional OCR engine. Sends the photo
        // directly to the Claude API (vision) asking it to identify the
        // brand/model text visible on the camera's label.
        (brand, model) = ocr.provider.ts → identifyModelFromPhoto(photoUrl)

    IF brand AND model provided:
        lookupResult = vendor_lookup TABLE query
                       WHERE brand = :brand AND model MATCHES model_pattern

        IF lookupResult found:
            RETURN {
                onvif_status: lookupResult.onvif_status,
                source: 'lookup_table',
                score: computeScore(lookupResult.onvif_status, lookupResult.sdk_available)
            }

        ELSE:
            // ai-lookup.provider.ts — Claude API, model claude-haiku-4-5
            // Timeout: 8s. On failure/timeout: 1 retry with exponential
            // backoff, then fall back to unknown/needs_verification —
            // camera creation must NEVER block on this call.
            aiResponse = ai-lookup.provider.ts → askAI(
                "Does the camera model '{brand} {model}' support ONVIF?
                 Respond only as JSON: { onvif_supported: 'yes'|'no'|'unsure', reasoning: string }"
            )

            INSERT INTO scoring_verification (
                ai_suggested_onvif: aiResponse.onvif_supported,
                ai_confidence_note: aiResponse.reasoning,
                status: 'pending'
            )

            RETURN {
                onvif_status: aiResponse.onvif_supported,
                source: 'ai_guess',         -- clearly marked, NOT trusted as final
                score: computeScore(aiResponse.onvif_supported, sdk_available: unknown)
            }

    ELSE:
        RETURN {
            onvif_status: 'unknown',
            source: null,
            score: 'needs_verification'
        }


FUNCTION computeScore(onvifStatus, sdkAvailable):
    IF onvifStatus == 'yes':       RETURN 'easy'
    IF onvifStatus == 'no' AND sdkAvailable:  RETURN 'medium'
    IF onvifStatus == 'no' AND NOT sdkAvailable: RETURN 'hard'
    RETURN 'needs_verification'
```

**The human-verification loop** (closing the feedback cycle so the system improves over time):
```
GET /scoring/pending-verification  →  returns all 'pending' rows from scoring_verification

Admin reviews each one, calls:
POST /scoring/verify/:verificationId  { confirmed_onvif_status: 'yes' }

Backend then:
  1. Updates scoring_verification.status = 'confirmed', final_onvif_status = 'yes'
  2. Updates the camera row's onvif_status + onvif_source = 'user_confirmed'
  3. INSERTS a new row into vendor_lookup (this brand/model, now confirmed)
     → so next time ANY camera with this exact brand/model is onboarded,
       it hits the fast lookup_table path instead of calling the AI again
```

---

## 6. Internal Flow: Health Monitoring (Scheduled Job)

**Post-architecture-review fix:** the original flow referenced `camera.stream_url`/`camera.ip_address` before those columns existed anywhere in the schema, making the job unimplementable as originally written. `ip_address`, `rtsp_port`, and `stream_path` are now real (nullable) columns on `camera` (Section 2.1). Cameras with no `ip_address` are skipped — `current_status` stays `'unknown'`, which is a valid, expected state, not an error. The check itself is a **basic TCP port reachability check** — connecting to `ip_address:rtsp_port` (or a sensible default port if `rtsp_port` is null) and confirming the socket opens — not a full RTSP handshake or stream validation, which is explicitly out of scope for Model 1 and belongs to Model 2.

```
health-check.cron.ts — runs every N minutes (e.g. every 5 min) via NestJS's @Cron decorator

FUNCTION runHealthCheck():
    activeCameras = SELECT * FROM camera
                    WHERE camera_type = 'ip'        -- analog cameras can't be pinged this way
                      AND ip_address IS NOT NULL     -- cameras with no known address are skipped, not errored

    FOR EACH camera IN activeCameras (processed in parallel batches, not one-by-one):
        result = attemptTcpPortCheck(camera.ip_address, camera.rtsp_port)   -- basic reachability only, not RTSP handshake
        
        INSERT INTO camera_status_history (camera_id, status, checked_at, response_time_ms)
        VALUES (camera.camera_id, result.status, now(), result.responseTime)

        UPDATE camera SET current_status = result.status WHERE camera_id = camera.camera_id
```

**"At-risk" detection logic** (the predictive maintenance flag idea):
```sql
-- Cameras that have gone offline 3+ times in the last 14 days
SELECT camera_id, COUNT(*) as offline_events
FROM camera_status_history
WHERE status = 'offline'
  AND checked_at > now() - INTERVAL '14 days'
GROUP BY camera_id
HAVING COUNT(*) >= 3
ORDER BY offline_events DESC;
```
This query is cheap and fast specifically because of the TimescaleDB hypertable + the `(camera_id, checked_at)` index — even with millions of historical status rows, this only scans recent partitions.

---

## 7. Internal Flow: Overlap Detection (GIS Module)

```sql
-- Runs on-demand (button click) or nightly via a scheduled job
SELECT 
    a.camera_id AS camera_a, 
    b.camera_id AS camera_b,
    a.department_id AS dept_a,
    b.department_id AS dept_b,
    ST_Distance(a.location_geo, b.location_geo) AS distance_meters
FROM camera a
JOIN camera b 
    ON a.camera_id < b.camera_id                    -- avoid duplicate pairs (A,B) and (B,A)
    AND a.department_id != b.department_id           -- only flag cross-department overlaps
    AND ST_DWithin(a.location_geo, b.location_geo, 50)  -- within 50 meters
ORDER BY distance_meters ASC;
```
This result feeds directly into `/gis/overlap-detection` and gets rendered on the map as connected pairs.

---

## 8. Authentication & Authorization (RBAC) Design

```
Roles:
  - admin           → full access to everything, including verify-scoring and delete
  - field_officer    → can create/update cameras, cannot delete or verify AI scores
  - dept_viewer      → read-only, scoped to their own department_id only
  - auditor          → read-only access to audit_log across all departments

Enforcement points:
  1. jwt-auth.guard.ts — every request must carry a valid JWT (except /livez, /auth/login, /auth/refresh)
  2. roles.guard.ts — checks @Roles() decorator on each controller method against user's role
  3. Row-level scoping — see the dedicated mechanism below (post-architecture-review)
```

**Row-level scoping mechanism (post-architecture-review — replaces the earlier "service methods automatically inject WHERE department_id" prose with a concrete, enforced design):**

Leaving this to per-service-method discretion is exactly how a `dept_viewer` cross-department leak slips in — one missed `if` and acceptance criterion "dept_viewer cannot retrieve another department's camera by guessing its ID" fails silently. Instead, there is **one shared helper** every scoped read must call:

```typescript
// common/scoping/dept-scope.helper.ts
function applyDeptScope(baseWhere: object, currentUser: User): object {
  if (currentUser.role !== 'dept_viewer') return baseWhere;
  return { ...baseWhere, departmentId: currentUser.departmentId };
}
```

Every service method that reads camera-derived data for a role that can be `dept_viewer` (camera list/detail, health history, GIS queries) MUST route its `WHERE` clause through `applyDeptScope()` — this is a required code-review checklist item, not a convention. **Stretch goal, not blocking v1:** Postgres Row-Level Security (RLS) policies on `camera` as defense-in-depth for the eventual statewide rollout, so a missed application-layer check still can't leak cross-department data.

Example controller annotation:
```typescript
@Roles('admin', 'field_officer')
@Post()
async createCamera(@Body() dto: CreateCameraDto, @CurrentUser() user: User) {
  return this.cameraRegistryService.createCamera(dto, user);
}

@Roles('admin')
@Delete(':id')
async deleteCamera(@Param('id') id: string) {
  return this.cameraRegistryService.softDelete(id);
}
```

---

## 8a. Token Refresh & Revocation Flow (Post-Architecture-Review Addition)

The original design had login issuing a single JWT with no expiry/revocation story — a stolen long-lived token had no way to be invalidated, which is a real gap for a system with evidentiary ambitions.

```
POST /auth/login  { email, password }
  → auth.service.ts verifies bcrypt password hash
  → Issues:
      accessToken  (JWT, 15 min expiry)
      refreshToken (random opaque token, 7 day expiry)
  → refresh-token.service.ts stores HASH(refreshToken) in refresh_token table
    (never the raw token — a DB leak alone must not hand out valid sessions)
  → Returns { accessToken, refreshToken } to client

POST /auth/refresh  { refreshToken }
  → refresh-token.service.ts looks up HASH(refreshToken) in refresh_token table
  → Rejects (401) if: not found, expired (expires_at < now()), or revoked (revoked_at IS NOT NULL)
  → On success: issues a new accessToken only (refresh token itself is not rotated for v1)

POST /auth/logout  (authenticated)
  → refresh-token.service.ts sets revoked_at = now() on the caller's refresh_token row
    (or deletes it outright)
  → Any subsequent /auth/refresh call with that token now fails
```

---

## 9. Error Handling & Validation Approach

- **DTO validation** — every incoming request body is validated using `class-validator` decorators (e.g. `@IsLatitude()`, `@IsUUID()`, `@IsEnum()`) before it ever reaches business logic — invalid requests are rejected at the door with a clear 400 response
- **Global exception filter** (`http-exception.filter.ts`) — catches any unhandled error and returns a consistent JSON error shape instead of leaking raw stack traces:
  ```json
  { "statusCode": 400, "message": "latitude must be between -90 and 90", "error": "Bad Request" }
  ```
- **AI fallback resilience** — if the Claude API call in `ai-lookup.provider.ts` times out (8s) or fails, one retry with exponential backoff is attempted, then the system falls back gracefully to `onvif_status: 'unknown'`, `score: 'needs_verification'`, and logs the failure. Camera creation is never blocked on this call — a broken AI dependency should never break the core registry function.
- **Rate limiting** (post-architecture-review addition) — `@nestjs/throttler` enforces a global default of 100 requests/min per IP, with a stricter 5 requests/min override on `POST /auth/login` and `POST /cameras/bulk`. Excess requests return HTTP 429.
- **Pagination limits** (post-architecture-review addition) — `pagination.dto.ts` enforces a default page size of 25 and a maximum of 100 via `@Max(100)`. A request for more than 100 is rejected with HTTP 400, never silently capped — an unbounded list endpoint was previously able to dump the entire `camera` table.

---

## 10. Summary: What Talks to What (Within Model 1)

```
auth.service.ts
    → reads/writes → refresh_token table (hashed tokens only)

camera-registry.service.ts
    → calls → integration-scoring.service.ts     (direct function call, same process)
    → calls → dept-scope.helper.ts                (applyDeptScope, for all dept_viewer-scoped reads)
    → calls → cloudinary-storage.provider.ts       (photo_url uploads, external network call)
    → triggers → audit-log.interceptor.ts         (automatic, via NestJS interceptor; attaches correlation ID)

health-check.cron.ts (scheduled)
    → writes to → camera_status_history table
    → updates → camera.current_status
    → skips cameras where ip_address IS NULL

gis.service.ts
    → reads from → camera table (PostGIS spatial queries)
    → reads from → camera_status_history (for "at-risk" overlays on map, optional)
    → calls → dept-scope.helper.ts                (applyDeptScope, for all dept_viewer-scoped reads)

integration-scoring.service.ts
    → reads/writes → vendor_lookup table
    → reads/writes → scoring_verification table
    → calls (external, over network) → ai-lookup.provider.ts → Claude API (claude-haiku-4-5)
    → calls (external, over network) → ocr.provider.ts → same Claude API, vision capability
```

Everything inside the dashed box (all four modules) runs in **one deployed process** — these are direct, fast, reliable function calls. The network calls in this module are: the outbound call to the Claude API for unknown camera models or label-photo identification, and the outbound call to Cloudinary for photo storage — both are designed to fail gracefully (or, for Cloudinary, are non-blocking to the core registry write) without taking down the rest of the system.
