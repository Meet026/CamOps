# Model 1 Backend — Master Implementation Document

## Overall Project Objective

Model 1 is the centralized CCTV registry and GIS foundation for Gujarat Police's Sentinel initiative — a statewide effort to bring cameras from 26 government departments into a single, trustworthy inventory before any live video or AI-analytics platform (Models 2-5) can be built on top of it. This backend is a metadata/inventory and mapping system only: it does not touch live video streams, recording, or AI video analytics. See `../../Model1-PRD.md` for the full requirements.

## The Whole Application, In One Place

This file is Model 1's own master doc, but Sentinel as a whole is now three separate, independently deployed pieces that talk to each other. Anyone new to the project should start here for the map of how they fit together — each piece keeps its own detailed docs where linked, this section is the index, not a duplicate.

| Piece | What it is | Where it lives | Its own master doc |
|---|---|---|---|
| **Model 1 backend** | Camera registry, GIS, scoring, health monitoring — the system of record for camera metadata (this document) | `model1-service/` | This file |
| **Model 1 + Vehicle Search frontend** | The React app all of Sentinel's UI lives in — camera registry pages plus the newer Vehicle Search flow (upload → crop → route) | `frontend/` | No separate master doc yet; design intent is in [`starter/Sentinel-Frontend-PRD.md`](starter/Sentinel-Frontend-PRD.md) (camera registry) and [`starter/Vehicle-ReID-Frontend-PRD.md`](starter/Vehicle-ReID-Frontend-PRD.md) (Vehicle Search) |
| **AI Registry** | The vehicle re-identification system: a Python Re-ID model (fine-tuning in progress) plus a FastAPI detector/storage/route-formation service — a genuinely separate deployed service, not a module of this backend | `../AI Registry/` (sibling directory to `model1-service/`, not inside it) | [`../../AI Registry/docs/MAIN.md`](../../AI%20Registry/docs/MAIN.md) |

**Why AI Registry is a separate service, not a Model 1 module:** it's a different language/runtime (Python, not Node), has its own database access pattern (reuses this backend's `DATABASE_URL` directly rather than going through Model 1's API), and was an explicit architecture decision made early in that project rather than something that happened by default — see [`../../AI Registry/Ai Idea Research.md`](../../AI%20Registry/Ai%20Idea%20Research.md) Part 3.

**How the pieces actually connect, concretely:**
- The frontend's Vehicle Search page (`frontend/src/pages/vehicle-search/`) calls the AI Registry's FastAPI service directly over HTTP (`VITE_VEHICLE_API_BASE_URL`, default `http://localhost:8000`) — it does **not** go through Model 1's NestJS API for this.
- The AI Registry's Python services read Model 1's `camera` table directly (real camera names/lat-long, joined into every vehicle-route response) and write into their own `vehicle_sighting` table — both on the **same** Neon Postgres database Model 1 uses, via the same `DATABASE_URL` from `model1-service/.env` (not duplicated into a second `.env`).
- Model 1's own NestJS backend has no code awareness of vehicle Re-ID at all — the two systems share a database and (via the frontend) a UI, nothing else.

## System Architecture

A NestJS modular monolith — one deployed process, strict module boundaries enforced through dependency injection only. See [`architecture/system-architecture.md`](architecture/system-architecture.md) for the full module list and request pipeline.

## Backend Technology Stack

NestJS 10 (Node.js 24, TypeScript), npm as the package manager.

## Database Technology

PostgreSQL 16 + PostGIS, accessed through Prisma (pinned to `6.19.3`). See [`architecture/database-architecture.md`](architecture/database-architecture.md).

## API Architecture

`/api/v1` prefix, consistent error shape, correlation IDs, pagination and rate-limiting conventions. See [`architecture/api-architecture.md`](architecture/api-architecture.md).

## Authentication Strategy / Authorization Strategy

JWT access tokens (15 min) + hashed, revocable refresh tokens (7 days); four-role RBAC; a single enforced choke point for department-level row scoping. See [`architecture/security.md`](architecture/security.md) and [`04-authentication-and-authorization.md`](04-authentication-and-authorization.md).

## Module List

**Built (Phases 1-4):** `prisma`, `common`, `health` (the `/livez` liveness probe — distinct from the `health-monitoring` business module below, kept as a separate directory/class-name specifically to avoid a naming collision), `users`, `auth`

**Built (Phase 5, business modules):** `camera-registry` (+ its `bulk-upload/` and `export/` sub-modules), `scoring` (+ `providers/` — OpenAI-backed, swappable behind an `AiProvider` interface), `storage` (Cloudinary, swappable behind a `StorageProvider` interface), `health-monitoring` (+ `jobs/` — the TCP-reachability cron), `gis` (three of its four endpoints — see below)

**Deferred to a future phase (explicit user decision, not an oversight):** `GET /gis/overlap-detection` — the PRD/LLD already fully specify its query; it's in the v1 acceptance-criteria list but intentionally not built yet. Server-side map-pin clustering was also considered and deferred (frontend/client-side clustering, or a future backend enhancement).

**Frontend status (stale note corrected):** the React frontend is no longer "not started" — it exists at `frontend/` (sibling directory), covers the PRD Section 10 camera-registry pages, and now also includes the Vehicle Search flow described below. See "The Whole Application, In One Place" above and "AI Registry — Vehicle Re-ID System" below.

## Implementation Sequence

| Phase | Document / Plan | Status |
|---|---|---|
| 1. Backend Foundation | [`01-backend-foundation.md`](01-backend-foundation.md) | Complete |
| 2. Database Schema | [`02-database-schema.md`](02-database-schema.md) | Complete |
| 3. Health & Infrastructure | [`03-health-and-infrastructure.md`](03-health-and-infrastructure.md) | Complete |
| 4. Authentication & Authorization | [`04-authentication-and-authorization.md`](04-authentication-and-authorization.md) | Complete |
| 5a. Audit Trail (before/after field capture) | — (built via brainstorming + TDD, no separate plan doc) | Complete |
| 5b. Camera Registry Core (CRUD + GPS) | [`superpowers/plans/2026-08-26-camera-registry-core.md`](superpowers/plans/2026-08-26-camera-registry-core.md) | Complete |
| 5c. Camera Bulk Upload + CSV Export | [`superpowers/plans/2026-08-26-camera-bulk-upload-export.md`](superpowers/plans/2026-08-26-camera-bulk-upload-export.md) | Complete |
| 5d. Integration-Readiness Scoring + Photo Upload | [`superpowers/plans/2026-08-26-integration-scoring.md`](superpowers/plans/2026-08-26-integration-scoring.md) | Complete |
| 5e. Health Monitoring | [`superpowers/plans/2026-08-27-health-monitoring.md`](superpowers/plans/2026-08-27-health-monitoring.md) | Complete |
| 5f. GIS & Map Features (3 of 4 endpoints) | [`superpowers/plans/2026-08-27-gis-map-features.md`](superpowers/plans/2026-08-27-gis-map-features.md) | Complete |
| 5g. GIS Overlap Detection | *(deferred — user decision)* | Not started |
| 6. React Frontend (camera registry) | [`starter/Sentinel-Frontend-PRD.md`](starter/Sentinel-Frontend-PRD.md) | Built (see `frontend/`) |
| 7. Vehicle Search (frontend + AI Registry integration) | [`starter/Vehicle-ReID-Frontend-PRD.md`](starter/Vehicle-ReID-Frontend-PRD.md) | Built — see "AI Registry — Vehicle Re-ID System" below |

## Testing Strategy / QA Strategy

Every piece of this backend — Phase 1-4 foundation and every Phase 5 business module — was built test-first: a failing test was written before its implementation, verified to fail for the right reason, then made to pass. Both unit tests (mocked dependencies) and integration/e2e tests (real database, real HTTP requests via `supertest`, real PostGIS spatial queries for the GIS module, a real local TCP server for the health-check reachability probe) were used, matched to what each piece needed. Every module was also manually verified against a live running server with real curl requests before being marked complete, with all test data cleaned up afterward. See [`testing/`](testing/) for the per-phase QA breakdown (Phase 1-4 only; Phase 5 modules' verification is documented in their own plan files' Final Task sections instead).

## Security Strategy

See [`architecture/security.md`](architecture/security.md).

## Deployment Strategy

**[Needs Decision]** — not yet decided. No containerization, hosting platform, or CI/CD pipeline has been set up. This needs a deliberate decision before Model 1 moves toward production use.

## Environment Configuration

See `.env.example` at the project root for every environment variable the service needs, and `src/config/` for how they're loaded and validated. Configuration is validated at boot — the app refuses to start with missing or invalid required variables.

## Logging and Monitoring

Structured logging via NestJS's built-in `Logger`, with every request tagged by a correlation ID that's also attached to audit log entries. **[Needs Decision]**: no external log aggregation, metrics, or error-monitoring service (e.g. Sentry, Datadog) is wired up yet.

## Links to Every Implementation Document

| Document | Purpose |
|---|---|
| [`01-backend-foundation.md`](01-backend-foundation.md) | Phase 1 implementation summary |
| [`02-database-schema.md`](02-database-schema.md) | Phase 2 implementation summary |
| [`03-health-and-infrastructure.md`](03-health-and-infrastructure.md) | Phase 3 implementation summary |
| [`04-authentication-and-authorization.md`](04-authentication-and-authorization.md) | Phase 4 implementation summary |
| [`testing/01-backend-foundation-qa.md`](testing/01-backend-foundation-qa.md) | Phase 1 QA checklist |
| [`testing/02-database-schema-qa.md`](testing/02-database-schema-qa.md) | Phase 2 QA checklist |
| [`testing/03-health-and-infrastructure-qa.md`](testing/03-health-and-infrastructure-qa.md) | Phase 3 QA checklist |
| [`testing/04-authentication-and-authorization-qa.md`](testing/04-authentication-and-authorization-qa.md) | Phase 4 QA checklist |
| [`architecture/system-architecture.md`](architecture/system-architecture.md) | Module structure and request pipeline |
| [`architecture/database-architecture.md`](architecture/database-architecture.md) | Schema, ORM, migration policy |
| [`architecture/api-architecture.md`](architecture/api-architecture.md) | Versioning, errors, pagination, rate limiting, correlation IDs |
| [`architecture/security.md`](architecture/security.md) | Tokens, RBAC, department scoping, password/CORS policy |

## Current Implementation Status

| Phase | Unit Tests | E2E Tests | Manual Verification | Status |
|---|---|---|---|---|
| 1. Backend Foundation | Pass | — | Fail-fast + boot confirmed | **Complete** |
| 2. Database Schema | Pass | — | Live DB connectivity confirmed | **Complete** |
| 3. Health & Infrastructure | Pass | Pass | 200 + 503 paths both confirmed | **Complete** |
| 4. Authentication & Authorization | Pass | Pass | Full login→refresh→logout→refresh-fails cycle confirmed via curl | **Complete** |
| 5a. Audit Trail (before/after) | Pass | Pass | Confirmed via real audit_log rows inspected in psql | **Complete** |
| 5b. Camera Registry Core | Pass | Pass | CRUD + GPS lat/long round-trip confirmed via curl | **Complete** |
| 5c. Bulk Upload + CSV Export | Pass | Pass | 10k-row background job design; upload→poll→export cycle confirmed live | **Complete** |
| 5d. Integration Scoring + Photo Upload | Pass | Pass | Vendor-lookup fast path confirmed live (AI/OCR paths only e2e-verified — no OpenAI key configured, by design, see Known Issues) | **Complete** |
| 5e. Health Monitoring | Pass | Pass | Manual analog report, real TCP timeout, and at-risk threshold all confirmed live | **Complete** |
| 5f. GIS & Map Features (3/4 endpoints) | Pass | Pass | Bounds filter, grid gap-count, and heatmap all confirmed live | **Complete** |
| 5g. GIS Overlap Detection | — | — | — | **Not started (deferred)** |
| 6. React Frontend (camera registry) | — | — | Manually verified against a live backend | **Built** |
| 7. Vehicle Search (frontend + AI Registry) | — | — | Real end-to-end run confirmed (real photo → real detection/embedding → real DB route) | **Built** |

**Combined totals as of the last full regression run (2026-08-27):** 38 unit test suites / 225 tests passing, 12 e2e test suites / 45 tests passing (270 tests total). TypeScript compiles cleanly with zero errors (`npx tsc --noEmit -p tsconfig.build.json`).

## Known Issues

- **`npm audit`** reports 3 high-severity transitive vulnerabilities (`deepmerge-ts` via `@prisma/config`, pulled in by the pinned Prisma version). `npm audit fix --force` would downgrade Prisma, which is a step backward, not forward, and risks reintroducing schema-compatibility issues that motivated the current pin. Needs a deliberate Prisma-version decision, not a blind `--force`. Unchanged since Phase 1-4; re-confirmed still present as of the Phase 5f (GIS) work.
- **`npm run lint`** has a handful of strict-TypeScript-ESLint findings (mostly `any`-typed test mocks and unused destructured variables in test files, plus one floating-promise warning on `bootstrap()` in `main.ts`) — none are functional bugs, but worth a small cleanup pass before this code is treated as final.
- **`OPENAI_API_KEY` is empty in `.env`** — the vendor-lookup fast path (scoring) has been manually verified live against the real database, but the AI-guess fallback and OCR photo-identify paths have only ever been exercised through e2e tests using a fake `AiProvider` override, never against the real OpenAI API. This is a deliberate, flagged gap (the user has explicitly noted "we don't test this openai part"), not an oversight — a real key would be needed to close it.
- **GIS overlap-detection is in the PRD's v1 acceptance-criteria list but was deliberately not built** — the user chose to defer it to a future phase during the GIS module's brainstorming. The LLD already contains its exact SQL, so it's a small, well-specified addition whenever picked back up.
- Two real bugs from the Phase 1-4 regression pass are already resolved (described in `04-authentication-and-authorization-qa.md` / `01-backend-foundation-qa.md`). Real bugs found and fixed during Phase 5 (not left open — already resolved, listed here for the record): (1) `/scoring/lookup` wasn't persisting `brand`/`model` onto the camera, breaking the later confirm→`vendor_lookup` write-back — fixed. (2) The OpenAI SDK client threw synchronously at app boot whenever `OPENAI_API_KEY` was empty, crashing the entire app, not just scoring calls — fixed via lazy client construction. (3) A dangling `CronJob` timer in a health-check-cron unit test kept the Jest process alive after tests finished — fixed by stopping the job in test teardown. (4) `GET /health/:cameraId/history` returned a 500 in production because `camera_status_history.id` is a Prisma `BigInt`, which Express's default JSON serializer can't stringify — caught only by a real e2e HTTP round-trip, fixed by converting to a plain number in the service.

## AI Registry — Vehicle Re-ID System

A separate, sibling project at `../AI Registry/` (not part of this NestJS codebase — see "The Whole Application, In One Place" above for why). Summarized here so this file stays the single starting point for understanding Sentinel as a whole; full detail lives in that project's own docs, linked below rather than duplicated.

**Primary entry point for that project:** [`../../AI Registry/docs/MAIN.md`](../../AI%20Registry/docs/MAIN.md) — its own master doc, with the full chronological build story (why vehicle Re-ID was chosen over facial recognition, every phase's real decisions and bugs, in order). The rest of this section is a quick-reference summary plus the Node-specific half of the cross-project IPv6 bug story that only lives here.

**What it does:** given a photo of one vehicle, reconstruct where else that vehicle was seen — across which registered cameras, in what order — using visual re-identification (not license-plate reading; the model matches on overall vehicle appearance).

**Two Python sub-projects:**

| Sub-project | Purpose | Key docs |
|---|---|---|
| `vehicle-reid/` | The Re-ID model itself: baseline evaluation, then fine-tuning (CLIP-ReID architecture) to fix diagnosed failure modes (motion blur, background/camera bias) | [`../../AI Registry/docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md`](../../AI%20Registry/docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md), [`../../AI Registry/docs/architecture/vehicle-reid-phase0-architecture.md`](../../AI%20Registry/docs/architecture/vehicle-reid-phase0-architecture.md) |
| `vehicle-detection/` | YOLO11n vehicle detector + pgvector storage/query pipeline + the FastAPI HTTP service the frontend calls | [`../../AI Registry/docs/VEHICLE_DETECTION_PHASE2_FINDINGS_AND_DECISIONS.md`](../../AI%20Registry/docs/VEHICLE_DETECTION_PHASE2_FINDINGS_AND_DECISIONS.md) |

**Current model status — real, not hidden:** production is currently running a 500-vehicle fine-tune with a mixed, honestly-documented result (improved on most tested conditions, but got worse on one stricter separability check). A full 10,000-vehicle training run is in progress to replace it. The API and frontend are both built so swapping in the better model later is a one-line config change (`VEHICLE_REID_MODEL_PATH`), not a rebuild — see the findings doc above for the full evaluation numbers.

**The HTTP API** (`vehicle-detection/src/api.py`, FastAPI):
- `POST /vehicles/route` — upload a photo, get back a chronologically-sorted route of past sightings per detected vehicle, each entry enriched with the real camera name and lat/long (joined from this backend's own `camera` table).
- `GET /health` — live status, current similarity threshold, and which model file is loaded; surfaced read-only in the frontend's Settings page for admins.
- `ROUTE_SIMILARITY_THRESHOLD` (env var, default `0.80`) — the "is this the same vehicle" cutoff. Explicitly not a validated number yet, kept as an env var specifically so it can be retuned without a code change once there's real data to tune against.
- **No authentication of its own yet** — a real, flagged gap (see that project's own docs) — the frontend route is access-gated, but the API itself isn't. Worth closing before any wider rollout.

**Database:** no second database. Reuses this backend's exact `DATABASE_URL` (read directly from `model1-service/.env`, never duplicated into a second config) — adds two things to the same Neon instance: the `pgvector` extension and a `vehicle_sighting` table (embeddings + camera_id foreign key + detection metadata).

**A real cross-project bug worth knowing about:** this dev sandbox has a broken IPv6 route, which causes DB connections to hang or fail depending on which DB driver is used. Fixed differently on each side because each driver needed a different fix:
- **Python side** (`vehicle-detection`'s `psycopg2`): fixed via libpq's `hostaddr` connection parameter — resolve the hostname to IPv4 once, route there, but still verify TLS against the real hostname. See `sighting_store.py`'s `_connect_preferring_ipv4()`.
- **Node side** (this backend's Prisma): `psycopg2`'s fix doesn't exist for Prisma's default Rust query engine (it does its own DNS resolution, invisible to Node). Fixed instead by switching Prisma to the `pg` driver via `@prisma/adapter-pg` (`driverAdapters` preview feature) — `pg` uses Node's own `net.connect`, which correctly falls through to IPv4. One real caveat found while fixing this: Neon's `channel_binding=require` connection param makes `pg` hang too, so it's stripped specifically for this adapter's connection in `src/prisma/prisma.service.ts` (not from `DATABASE_URL` itself — other tooling like `prisma migrate` is unaffected). This is a **sandbox-environment issue, not a production concern** — flagged here so a future setup on different infrastructure doesn't waste time re-diagnosing it if the same symptom (P1001 / "can't reach database server") reappears.

**Frontend integration:** `frontend/src/pages/vehicle-search/` — `VehicleSearchPage.tsx` (upload + crop, a hand-built crop tool matching the real Claude Design mockup pixel-for-pixel, not a library) and `VehicleSearchResultsPage.tsx` (route timeline + map). Pixel-matched against the actual exported design (`Sentinel.dc.html`, handed off via a Claude Design bundle — see [`starter/Vehicle-ReID-Frontend-PRD.md`](starter/Vehicle-ReID-Frontend-PRD.md) for the full page-by-page spec written before this was built). Talks to the AI Registry API directly (`src/api/vehicleClient.ts`, its own axios instance — deliberately not sharing Model 1's `apiClient`/auth interceptor, since the two backends have different auth stories).

## Future Improvements

- **Postgres Row-Level Security (RLS)** on the `camera` table, as defense-in-depth for `dept_viewer` scoping, on top of the application-layer `applyDeptScope` choke point already built.
- **Refresh token rotation** — issue a new refresh token on every use (invalidating the old one), rather than the current design where the same refresh token remains valid across multiple uses until it expires or is explicitly revoked.
- **`GET /gis/overlap-detection`** — deferred to a future phase (see Known Issues above). LLD already specifies the exact query.
- **Server-side map-pin clustering** for `GET /gis/cameras-in-bounds` at wide zoom levels (e.g. state-wide view) — currently returns individual pins only, with no aggregation; left to either client-side clustering or a future backend enhancement.
- **Real OpenAI API verification** for the AI-guess and OCR scoring paths — currently untested against the live API (see Known Issues above); needs a real `OPENAI_API_KEY`.
- **Deployment strategy and external logging/monitoring** — both flagged above as `[Needs Decision]`.
- **Vehicle-detection API authentication** — currently open, no auth layer of its own (see "AI Registry — Vehicle Re-ID System" above); needs closing before any wider rollout, most likely by reusing this backend's existing JWTs since it's the same user base.
- **The full 10,000-vehicle Re-ID fine-tune** — in progress; will replace the current 500-vehicle model via a one-line config change once ready (see the AI Registry section above).
- **Route export/save** for Vehicle Search results (attach a found route to a case record, export, or share with another officer) — not built yet, noted as an open product question in [`starter/Vehicle-ReID-Frontend-PRD.md`](starter/Vehicle-ReID-Frontend-PRD.md).
