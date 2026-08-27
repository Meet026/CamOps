# Model 1 Backend — Master Implementation Document

## Overall Project Objective

Model 1 is the centralized CCTV registry and GIS foundation for Gujarat Police's Sentinel initiative — a statewide effort to bring cameras from 26 government departments into a single, trustworthy inventory before any live video or AI-analytics platform (Models 2-5) can be built on top of it. This backend is a metadata/inventory and mapping system only: it does not touch live video streams, recording, or AI video analytics. See `../../Model1-PRD.md` for the full requirements.

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

**Not started at all:** the entire React frontend (PRD Section 10) — see "Future Improvements" below.

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
| 6. React Frontend | *(not yet planned)* | Not started |

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
| 6. React Frontend | — | — | — | **Not started** |

**Combined totals as of the last full regression run (2026-08-27):** 38 unit test suites / 225 tests passing, 12 e2e test suites / 45 tests passing (270 tests total). TypeScript compiles cleanly with zero errors (`npx tsc --noEmit -p tsconfig.build.json`).

## Known Issues

- **`npm audit`** reports 3 high-severity transitive vulnerabilities (`deepmerge-ts` via `@prisma/config`, pulled in by the pinned Prisma version). `npm audit fix --force` would downgrade Prisma, which is a step backward, not forward, and risks reintroducing schema-compatibility issues that motivated the current pin. Needs a deliberate Prisma-version decision, not a blind `--force`. Unchanged since Phase 1-4; re-confirmed still present as of the Phase 5f (GIS) work.
- **`npm run lint`** has a handful of strict-TypeScript-ESLint findings (mostly `any`-typed test mocks and unused destructured variables in test files, plus one floating-promise warning on `bootstrap()` in `main.ts`) — none are functional bugs, but worth a small cleanup pass before this code is treated as final.
- **`OPENAI_API_KEY` is empty in `.env`** — the vendor-lookup fast path (scoring) has been manually verified live against the real database, but the AI-guess fallback and OCR photo-identify paths have only ever been exercised through e2e tests using a fake `AiProvider` override, never against the real OpenAI API. This is a deliberate, flagged gap (the user has explicitly noted "we don't test this openai part"), not an oversight — a real key would be needed to close it.
- **GIS overlap-detection is in the PRD's v1 acceptance-criteria list but was deliberately not built** — the user chose to defer it to a future phase during the GIS module's brainstorming. The LLD already contains its exact SQL, so it's a small, well-specified addition whenever picked back up.
- Two real bugs from the Phase 1-4 regression pass are already resolved (described in `04-authentication-and-authorization-qa.md` / `01-backend-foundation-qa.md`). Real bugs found and fixed during Phase 5 (not left open — already resolved, listed here for the record): (1) `/scoring/lookup` wasn't persisting `brand`/`model` onto the camera, breaking the later confirm→`vendor_lookup` write-back — fixed. (2) The OpenAI SDK client threw synchronously at app boot whenever `OPENAI_API_KEY` was empty, crashing the entire app, not just scoring calls — fixed via lazy client construction. (3) A dangling `CronJob` timer in a health-check-cron unit test kept the Jest process alive after tests finished — fixed by stopping the job in test teardown. (4) `GET /health/:cameraId/history` returned a 500 in production because `camera_status_history.id` is a Prisma `BigInt`, which Express's default JSON serializer can't stringify — caught only by a real e2e HTTP round-trip, fixed by converting to a plain number in the service.

## Future Improvements

- **Postgres Row-Level Security (RLS)** on the `camera` table, as defense-in-depth for `dept_viewer` scoping, on top of the application-layer `applyDeptScope` choke point already built.
- **Refresh token rotation** — issue a new refresh token on every use (invalidating the old one), rather than the current design where the same refresh token remains valid across multiple uses until it expires or is explicitly revoked.
- **`GET /gis/overlap-detection`** — deferred to a future phase (see Known Issues above). LLD already specifies the exact query.
- **Server-side map-pin clustering** for `GET /gis/cameras-in-bounds` at wide zoom levels (e.g. state-wide view) — currently returns individual pins only, with no aggregation; left to either client-side clustering or a future backend enhancement.
- **Real OpenAI API verification** for the AI-guess and OCR scoring paths — currently untested against the live API (see Known Issues above); needs a real `OPENAI_API_KEY`.
- **The React frontend (PRD Section 10)** — not started at all. 8 required pages: login, camera list/search, add/edit camera form, bulk upload, GIS map, scoring verification queue, gap-analysis/at-risk dashboard, audit log viewer. This is the next major phase of work.
- **Deployment strategy and external logging/monitoring** — both flagged above as `[Needs Decision]`.
