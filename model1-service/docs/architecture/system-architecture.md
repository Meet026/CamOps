# System Architecture

Model 1's backend is a **NestJS modular monolith** — a single deployed process, organized into strictly separated feature modules that communicate only through NestJS dependency injection (direct service method calls), never through network calls or direct cross-module database access.

Source specs: `../../../Model1-PRD.md` (Section 4: tech stack and architecture pattern, Section 5: required module structure) and `../../../Model1-Low-Level-Design.md` (Section 1: module/folder structure), both at the repo root.

## Module Boundary Rule

A module must only interact with another module's data through that module's exported service methods. For example, the future `gis` module must never query the `camera` table directly via `PrismaService` — it must call `camera-registry`'s service. This discipline is what keeps a monolith "modular" instead of tangled, and preserves the option to split a module into its own microservice later without a rewrite.

## Modules Built So Far (Phases 1-4)

| Module | Responsibility |
|---|---|
| `config/` | Loads and validates all environment variables at boot; the only place `process.env` is read |
| `prisma/` | Global module wrapping `PrismaClient`; injected everywhere, one connection for the whole app |
| `common/` | Cross-cutting concerns shared by every feature module: guards, decorators, interceptors, filters, middleware, DTOs, the dept-scoping helper |
| `health/` | The `/livez` liveness probe — service-level health, distinct from camera health monitoring |
| `users/` | Read-only user lookups (`findByEmail`, `findById`), consumed only by `auth` |
| `auth/` | Login, token refresh, logout, JWT strategy, refresh-token issuance/validation/revocation |

## Modules Planned, Not Yet Built (Phase 5+)

| Module | Responsibility |
|---|---|
| `camera-registry` | Core camera CRUD, onboarding, bulk upload |
| `integration-scoring` | ONVIF/vendor lookup, AI-assisted scoring, human verification loop |
| `health-monitoring` | Scheduled camera reachability checks, uptime history, at-risk detection |
| `gis` | Map viewport queries, gap analysis, overlap detection, incident heatmap |

Each will get its own implementation plan when work on it begins.

## Global Request Pipeline

Every inbound request passes through this pipeline, in order:

1. **Correlation ID middleware** — generates or reuses an `x-correlation-id`, attaches it to `request.correlationId`
2. **Throttler guard** — rejects requests exceeding the rate limit before any auth work happens
3. **JWT auth guard** — validates the bearer token unless the route is marked `@Public()`
4. **Roles guard** — checks the authenticated user's role against the route's `@Roles(...)` requirement, if any
5. **Validation pipe** — validates and transforms the request body/query against its DTO
6. **Controller → service** — the actual business logic
7. **Audit log interceptor** — on a successful response from a route marked `@Audit(...)`, fire-and-forget writes an `audit_log` row
8. **Exception filter** — on any error anywhere in the pipeline, formats a consistent JSON error response and never leaks a stack trace

This ordering is deliberate: rate-limit abuse is rejected before spending any time on authentication, and authentication happens before authorization.
