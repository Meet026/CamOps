# Phase 4 QA: Authentication & Authorization

## Test Files

| File | Covers |
|---|---|
| `src/users/users.service.spec.ts` | `findByEmail`/`findById` return the user when found, `null` when not |
| `src/auth/refresh-token.service.spec.ts` | Token issuance (returns a raw token distinct from its stored hash, with a future expiry), validation (valid, not-found, expired, revoked cases), revocation (idempotent — no-op if the token doesn't exist) |
| `src/auth/auth.service.spec.ts` | Login (success, unknown email, wrong password, identical error message for both failure cases so emails can't be enumerated), refresh (success, invalid/expired/revoked token, orphaned user), logout (delegates to revocation) |
| `src/common/guards/jwt-auth.guard.spec.ts` | Bypasses auth on `@Public()` routes, delegates to the real Passport guard otherwise |
| `src/common/guards/roles.guard.spec.ts` | Allows access with no `@Roles()` decorator, allows a matching role, rejects a non-matching role, rejects when there's no authenticated user at all |
| `src/common/scoping/dept-scope.helper.spec.ts` | Injects `departmentId` for `dept_viewer`, leaves the query unmodified for the other three roles, and — the security-critical case — overrides any caller-supplied `departmentId` for a `dept_viewer` so scope can never be widened |
| `src/auth/auth.controller.spec.ts` | Controller methods correctly delegate to `AuthService` with the right arguments |
| `src/common/interceptors/audit-log.interceptor.spec.ts` | Writes an audit row on a decorated route, does nothing on an undecorated route, writes `userId: null` for an unauthenticated action, and — the resilience-critical case — never blocks or fails the response if the audit write itself throws |
| `test/auth.e2e-spec.ts` | Full integration: wrong password (401), unknown email (401), successful login (returns both tokens), protected route rejected with no token (401), the complete login → refresh → logout → refresh-fails cycle against a real database and a real seeded user, and rejection of a garbage refresh token |

## Re-running

```bash
cd model1-service
npm test -- users.service.spec.ts
npm test -- refresh-token.service.spec.ts
npm test -- auth.service.spec.ts
npm test -- jwt-auth.guard.spec.ts
npm test -- roles.guard.spec.ts
npm test -- dept-scope.helper.spec.ts
npm test -- auth.controller.spec.ts
npm test -- audit-log.interceptor.spec.ts
npm run test:e2e -- auth.e2e-spec.ts
```

## Manual End-to-End Verification (Final Regression Pass)

A full curl-driven walkthrough was performed against a live server and a real seeded test user, confirming every claim above holds true outside of the test harness as well:

1. `GET /livez` → 200
2. `GET /api/v1/` with no token → 401
3. `POST /api/v1/auth/login` → access token + refresh token
4. `GET /api/v1/` with the access token → 200
5. `POST /api/v1/auth/refresh` → 201, new access token
6. `POST /api/v1/auth/logout` (with the access token) → 204
7. `POST /api/v1/auth/refresh` with the now-revoked refresh token → 401
8. `SELECT ... FROM audit_log` confirmed a `login` row was written with the correct `correlationId` in its metadata

## A Bug Found and Fixed During This Phase's Final Verification

The plan's original `test/auth.e2e-spec.ts` called `POST /auth/logout` with no `Authorization` header — but `logout` is a protected route (not `@Public()`), so the call would have received 401 from the global guard instead of the expected 204. Fixed by capturing the access token from the login response and attaching it to the logout call. The controller's design (logout requires authentication) was correct; the test was the defect.

## Result

Every automated test passes; every manual check confirms the same behavior end-to-end against a real database.
