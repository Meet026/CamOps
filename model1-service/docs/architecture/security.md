# Security

## Token Design

Login issues two tokens:

- **Access token** — a signed JWT, 15 minute expiry, carries `{ sub: userId, role, departmentId }`. Sent as `Authorization: Bearer <token>` on every subsequent request.
- **Refresh token** — a random 96-character hex string, 7 day expiry. Only ever shown to the client once, at issuance. Stored server-side in the `refresh_token` table as a **SHA-256 hash**, never in plaintext — a database leak alone does not hand out usable sessions.

This split exists so a stolen access token has a short blast radius (it expires in 15 minutes), while the longer-lived refresh token can be explicitly revoked without waiting for a JWT's own expiry.

**Revocation:** `POST /auth/logout` sets `revoked_at` on the caller's refresh token row. Any later `POST /auth/refresh` call with that token is rejected. Confirmed working end-to-end during the Phase 1-4 final regression pass.

**Not yet implemented:** refresh token rotation (issuing a new refresh token on every use, invalidating the old one). Currently a refresh only issues a new access token; the same refresh token remains valid until it expires or is explicitly revoked. See `MAIN.md`'s Future Improvements.

## Role-Based Access Control

Four roles: `admin`, `field_officer`, `dept_viewer`, `auditor`. Enforced in two layers:

1. **`JwtAuthGuard`** (global) — every route requires a valid JWT unless marked `@Public()`.
2. **`RolesGuard`** (global) — checks the authenticated user's role against a route's `@Roles('admin', 'field_officer')` decorator, if present. No decorator means any authenticated role can access the route.

## Department-Level Row Scoping

`dept_viewer` users must only ever see their own department's data — never another department's, even by directly requesting a specific record ID. This is enforced through **one required choke point**: `applyDeptScope(baseWhere, currentUser)` in `src/common/scoping/dept-scope.helper.ts`. Any service method reading camera-derived data for a role that can be `dept_viewer` must route its Prisma `where` clause through this helper, which injects `departmentId` for `dept_viewer` and always overrides any caller-supplied `departmentId` — a `dept_viewer` can never widen their own scope.

This helper exists now (built in Phase 1-4 as a pure utility) but has no real callers yet — it will be used once the `camera-registry` and `gis` modules are built and have queries to scope.

**Future hardening, not yet implemented:** Postgres Row-Level Security (RLS) policies on the `camera` table, as defense-in-depth so a missed application-layer check still can't leak cross-department data. Documented as a deliberate v1 trade-off, not an oversight — see `MAIN.md`'s Future Improvements.

## Password Storage

Passwords are hashed with `bcrypt` (cost factor 10) before storage in `app_user.password_hash`. Plaintext passwords are never stored or logged.

## CORS

An explicit origin allowlist, read from the `CORS_ALLOWED_ORIGINS` environment variable (comma-separated), configured via NestJS's `enableCors()`. Never a wildcard `*`, since this API handles authenticated requests with credentials.
