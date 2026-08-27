# Phase 4: Authentication & Authorization

## What Was Built

**Login / refresh / logout flow** (`src/auth/`):
- `POST /auth/login` — verifies email + bcrypt-hashed password, returns an access token (15 min JWT) and a refresh token (7 day, stored hashed).
- `POST /auth/refresh` — exchanges a valid, non-expired, non-revoked refresh token for a new access token.
- `POST /auth/logout` — revokes the caller's refresh token (requires a valid access token — you must be authenticated to end your own session).

Both login-failure paths (unknown email, wrong password) return the identical `"Invalid credentials"` message, deliberately, so the endpoint can't be used to enumerate registered emails.

**`RefreshTokenService`** (`src/auth/refresh-token.service.ts`) — issues, validates, and revokes refresh tokens. Tokens are hashed with SHA-256 before storage; the raw token is only ever visible to the client at issuance.

**`JwtStrategy` / `JwtAuthGuard`** — validates the bearer token on every request and populates `request.user` with `{ userId, role, departmentId }`. Registered globally (`APP_GUARD`), so every route requires authentication unless marked `@Public()`.

**`RolesGuard`** — checks `request.user.role` against a route's `@Roles(...)` decorator, if present.

**`applyDeptScope` helper** (`src/common/scoping/dept-scope.helper.ts`) — built in this phase as a pure utility, but has **no real callers yet**. It exists now so the pattern is established before the `camera-registry` module needs it; see `architecture/security.md` for the full design.

**Audit log interceptor** (`src/common/interceptors/audit-log.interceptor.ts`) — wired globally, writes an `audit_log` row whenever a route decorated with `@Audit(action, entityType)` responds successfully. Currently applied to `login` and `logout` (not `refresh`, since refreshing a token isn't a state-changing action worth an audit entry) as a working reference example — future business modules apply the same `@Audit(...)` decorator to their own create/update/delete/export endpoints.

## A Correction Made During Final Verification

The original plan text had `GET /` (the scaffold's placeholder root route) marked `@Public()`, but the plan's own end-to-end test asserted that route should require authentication. The test was treated as the authoritative spec — the route was left protected, matching real security intent (protected-by-default). See the implementation plan's ledger for the full reasoning.

## Verification

Confirmed end-to-end via a manual curl walkthrough covering the complete cycle: login → access a protected route with the token → refresh → logout → confirm the revoked refresh token can no longer be used. All steps behaved correctly. Full automated test coverage in `testing/04-authentication-and-authorization-qa.md`.
