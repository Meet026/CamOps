# Phase 3 QA: Health & Infrastructure

## Test Files

| File | Covers |
|---|---|
| `src/health/health.controller.spec.ts` | Returns `ok` status when the database responds; throws `ServiceUnavailableException` (503) when the database is unreachable |
| `test/health.e2e-spec.ts` | `GET /livez` returns 200 with the correct body shape against a real database connection; confirms the route does not require authentication |

## Re-running

```bash
cd model1-service
npm test -- health.controller.spec.ts
npm run test:e2e -- health.e2e-spec.ts
```

## Manual Checks Performed

- **Happy path:** `curl -i http://localhost:3000/livez` → 200, `{"status":"ok","database":"ok","timestamp":"..."}`.
- **Failure path:** database connection pointed at an invalid port, same curl → 503, `{"status":"error","database":"unreachable",...}`. Connection restored afterward, confirmed 200 again.
- **No auth required:** confirmed the route is reachable with zero `Authorization` header, both via the e2e test and manual curl, even after Phase 4 registered the global `JwtAuthGuard`.

## Result

Both the healthy and unhealthy paths are covered by both automated tests and manual verification — the 503 path in particular is easy to accidentally skip, so it was deliberately exercised by hand.
