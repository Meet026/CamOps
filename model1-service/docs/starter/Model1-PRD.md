# Product Requirements Document (PRD)
## Model 1 — Centralised CCTV Registry & GIS Foundation

**Project context:** Gujarat Police Innovation Hackathon 2026 ("Sentinel") — a statewide initiative to integrate CCTV cameras from 26 government departments into a unified video management and analytics platform. This PRD covers **only Model 1** — the mandatory registry and mapping foundation. Models 2–5 (live video, AI analytics, watchlist alerts) are explicitly **out of scope** for this PRD and will be built as separate services later.

This document is written to be handed directly to an AI coding agent (e.g. Claude Code, Cursor) to scaffold and implement the system with minimal additional clarification needed.

---

## 1. Problem Statement (Context for the Agent)

26 government departments in Gujarat currently run independent, disconnected CCTV systems — different vendors, formats, protocols, and no shared record of what cameras exist, where they are, or how hard they'd be to integrate into a future unified platform. Model 1 solves the **data foundation** problem: before anyone can build live video integration (Models 2–5), there must be a single, trustworthy, searchable registry of every camera — its location, ownership, technical characteristics, and integration difficulty.

Model 1 does **not** touch live video streams, recording, or AI analytics. It is a metadata/inventory and GIS system only.

---

## 2. Goals

1. Provide a single source of truth for camera metadata across all departments.
2. Let non-technical field staff onboard cameras easily, including via mobile with GPS auto-capture.
3. Automatically assess how difficult each camera will be to integrate into future video platforms (Models 2–5), even when the person onboarding it doesn't know technical details like ONVIF support.
4. Visualize all cameras on an interactive map, with layers for department, status, and coverage.
5. Surface actionable insights: coverage gaps, redundant/overlapping coverage across departments, and cameras trending toward failure.
6. Maintain a full audit trail of all data changes, since this system may eventually support law-enforcement/evidentiary use cases.

---

## 3. Explicit Non-Goals (Out of Scope for This PRD)

- No live video streaming, recording, or playback.
- No AI video analytics (ANPR, facial recognition, object detection) — these belong to Models 2–5.
- No watchlist/database integration (VAHAN, SARTHI, eGujCop, AFIS, NAFIS).
- No mobile native app — "mobile" onboarding means a responsive web form usable on a phone browser, not a compiled iOS/Android app.

---

## 4. Tech Stack (Fixed — Do Not Substitute Without Discussion)

| Layer | Technology |
|---|---|
| Backend framework | NestJS (Node.js, TypeScript) |
| Database | PostgreSQL + PostGIS extension |
| Time-series data | TimescaleDB extension on the same PostgreSQL instance (optional at dev-scale; plain table is acceptable if TimescaleDB isn't installed) |
| ORM | Prisma |
| Frontend | React (with TypeScript) |
| Mapping library | Leaflet |
| Auth | JWT-based, with role-based access control (RBAC) |
| Database name | `sentinel_model1_db` (already created — see Section 6) |

**Architecture pattern:** Modular monolith. All four feature modules (Registry, Integration Scoring, Health Monitoring, GIS) live in **one deployed NestJS application**, organized into strictly separated NestJS modules that communicate via direct function calls — not network calls, not message queues. Do not implement this as microservices. Do not add an API gateway, service mesh, or inter-service messaging layer for this PRD. This is a deliberate architectural decision (documented reasoning: at this scale and team size, splitting CRUD-adjacent operations into separate services adds deployment/operational overhead with no corresponding benefit — see Section 12 for the one legitimate future split point).

---

## 5. Backend Module Structure (Required Folder Layout)

```
model1-service/
├── prisma/
│   └── schema.prisma                  # Single source of truth for the DB schema
│                                       # (generated via `npx prisma db pull` against
│                                       #  the existing sentinel_model1_db database)
│
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── prisma/
│   │   ├── prisma.module.ts           # Global module, exports PrismaService
│   │   └── prisma.service.ts          # Wraps PrismaClient, injected everywhere
│   │
│   ├── common/
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   ├── decorators/
│   │   │   └── roles.decorator.ts
│   │   ├── interceptors/
│   │   │   └── audit-log.interceptor.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── middleware/
│   │   │   └── correlation-id.middleware.ts   # generates/propagates a request ID for logs + audit_log.metadata
│   │   ├── dto/
│   │   │   └── pagination.dto.ts              # default 25 / max 100, @Max(100) — see Section 6a point 10
│   │   ├── scoping/
│   │   │   └── dept-scope.helper.ts           # applyDeptScope() — the single enforced choke point for dept_viewer row scoping (Section 6a point 4)
│   │   └── storage/
│   │       ├── storage-provider.interface.ts  # save() / getUrl()
│   │       └── cloudinary-storage.provider.ts # only implementation for v1 (Section 6a point 7)
│   │
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts                 # login, refresh, logout
│   │   ├── auth.service.ts
│   │   ├── refresh-token.service.ts           # issues/validates/revokes hashed refresh tokens (Section 6a point 3)
│   │   └── strategies/jwt.strategy.ts
│   │
│   ├── camera-registry/
│   │   ├── camera-registry.module.ts
│   │   ├── camera-registry.controller.ts
│   │   ├── camera-registry.service.ts    # Injects PrismaService directly
│   │   ├── dto/create-camera.dto.ts
│   │   ├── dto/update-camera.dto.ts
│   │   ├── dto/bulk-upload-camera.dto.ts # bulk upload upserts on (department_id, name) — Section 6a point 5
│   │   └── dto/camera-query.dto.ts
│   │
│   ├── scoring/
│   │   ├── scoring.module.ts
│   │   ├── scoring.controller.ts
│   │   ├── scoring.service.ts
│   │   ├── dto/score-lookup.dto.ts, score-lookup-photo.dto.ts, verify-scoring.dto.ts
│   │   └── providers/ai-provider.interface.ts  # AiProvider — vendor-swap boundary
│   │   └── providers/openai.provider.ts        # OpenAI API (gpt-4o-mini) — contract in Section 6a point 6;
│   │                                           #   identifyFromPhoto() doubles as the OCR path (point 8),
│   │                                           #   no separate OCR engine
│   │
│   ├── storage/
│   │   ├── storage.module.ts
│   │   ├── storage-provider.interface.ts    # StorageProvider — save(), getUrl() — Section 6a point 7
│   │   └── cloudinary-storage.provider.ts
│   │
│   ├── health-monitoring/
│   │   ├── health-monitoring.module.ts
│   │   ├── health-monitoring.controller.ts
│   │   ├── health-monitoring.service.ts
│   │   ├── jobs/health-check.cron.ts   # skips cameras with ip_address IS NULL — TCP port check only, not RTSP handshake
│   │   └── dto/status-query.dto.ts
│   │
│   ├── gis/
│   │   ├── gis.module.ts
│   │   ├── gis.controller.ts
│   │   ├── gis.service.ts
│   │   ├── dto/map-bounds-query.dto.ts
│   │   ├── dto/overlap-query.dto.ts
│   │   ├── services/gap-analysis.service.ts
│   │   └── services/overlap-detection.service.ts
│   │       -- NOTE: PostGIS spatial functions (ST_DWithin, ST_Distance) are not
│   │          expressible in plain Prisma queries. Use Prisma's
│   │          `$queryRaw` / `$queryRawUnsafe` for these specific spatial
│   │          queries, keeping all other queries as normal Prisma calls.
│   │
│   └── users/
│       ├── users.module.ts
│       └── users.service.ts
│
├── test/
└── package.json
```

**New dependencies introduced by the architecture review:** `@nestjs/throttler` (rate limiting, Section 6a point 9), `cloudinary` (photo storage, Section 6a point 7), `@anthropic-ai/sdk` (AI lookup + vision-based label OCR, Section 6a points 6/8), `bcrypt` (refresh-token hashing, reusing the existing password-hashing dependency).

**Rule for the agent:** modules must only interact with each other through their exported service methods (direct NestJS dependency injection), never by directly calling `PrismaService` for a table that "belongs" to another module (e.g. the GIS module should not directly write to the `camera` table — it should call `camera-registry`'s service). This boundary discipline is required even though everything runs in one process, and even though Prisma makes it technically easy to reach into any table from anywhere — it is what keeps this monolith "modular" rather than tangled, and preserves the option to split a module into its own service later.

**Prisma-specific note for the agent:** since PostGIS's `GEOGRAPHY` type and spatial functions (`ST_DWithin`, `ST_Distance`, GIST index usage) are not natively supported by Prisma's query builder, all spatial queries (overlap detection, map-bounds filtering, gap analysis) must use `prisma.$queryRaw` with parameterized SQL — never string-concatenated raw SQL, to avoid SQL injection. All other queries (plain CRUD on camera, department, vendor_lookup, etc.) should use standard Prisma Client calls.

---

## 6. Database (Already Created — Do Not Recreate)

The database `sentinel_model1_db` and all tables already exist, created via a setup script (rebuilt once, post-architecture-review, to incorporate the Section 6a decisions — see that section for what changed and why). **Do not generate a new schema from scratch or run destructive migrations from here on.** Instead:

- Run `npx prisma db pull` against the existing database to introspect the current tables and auto-generate `prisma/schema.prisma` — do not hand-write this file from scratch when the database already exists.
- Run `npx prisma generate` after introspection to produce the typed Prisma Client.
- **Known introspection caveat:** all `CHECK (... IN (...))` constraints in the existing schema (e.g. `role`, `camera_type`, `onvif_status`, `integration_score`) will be introspected as plain `String` fields, not as Prisma `enum` types, because they're implemented as Postgres `CHECK` constraints rather than native Postgres `ENUM` types. Do not attempt to manually convert these to Prisma enums unless explicitly asked — doing so would require an actual database migration changing the column type, which is a deliberate decision to make later, not something to do silently during scaffolding. In the meantime, enforce these value constraints at the application layer via `class-validator`'s `@IsIn([...])` decorator on each relevant DTO field.
- For any future schema changes, use `npx prisma migrate dev` (development) — never hand-edit the database directly and never use `prisma db push` against this database once real data exists, since it can silently drop/alter columns without a reviewable migration file.

### Existing Schema (match entities to this exactly)

```sql
-- department
department_id   UUID PRIMARY KEY DEFAULT gen_random_uuid()
name            TEXT NOT NULL
code            TEXT UNIQUE NOT NULL
created_at      TIMESTAMPTZ DEFAULT now()

-- app_user
user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid()
email           TEXT UNIQUE NOT NULL
password_hash   TEXT NOT NULL
role            TEXT NOT NULL CHECK (role IN ('admin','field_officer','dept_viewer','auditor'))
department_id   UUID REFERENCES department(department_id)
created_at      TIMESTAMPTZ DEFAULT now()

-- refresh_token (added post-architecture-review: enables short-lived access
-- tokens with a revocable refresh flow — see Section 6a and FR-6a)
token_id        UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id         UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE
token_hash      TEXT UNIQUE NOT NULL
expires_at      TIMESTAMPTZ NOT NULL
created_at      TIMESTAMPTZ DEFAULT now()
revoked_at      TIMESTAMPTZ

-- camera
camera_id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
department_id        UUID NOT NULL REFERENCES department(department_id)
name                 TEXT NOT NULL
location_geo         GEOGRAPHY(POINT, 4326) NOT NULL
address_text         TEXT
camera_type          TEXT NOT NULL CHECK (camera_type IN ('analog','ip'))
brand                TEXT
model                TEXT
onvif_status         TEXT NOT NULL DEFAULT 'unknown' CHECK (onvif_status IN ('yes','no','unknown'))
onvif_source         TEXT CHECK (onvif_source IN ('lookup_table','ai_guess','user_confirmed') OR onvif_source IS NULL)
integration_score    TEXT NOT NULL DEFAULT 'needs_verification' CHECK (integration_score IN ('easy','medium','hard','needs_verification'))
data_confidence      TEXT NOT NULL DEFAULT 'self_reported' CHECK (data_confidence IN ('verified_in_person','verified_api','self_reported'))
photo_url            TEXT
ip_address           INET                          -- optional health-check target; NULL = not yet known, camera is skipped by the cron
rtsp_port            INTEGER                        -- optional
stream_path          TEXT                           -- optional
current_status       TEXT NOT NULL DEFAULT 'unknown' CHECK (current_status IN ('online','offline','unknown'))
installed_at         DATE
is_active            BOOLEAN NOT NULL DEFAULT true
created_by           UUID REFERENCES app_user(user_id)
created_at           TIMESTAMPTZ DEFAULT now()
updated_at           TIMESTAMPTZ DEFAULT now()
-- indexes: GIST(location_geo), department_id, integration_score, is_active
-- unique constraint: (department_id, name) — bulk-upload idempotency (re-upload updates, doesn't duplicate)

-- vendor_lookup
lookup_id       UUID PRIMARY KEY DEFAULT gen_random_uuid()
brand           TEXT NOT NULL
model_pattern   TEXT NOT NULL
onvif_status    TEXT NOT NULL CHECK (onvif_status IN ('yes','no'))
sdk_available   BOOLEAN DEFAULT false
source          TEXT CHECK (source IN ('official_datasheet','community','ai_verified'))
created_at      TIMESTAMPTZ DEFAULT now()

-- scoring_verification
verification_id      UUID PRIMARY KEY DEFAULT gen_random_uuid()
camera_id            UUID NOT NULL REFERENCES camera(camera_id)
ai_suggested_onvif    TEXT
ai_confidence_note    TEXT
verified_by           UUID REFERENCES app_user(user_id)
verified_at           TIMESTAMPTZ
final_onvif_status    TEXT
status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected'))
created_at            TIMESTAMPTZ DEFAULT now()

-- camera_status_history
-- NOTE: has a surrogate `id BIGSERIAL PRIMARY KEY` (added post-architecture-
-- review). A composite (camera_id, checked_at) key looked sufficient on
-- paper, but two health checks landing in the same millisecond under
-- concurrent cron execution isn't actually impossible, and Prisma also
-- requires a stable unique identifier for row-level operations.
id                 BIGSERIAL PRIMARY KEY
camera_id          UUID NOT NULL REFERENCES camera(camera_id)
status             TEXT NOT NULL CHECK (status IN ('online','offline'))
checked_at         TIMESTAMPTZ NOT NULL DEFAULT now()
response_time_ms   INTEGER
-- optionally a TimescaleDB hypertable on checked_at

-- audit_log
audit_id        UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id         UUID REFERENCES app_user(user_id)
action          TEXT NOT NULL
entity_type     TEXT NOT NULL
entity_id       UUID
metadata        JSONB
created_at      TIMESTAMPTZ DEFAULT now()
```

---

## 6a. Architecture Review Addendum (Post-PRD Gap Analysis)

Before backend scaffolding began, the PRD/LLD/schema/SQL were cross-checked against each other and against production-robustness concerns. The following decisions close the gaps found and are now binding requirements, not optional hardening:

1. **`camera_status_history` primary key.** Added a surrogate `id BIGSERIAL PRIMARY KEY` column (see Section 6 schema). A composite `(camera_id, checked_at)` key was considered and rejected — two health checks landing in the same millisecond under concurrent cron execution isn't actually impossible, and Prisma requires a stable unique identifier for row-level CRUD regardless.

2. **Health-check target columns.** The original schema had no way to reach an IP camera to ping it. Added `ip_address INET`, `rtsp_port INTEGER`, `stream_path TEXT` to `camera`, all nullable. Same "unknown is valid" philosophy as `onvif_status`: if `ip_address` is `NULL`, the health-check cron simply skips that camera and leaves `current_status = 'unknown'` — it is not an error. Model 1's health check is a **basic TCP port reachability check only**; a full RTSP handshake/stream validation is explicitly Model 2's responsibility, not this service's.

3. **Refresh tokens / revocation.** Added a `refresh_token` table (see Section 6 schema). Access tokens are short-lived (15 min); refresh tokens are longer-lived (7 days), stored **hashed** (never plaintext) in this table, tied to `user_id`. New endpoints: `POST /auth/refresh` (exchange a valid refresh token for a new access token) and `POST /auth/logout` (deletes the stored refresh token row — immediate revocation). See FR-6a and the updated API contract in Section 8.

4. **`dept_viewer` row-level scoping mechanism.** Rather than leaving this as a convention every service method must remember, all scoped reads (camera list/detail, health history, GIS queries) MUST go through a single shared helper — e.g. `applyDeptScope(baseWhere, currentUser)` — that injects `department_id = currentUser.departmentId` for the `dept_viewer` role. This is a required code-review checklist item: no service method may query camera-derived data for a scoped role without calling this helper. **Stretch goal (not blocking v1, document as future hardening):** Postgres Row-Level Security (RLS) policies on `camera` as defense-in-depth for the eventual statewide rollout, so a missed application-layer check still can't leak cross-department data.

5. **Bulk upload idempotency.** Added a `UNIQUE (department_id, name)` constraint on `camera` (see Section 6 schema). Bulk upload (FR-1) must **upsert** on this key — update the existing row if a camera with that department+name pair already exists, insert otherwise — instead of blindly inserting duplicates on re-upload of the same file.

6. **AI provider contract (integration scoring).** Pinned to the OpenAI API, model `gpt-4o-mini` (revised from an earlier Anthropic Claude pin — decided during FR-3 implementation brainstorming: gpt-4o-mini is natively multimodal, covering both this text classification and the vision/OCR use in point 8 with one vendor/SDK, needs only an API key with no additional cloud account/IAM setup, and is cost/speed-appropriate for a simple classification task). Request/response contract:
   ```
   Prompt: "Does the camera model '{brand} {model}' support ONVIF?
            Respond only as JSON: { onvif_supported: 'yes'|'no'|'unsure', reasoning: string }"
   Timeout: 8 seconds
   Retry: 1 retry with exponential backoff, then fall back to onvif_status = 'unknown' / integration_score = 'needs_verification'
   ```
   This contract is what `ai-lookup.provider.ts` implements; FR-3's failure-handling requirement is defined against it explicitly. Implemented behind an `AiProvider` interface (`guessOnvifSupport()`, `identifyFromPhoto()`) with `OpenAiProvider` as its only v1 implementation, so the vendor can be swapped again later without touching calling code — see `docs/superpowers/specs/2026-08-26-integration-scoring-design.md`.

7. **Photo storage (`photo_url`).** Use **Cloudinary** (official `cloudinary` npm SDK) rather than raw S3-compatible storage. Configuration (cloud name, API key, API secret) loaded entirely from environment variables — see updated `.env.example` list in Section 13. Implemented behind a small `StorageProvider` interface (`save()`, `getUrl()`) with `CloudinaryStorageProvider` as its only implementation, so the storage backend can be swapped later without touching calling code. One Cloudinary account/free tier covers both local dev and any hosted demo — no separate local-vs-production storage split needed for v1.

8. **OCR provider (label-photo model identification).** No separate OCR engine. The label photo (already hosted via Cloudinary per point 7) is sent directly to the same OpenAI API from point 6, using its vision/multimodal capability, with a prompt asking it to identify the brand and model number visible in the photo. This collapses two previously-unspecified components (OCR + AI lookup) into one already-defined contract — `ocr.provider.ts` becomes a thin wrapper that calls the same AI client (via the `AiProvider` interface's `identifyFromPhoto()`) with an image-plus-prompt payload instead of a separate OCR SDK.

9. **Rate limiting.** Add `@nestjs/throttler` globally: default 100 requests/min per IP. Stricter override: 5 requests/min specifically on `POST /auth/login` and `POST /cameras/bulk`.

10. **Pagination limits.** `pagination.dto.ts` must enforce a default page size of 25 and a maximum of 100 (`@Max(100)` via `class-validator`). A request explicitly asking for more than 100 is rejected with HTTP 400, not silently capped.

11. **Schema source of truth.** Confirmed: once `npx prisma db pull` has been run, the hand-maintained `schema.prisma` is expected to be overwritten by introspection output — that is not a bug. From this point forward, **`npx prisma migrate dev` is the single source of truth for all schema changes.** `model1_fresh_setup.sql` is a one-time historical setup script and must not be manually re-run or edited again once real (non-seed) data exists.

**Minor additions also adopted:**
- A trivial liveness endpoint (`GET /health` or `/status`, distinct from camera health monitoring) for ops/load-balancer probes.
- All API routes prefixed `/api/v1` globally, added now while it's cheap — Section 12's future Model 2–5 service will depend on this API staying stable.
- A correlation-ID middleware: generate a request ID per inbound request, attach it to every log line and to `audit_log.metadata` JSON, so a single user action can be traced across log lines.
- CORS: explicit origin allowlist (dev + deployed frontend URLs) via NestJS's `enableCors()` — never a wildcard `*`, since this API handles authenticated requests.

---

## 7. Functional Requirements

### FR-1: Camera Registry (CRUD + Onboarding)
- Create camera via manual form entry.
- Create cameras via bulk upload (CSV/Excel) — must validate every row and report per-row errors, not fail the whole batch on one bad row. Bulk upload MUST **upsert** on `(department_id, name)` (see Section 6a point 5) — re-uploading the same file updates existing rows instead of creating duplicates.
- List/search cameras with filters: department, camera_type, integration_score, current_status, is_active.
- View single camera detail.
- Update camera fields.
- Soft-delete only (`is_active = false`) — never hard-delete, to preserve audit history.
- Export filtered camera list as CSV.

### FR-2: GPS-Based Onboarding
- The camera creation form must support a "Use current location" button that reads the browser's Geolocation API and auto-fills latitude/longitude — this must work on mobile browsers.
- Manual lat/long entry must remain available as a fallback if GPS is unavailable/denied.
- Optional photo upload at onboarding time (stored via `photo_url`), used either as proof-of-installation or as a label photo for OCR-based model identification (see FR-3).

### FR-3: Integration-Readiness Scoring
- When brand + model are provided, check `vendor_lookup` table first (fast path, exact + wildcard pattern match on `model_pattern`).
- If no match found, call the AI provider (`ai-lookup.provider.ts` — Claude API, model `claude-haiku-4-5`, contract defined in Section 6a point 6) asking whether that brand/model supports ONVIF. Store the raw response in `scoring_verification` with `status = 'pending'`, and mark the camera's `onvif_source = 'ai_guess'` — this must be visibly distinguishable in the UI from a verified answer (e.g. a badge/tag), never presented as equally trustworthy as a lookup-table match.
- If brand/model is unknown entirely, allow the officer to instead upload a photo of the camera's label; send it to the same Claude API using its vision capability to identify a candidate brand/model string (`ocr.provider.ts` — see Section 6a point 8; no separate OCR engine), then run it through the same lookup flow.
- If nothing is available, leave `onvif_status = 'unknown'` and `integration_score = 'needs_verification'` — this is a valid, expected state, not an error.
- Score computation logic:
  ```
  onvif_status == 'yes'                        → integration_score = 'easy'
  onvif_status == 'no' AND sdk_available        → integration_score = 'medium'
  onvif_status == 'no' AND NOT sdk_available    → integration_score = 'hard'
  onvif_status == 'unknown'                     → integration_score = 'needs_verification'
  ```
- Provide an admin-only queue (`GET /scoring/pending-verification`) listing all `scoring_verification` rows with `status = 'pending'`.
- Provide an endpoint for an admin to confirm or reject an AI guess (`POST /scoring/verify/:verificationId`). On confirmation:
  1. Update `scoring_verification.status = 'confirmed'`, set `final_onvif_status`.
  2. Update the source camera's `onvif_status` and `onvif_source = 'user_confirmed'`.
  3. Insert a new row into `vendor_lookup` for that brand/model, so future cameras of the same model resolve instantly via the fast path instead of calling the AI again.
- **Failure handling requirement:** if the AI provider call fails or times out, camera creation must still succeed — never block the core registry operation on an external AI dependency. Fall back to `unknown`/`needs_verification` and log the failure.

### FR-4: Health Monitoring
- A scheduled background job (NestJS `@Cron`) runs periodically (configurable interval, default every 5 minutes) and attempts to reach every camera marked `camera_type = 'ip'` **that has a non-null `ip_address`** (see Section 6a point 2). Cameras with no `ip_address` set are skipped — `current_status` stays `'unknown'`, which is a valid, expected state, not an error.
- The check itself is a **basic TCP port reachability check** against `ip_address`/`rtsp_port` (default port if `rtsp_port` is null) — not a full RTSP handshake or stream validation, which is out of scope for Model 1 (belongs to Model 2).
- Each check result is inserted into `camera_status_history` and also updates `camera.current_status`.
- Analog cameras (`camera_type = 'analog'`) are excluded from automated pinging — their status must be manually updatable instead.
- Provide an endpoint to view a camera's full status history.
- Provide an "at-risk" endpoint that flags cameras with 3 or more offline events in the trailing 14 days (this threshold should be a configurable constant, not hardcoded inline).

### FR-5: GIS & Map Features
- Serve camera pin data for a given map viewport/bounding box (avoid sending all cameras statewide on every pan/zoom).
- Gap analysis: identify and return zones with no camera coverage (exact algorithm can start simple — e.g. grid-based density check — and does not need to be sophisticated for v1).
- Overlap detection: identify pairs of cameras from **different** departments within a configurable distance threshold (default 50 meters) of each other, using PostGIS `ST_DWithin`. Return camera pairs plus computed distance.
- Incident heatmap overlay: accept a representative/sample incident dataset (lat/long + weight) and render as a heatmap layer over the camera map — this is a differentiator feature, not part of the original mandatory spec, and should be clearly labeled as such in the UI (e.g. "Beta: Incident density overlay").

### FR-6: Authentication & Authorization
- JWT-based login (`POST /auth/login`).
- Four roles: `admin`, `field_officer`, `dept_viewer`, `auditor`.
- `admin`: full access, including scoring verification and hard operations.
- `field_officer`: can create/update cameras, cannot delete or verify AI scores.
- `dept_viewer`: read-only, automatically scoped to their own `department_id` — must never be able to view another department's cameras even by guessing a camera ID. Enforced via the shared `applyDeptScope` helper (Section 6a point 4), not per-service-method discretion.
- `auditor`: read-only access to the audit log across all departments.

### FR-6a: Token Refresh & Revocation (added post-architecture-review)
- Access tokens are short-lived (15 minutes). `POST /auth/login` returns both an access token and a refresh token.
- Refresh tokens are long-lived (7 days), stored **hashed** in the `refresh_token` table, and tied to `user_id`.
- `POST /auth/refresh`: exchanges a valid, non-revoked, non-expired refresh token for a new access token.
- `POST /auth/logout`: deletes (or marks `revoked_at`) the caller's stored refresh token row — this is the revocation mechanism. A revoked or expired refresh token must not be usable to obtain new access tokens.

### FR-7: Audit Logging
- Every create, update, delete, and export action must produce an `audit_log` row automatically (via a NestJS interceptor, not manually called in every service method) capturing: user, action, entity type/id, and relevant before/after metadata as JSON.
- The interceptor also attaches the request's correlation ID (Section 6a minor additions) into `metadata`, so a single user action can be traced across log lines.

---

## 8. API Contract

All endpoints below are served under the `/api/v1` prefix (e.g. `/api/v1/cameras`) — added per Section 6a so the public contract can stay stable once Models 2–5 depend on it.

| Method | Endpoint | Auth Roles | Purpose |
|---|---|---|---|
| GET | `/livez` | Public | Service liveness probe (ops/load-balancer only — distinct from camera health monitoring) |
| POST | `/auth/login` | Public | Login, returns access + refresh token pair |
| POST | `/auth/refresh` | Public (valid refresh token required) | Exchange refresh token for new access token |
| POST | `/auth/logout` | All (authenticated) | Revoke caller's refresh token |
| POST | `/cameras` | admin, field_officer | Create single camera |
| POST | `/cameras/bulk` | admin, field_officer | Bulk upload |
| GET | `/cameras` | all (scoped for dept_viewer) | List/search/filter |
| GET | `/cameras/:id` | all (scoped for dept_viewer) | Get one camera |
| PATCH | `/cameras/:id` | admin, field_officer | Update camera |
| DELETE | `/cameras/:id` | admin | Soft-delete |
| GET | `/cameras/export` | admin, auditor | CSV export |
| POST | `/scoring/lookup` | admin, field_officer | Score by brand+model |
| POST | `/scoring/lookup/photo` | admin, field_officer | Score via label photo OCR |
| GET | `/scoring/pending-verification` | admin | List pending AI guesses |
| POST | `/scoring/verify/:verificationId` | admin | Confirm/reject AI guess |
| GET | `/health/:cameraId/history` | all (scoped) | Uptime history |
| GET | `/health/:cameraId/current` | all (scoped) | Current status |
| GET | `/health/at-risk` | admin, field_officer | Cameras trending toward failure |
| POST | `/health/:cameraId/check-now` | admin, field_officer | Manual health check trigger |
| GET | `/gis/cameras-in-bounds` | all (scoped) | Map viewport query |
| GET | `/gis/gap-analysis` | admin, field_officer | Coverage gaps |
| GET | `/gis/overlap-detection` | admin, field_officer | Redundant coverage pairs |
| GET | `/gis/heatmap` | admin, field_officer | Incident density overlay data |
| GET | `/audit-log` | admin, auditor | Query audit trail |

All endpoints except `/livez`, `/auth/login`, and `/auth/refresh` require a valid JWT (`jwt-auth.guard.ts`). Role restrictions enforced via `roles.guard.ts` + `@Roles()` decorator.

---

## 9. Non-Functional Requirements

- **Validation:** every request DTO must use `class-validator` decorators; invalid input returns HTTP 400 with field-level error messages, never a generic 500.
- **Error handling:** unhandled exceptions caught globally via `http-exception.filter.ts`, returning a consistent JSON error shape — never leak stack traces to the client.
- **Resilience:** external AI provider failures must degrade gracefully (see FR-3) and never crash or block the core request.
- **Data integrity:** cameras are never hard-deleted; use `is_active` flag.
- **Performance:** map viewport queries must use the `GIST` spatial index — never fetch the entire camera table to filter client-side.
- **Security:** passwords stored as bcrypt hashes only, never plaintext; JWT secret, refresh-token hashing secret, Cloudinary credentials, and DB credentials must be loaded from environment variables, never hardcoded.
- **Rate limiting:** global default of 100 requests/min per IP via `@nestjs/throttler`; a stricter 5 requests/min override on `POST /auth/login` and `POST /cameras/bulk` (Section 6a point 9).
- **Pagination:** all list endpoints default to page size 25, max 100 (`@Max(100)`); a request for more than 100 is rejected with HTTP 400, never silently capped (Section 6a point 10).
- **Traceability:** every request gets a correlation ID, attached to all log lines and to `audit_log.metadata`, for tracing a single action end-to-end (Section 6a minor additions).
- **CORS:** explicit origin allowlist via `enableCors()` — never a wildcard `*`.

---

## 10. Frontend Requirements (React)

- Single React app, folder structure mirrors backend modules (`camera-registry/`, `scoring/`, `health/`, `gis-map/`).
- Shared layout: transparent top navbar, present across all pages.
- Pages required for v1:
  1. **Login page**
  2. **Camera list/search page** — table view with filters (department, status, score), export button
  3. **Add/edit camera form** — supports manual entry, GPS auto-capture button, photo upload, brand/model autocomplete triggering live scoring preview
  4. **Bulk upload page** — CSV/Excel upload with per-row validation feedback
  5. **GIS map page** — Leaflet map with camera pins (colored/filterable by department, status, or integration score), overlap-pair connecting lines, optional incident heatmap toggle
  6. **Scoring verification queue** (admin only) — list of pending AI guesses with confirm/reject actions
  7. **Gap analysis / at-risk dashboard** — simple report views for coverage gaps and cameras trending toward failure
  8. **Audit log viewer** (admin/auditor only)

---

## 11. Acceptance Criteria (Definition of Done for v1)

- [ ] A field officer can add a camera via the mobile-responsive form using GPS auto-capture, and it appears correctly placed on the GIS map within the same session.
- [ ] Bulk CSV upload correctly imports valid rows and reports specific errors for invalid rows, without failing the entire batch.
- [ ] Entering a known brand/model (present in `vendor_lookup`) instantly returns an "easy/medium/hard" score with no AI call.
- [ ] Entering an unknown brand/model triggers an AI lookup, visibly marks the result as unverified, and appears in the admin's pending-verification queue.
- [ ] Confirming a pending AI guess updates the camera's record AND inserts a new `vendor_lookup` row, verifiable by re-submitting the same brand/model and confirming it now resolves via the fast path.
- [ ] The scheduled health-check job correctly updates `camera_status_history` and `camera.current_status` for at least one test IP camera endpoint.
- [ ] The overlap-detection endpoint correctly flags two seeded test cameras placed within 50 meters of each other under different departments, and does NOT flag two cameras in the same department at the same distance.
- [ ] A `dept_viewer` user cannot retrieve a camera belonging to a different department, even by directly requesting its `camera_id` via `GET /cameras/:id`.
- [ ] Every create/update/delete action produces a corresponding `audit_log` row automatically.
- [ ] If the AI provider is unreachable (simulate via invalid API key or network block), camera creation with an unrecognized brand/model still succeeds, falling back to `needs_verification`.
- [ ] Re-uploading the same bulk CSV file a second time updates the existing camera rows (matched on `department_id` + `name`) instead of creating duplicates.
- [ ] A user can log in, receive an access + refresh token pair, use `/auth/refresh` to obtain a new access token, and after calling `/auth/logout`, the old refresh token can no longer be used to obtain a new access token.
- [ ] A camera with no `ip_address` set is skipped by the health-check cron and its `current_status` remains `'unknown'` — this does not raise an error or crash the job.
- [ ] Submitting more than 6 requests within a minute to `/auth/login` from the same IP returns HTTP 429 on the excess requests.
- [ ] Requesting a page size greater than 100 on any list endpoint returns HTTP 400, not a silently truncated result.

---

## 12. Known Future Extension Point (Do Not Build Now, But Design For It)

Models 2–5 (live video ingestion, AI analytics, watchlist correlation) will be built as a **separate deployed service**, communicating with this Model 1 service only via its public REST API (e.g., to look up camera metadata by ID, or to check integration scores before attempting to connect to a camera). Do not build any video/streaming code in this repository. Keep the camera registry's public API stable and well-documented, since it will become a dependency for that future service.

---

## 13. Environment Setup (Already Completed — Confirm, Don't Recreate)

- PostgreSQL database `sentinel_model1_db` already exists with all tables created (see Section 6 schema, updated per Section 6a).
- PostGIS extension already enabled on this database.
- TimescaleDB extension is optional and may not be enabled — code must not assume `create_hypertable()` has been run; `camera_status_history` should function correctly as a plain table if it hasn't.
- The agent should generate a `.env.example` file listing required environment variables:
  ```
  DATABASE_URL=postgresql://user:password@localhost:5432/sentinel_model1_db

  JWT_SECRET=
  JWT_EXPIRY=15m
  REFRESH_TOKEN_SECRET=
  REFRESH_TOKEN_EXPIRY=7d

  OPENAI_API_KEY=
  OPENAI_MODEL=gpt-4o-mini

  CLOUDINARY_CLOUD_NAME=
  CLOUDINARY_API_KEY=
  CLOUDINARY_API_SECRET=

  CORS_ALLOWED_ORIGINS=http://localhost:5173

  PORT=3000
  ```

---

## 14. Instructions to the Coding Agent

1. Scaffold the NestJS project matching the folder structure in Section 5 exactly.
2. The database schema already reflects all Section 6a decisions (rebuilt via the updated `model1_fresh_setup.sql`). Run `npx prisma db pull` against the existing `sentinel_model1_db` database to generate `prisma/schema.prisma`, then `npx prisma generate` to produce the Prisma Client — do not hand-write the schema when the database already exists, and do not alter column names, types, or constraints during this step. From this point forward, use `npx prisma migrate dev` for any further schema change — never hand-edit the database, never re-run the SQL script, never use `prisma db push`.
3. Create a global `PrismaModule`/`PrismaService` (see Section 5 folder layout) and inject it into each feature module's service — do not create a separate database connection per module.
4. Set up global application-level concerns before feature modules: `/api/v1` prefix, `enableCors()` with an explicit allowlist, `@nestjs/throttler` (100/min default, 5/min override on login + bulk upload), the correlation-ID middleware, and the `/livez` liveness endpoint.
5. Implement modules in this order, since later modules depend on earlier ones: `users` → `auth` (including refresh-token issuance/revocation, FR-6a) → `camera-registry` → `integration-scoring` → `health-monitoring` → `gis`.
6. Implement all endpoints in Section 8 with the role restrictions specified.
7. Implement the scoring flow exactly as described in FR-3, including the human-verification feedback loop into `vendor_lookup`, using the Claude API contract defined in Section 6a point 6, and the vision-based label-photo flow from Section 6a point 8 (no separate OCR engine).
8. Implement the audit-log interceptor globally, not as a manual call inside each service method, and have it attach the correlation ID into `metadata`.
9. Implement the `applyDeptScope` helper (Section 6a point 4) as the single required choke point for all `dept_viewer`-scoped reads — do not reimplement department filtering ad hoc per service method.
10. Implement bulk camera upload as an upsert on `(department_id, name)`, per Section 6a point 5.
11. For the GIS module's spatial queries (overlap detection, map-bounds, gap analysis), use `prisma.$queryRaw` with parameterized queries against PostGIS functions — do not attempt to express these via Prisma's standard query builder, which does not support `GEOGRAPHY`/spatial operators.
12. Scaffold the React frontend per Section 10, starting with Login and Camera List/Add pages first, then GIS map, then the remaining admin-only pages.
13. Do not implement anything under Section 3 (Non-Goals) or Section 12 (Future Extension) — flag clearly if a requirement seems to require video/streaming functionality, rather than guessing at scope.
14. Validate your work against the Acceptance Criteria in Section 11 before considering any feature complete.
