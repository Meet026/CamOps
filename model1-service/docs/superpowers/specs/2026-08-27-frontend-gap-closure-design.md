# Frontend Backend-Gap Closure — Design

## Scope

Closes 7 of the 10 gaps tracked in `frontend/BACKEND_GAPS.md`:

1. `GET /departments`
2. `GET /audit-log` (read side — the write side already exists and is tested)
3. `GET /users`
4. Camera `ipAddress`/`rtspPort`/`streamPath` settable via `PATCH /cameras/:id`
5. `GET /vendor-lookup/brands`
6. `search` param on `GET /cameras`
7. `POST /auth/change-password` (the reworked version of the original
   "password reset" gap — see PRD Deviation below)

**Not in scope, per explicit decision**: gap #5 in the original numbering
(refresh-token-in-cookie-vs-body — already settled as body-token for v1)
and gap #8 (GIS overlap-detection — already deferred).

## PRD Deviation: "Password Reset" → "Change Password"

The original gap (`BACKEND_GAPS.md` #7, `Sentinel-Frontend-PRD.md` Section
4.1) described an unauthenticated forgot-password flow, explicitly marked
out of scope for v1. During brainstorming, the user asked to build
password reset but without an email-delivery mechanism (deferred to a
future phase). An unauthenticated reset with no identity verification
(email link, SMS code, etc.) would let anyone who knows a user's email
take over their account — a real security hole, unacceptable for a police
department's user base. Resolved by building the secure alternative
instead: an **authenticated Change Password** feature (current password +
new password, only usable by an already-logged-in user) — the standard
"Change Password" pattern distinct from "Forgot Password." True
self-service account recovery for locked-out users still requires the
email phase and remains deferred; the Login page's copy pointing to a
department administrator is unchanged.

## Section 1: New Read Endpoints

### `GET /departments` — roles: all authenticated

New module `src/departments/` (small, standalone — department is a shared
reference table with no other feature module naturally owning it).
`DepartmentsService.list()`: plain `prisma.department.findMany({ select:
{ departmentId: true, name: true, code: true } })`, no pagination (only 5
rows exist; not worth the ceremony).

### `GET /auth/me` — roles: all authenticated

Added to the existing `AuthController`/`AuthService`. Uses the existing
`JwtAuthGuard` (not `@Public()`) — the guard already populates
`request.user` from the JWT's `sub`/`role`/`departmentId` claims for every
other authenticated route; this endpoint additionally looks the user up
by `sub` via `UsersService` (already has a `findById`, used internally by
`AuthService.refresh`) to also return `email`, which the JWT payload
doesn't carry. Returns `{ userId, email, role, departmentId }`.

### `GET /users` — roles: admin only

Added to the existing `UsersController`/`UsersService`. Same pagination
convention as `GET /cameras` (`page`/`limit`, default 25/max 100, capped
via `@Max(100)`). Returns `{ userId, email, role, departmentId }[]`,
selecting only those columns — `passwordHash` is never included in any
response, full stop.

### `GET /vendor-lookup/brands` — roles: admin, field_officer

Added to the existing `scoring` module (owns `vendor_lookup`). Query:
`SELECT DISTINCT brand FROM vendor_lookup ORDER BY brand` via
`prisma.vendorLookup.findMany({ distinct: ['brand'], select: { brand:
true }, orderBy: { brand: 'asc' } })`. Returns `string[]`.

## Section 2: Camera Network Fields

`UpdateCameraDto` (not `CreateCameraDto` — deliberately edit-only, matching
the frontend's decision to keep the create form focused and add network
config later once a camera's IP is actually known) gains:

```typescript
@IsOptional()
@IsIP()
ipAddress?: string;

@IsOptional()
@IsInt()
@Min(1)
@Max(65535)
rtspPort?: number;

@IsOptional()
@IsString()
streamPath?: string;
```

`CameraRegistryService.applyCameraFieldChanges` gains three more entries
in its `plainFieldMap` array (`['ipAddress', 'ip_address']`,
`['rtspPort', 'rtsp_port']`, `['streamPath', 'stream_path']`), following
the exact existing pattern for `brand`/`model`/`addressText` — no new
logic shape, just three more mapped fields, diffed and written the same
way.

## Section 3: Audit Log Read Endpoint

New module `src/audit/` (the write side — `AuditLogInterceptor`,
`writeAuditLogEntry` — stays in `common/audit/` unchanged; reading is a
distinct feature surface with its own role restrictions, so it gets its
own module rather than growing `common/`, which other modules shouldn't
depend on for a read API).

`GET /audit-log` — roles: admin, auditor. Query params (`AuditLogQueryDto
extends PaginationDto`): `fromDate?`, `toDate?` (both `@IsDateString()`),
`action?`, `entityType?` (both plain strings — the real `audit_log.action`
values are open-ended, e.g. `create_camera`, `login`, `verify_scoring`,
not a fixed enum, so no `@IsIn()` allowlist), `userId?` (`@IsUUID()`).

Query: `prisma.auditLog.findMany({ where: {...conditions}, orderBy: {
createdAt: 'desc' }, skip, take })`. Conditions built the same
conditions-array pattern already used throughout this codebase
(`camerasInBounds`, `listCamerasUnpaginated`, etc.) — `createdAt: { gte:
fromDate, lte: toDate }` when either date is present, plain equality
matches for `action`/`entityType`/`userId` when present. Returns
`{ auditId, userId, action, entityType, entityId, metadata, createdAt }[]` — the
real stored shape, unchanged; `metadata` already contains
`{ correlationId, before?, after? }` from the existing interceptor/
`writeAuditLogEntry`, exactly what the frontend's diff view needs with no
new computation required.

## Section 4: Camera Search

`CameraQueryDto` gains:

```typescript
@IsOptional()
@IsString()
search?: string;
```

`CameraRegistryService.listCameras` and `.listCamerasUnpaginated` each
gain one more conditional entry in their existing `conditions: Prisma.Sql[]`
array:

```typescript
if (scoped.search) {
  conditions.push(Prisma.sql`(name ILIKE ${'%' + scoped.search + '%'} OR address_text ILIKE ${'%' + scoped.search + '%'})`);
}
```

Combined with every other filter via the existing `AND`-joined
`Prisma.join(conditions, ' AND ')` — no change to that mechanism, one more
condition in the array.

## Section 5: Change Password

`POST /auth/change-password` — roles: all authenticated (uses
`JwtAuthGuard`, not `@Public()` — this is the key difference from
`login`/`refresh`, which must be reachable by a not-yet-authenticated
caller).

Body (`ChangePasswordDto`): `{ currentPassword: string, newPassword:
string }`, both `@IsString() @IsNotEmpty()`; `newPassword` additionally
`@MinLength(8)` (a floor, not a full strength policy — matches this
project's existing minimal-validation style rather than inventing a new
password-complexity rule that doesn't exist anywhere else in the system).

`AuthService.changePassword(userId, currentPassword, newPassword)`:
1. Loads the user via the existing `UsersService.findById`.
2. `bcrypt.compare(currentPassword, user.passwordHash)` — the exact same
   call `login` already makes; `401 Unauthorized` ("Current password is
   incorrect") if it fails, not a `400`, matching how `login`'s own
   credential mismatch is reported.
3. `bcrypt.hash(newPassword, 10)` (same cost factor `login`'s comparison
   implies was used at signup — 10, the bcrypt default and what this
   codebase already uses elsewhere) → `prisma.appUser.update({ where: {
   userId }, data: { passwordHash: newHash } })`.
4. **Revokes every refresh token for that user** — `RefreshTokenService`
   gains a new `revokeAllForUser(userId)` method (`prisma.refreshToken.
   updateMany({ where: { userId, revokedAt: null }, data: { revokedAt:
   new Date() } })`), called after the password update succeeds. This is
   standard practice after a password change: every other logged-in
   session (browser tab, device) is forced to re-authenticate, so a
   compromised old password can't keep a stale session alive. The
   caller's own current session is naturally unaffected until their
   access token's normal 15-minute expiry, at which point their next
   `/auth/refresh` will also fail and they'll be prompted to log in again
   with the new password — acceptable, expected behavior after changing
   your own password.
5. Writes an audit_log entry (`@Audit('change_password', 'app_user')` on
   the controller method, same interceptor-based pattern as every other
   audited action) — metadata carries only `{ correlationId }`, no
   before/after (a password hash is never meaningful to diff/display).

## Frontend Changes (summary — implementation deferred to a follow-up task)

Once these ship, the frontend side of each gap gets wired up in the same
pass: `src/lib/departments.ts`'s hardcoded list replaced by a real
`useDepartments()` query; `AuditLogPage`'s `<ComingSoon />` replaced by
the real filterable table + diff view; `SettingsPage`'s lookup-by-ID
stopgap replaced by a real paginated user table; `CameraFormPage` gains
network-config fields (probably in the existing collapsible "hardware
details" section, or a new one) and a real brand-autocomplete dropdown;
`CameraListPage`'s search input wired to the real `search` param instead
of client-side filtering; a new "Change Password" section added to
Settings' Account panel; and the Auth context's `useQuery(['auth', 'me'])`
call added so the user's email becomes available throughout the app (most
visibly, Settings' Account panel, which currently can't show it at all).
`BACKEND_GAPS.md` gets each closed row removed (or moved to a "Closed"
section for historical record — final call at implementation time) as its
corresponding endpoint ships.

## Testing

Same TDD discipline as every prior backend module: RED → GREEN per
method, unit tests with mocked `PrismaService`, e2e tests against the
real live database for every new endpoint (role restrictions, the
change-password revoke-all-sessions behavior verified by confirming a
second session's refresh token stops working after a password change,
the audit-log query's date-range/action/entityType filtering verified
against real seeded rows), manual verification against a live server
before considering any endpoint complete.
