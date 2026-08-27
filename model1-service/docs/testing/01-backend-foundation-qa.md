# Phase 1 QA: Backend Foundation

## Test Files

| File | Covers |
|---|---|
| `src/config/env.validation.spec.ts` | Happy path (valid config), missing required vars (`DATABASE_URL`, `JWT_SECRET`), wrong type (`PORT` not a number), invalid enum (`NODE_ENV`), default value fallback |
| `src/common/middleware/correlation-id.middleware.spec.ts` | Generates a new ID when none provided, reuses an incoming `x-correlation-id` header |
| `src/common/filters/http-exception.filter.spec.ts` | Formats an `HttpException` correctly, formats an unknown error as 500 with zero stack-trace/internal-detail leakage, includes correlation ID on both paths |
| `src/common/dto/pagination.dto.spec.ts` | Default values, valid input, limit-over-100 rejection, page-under-1 rejection, non-integer rejection |
| `src/app.controller.spec.ts` | Default scaffold unit test |

## Re-running

```bash
cd model1-service
npm test -- env.validation.spec.ts
npm test -- correlation-id.middleware.spec.ts
npm test -- http-exception.filter.spec.ts
npm test -- pagination.dto.spec.ts
```

## Manual Checks Performed

- App fails fast with a clear `"Invalid environment configuration"` error when `.env` is missing/invalid.
- App boots cleanly with valid configuration.
- `curl -i http://localhost:3000/api/v1/this-route-does-not-exist` returns 404 with the standard error JSON shape and an `x-correlation-id` response header.
- Rate limiting confirmed via `test/throttler.e2e-spec.ts` (see Phase 3/4 QA — throttling was verified once auth routes existed to test against, but the underlying guard was wired in Phase 1).

## Result

All Phase 1 tests pass as part of the full regression (15 unit suites / 59 tests, see `MAIN.md` status table for the combined total).
