# Phase 1: Backend Foundation

No business functionality was implemented in this phase — it establishes the project skeleton, configuration, and cross-cutting infrastructure that every later module builds on.

## What Was Built

**Project scaffold** — a standard NestJS project (`nest new`), created without git (`--skip-git`).

**Environment configuration and validation** (`src/config/`):
- `env.validation.ts` — a `class-validator`-backed schema (`EnvironmentVariables`) that validates every required environment variable at boot. Missing or invalid config throws immediately with a clear error, rather than the app starting in a broken state.
- `configuration.ts` — shapes validated `process.env` values into a typed, nested config object (`jwt.secret`, `database.url`, etc.), the only place the rest of the codebase reads configuration from (via `ConfigService`).
- `.env.example` — documents every environment variable the finished service needs, with all secrets left blank.

**Global HTTP exception filter** (`src/common/filters/http-exception.filter.ts`) — catches every error and returns a consistent `{ statusCode, message, error, correlationId }` JSON shape; never leaks a stack trace or internal error details.

**Correlation ID middleware** (`src/common/middleware/correlation-id.middleware.ts`) — attaches a request ID (reused from an incoming `x-correlation-id` header, or freshly generated) to every request, echoed in the response header.

**Rate limiting** (`@nestjs/throttler`) — global default of 100 requests/minute per IP, registered as a global guard.

**Shared pagination DTO** (`src/common/dto/pagination.dto.ts`) — `page`/`limit` with sane defaults and a hard maximum, meant to be extended by every future list-endpoint's query DTO.

**Application bootstrap** (`src/main.ts`) — wires the `/api/v1` global prefix, the validation pipe, the exception filter, and CORS.

## Verification

All of Phase 1's automated tests pass as part of the full Phase 1-4 regression (see `testing/01-backend-foundation-qa.md`). Manually confirmed: the app fails fast with a clear error when required environment variables are missing, and boots cleanly with valid configuration.
