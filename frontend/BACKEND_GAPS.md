# Frontend → Backend Gaps

Single running record of everything the frontend needs from the backend that
doesn't exist yet. Every time the UI hits a wall because an endpoint is
missing, it gets logged here — not silently mocked, not worked around with
fake data. Once the backend adds something listed here, remove its row and
wire up the real integration in the same commit.

Cross-reference: `Sentinel-Frontend-PRD.md` Section 9 (Backend Gaps
Discovered While Writing This Document) — this file is the living,
implementation-time version of that section; update both if a gap here
wasn't already listed there.

| # | Gap | Blocks | Current frontend treatment | Status |
|---|---|---|---|---|
| ~~1~~ | ~~No `GET /departments` list endpoint~~ | Camera List's department filter, Add/Edit form's department dropdown, camera pin popovers, Health dashboard | **Closed 2026-08-27.** `GET /departments` built (roles: all authenticated); frontend now uses `useDepartments()` (`src/hooks/useDepartments.ts`) everywhere; `src/lib/departments.ts` stopgap deleted. | **Closed** |
| ~~2~~ | ~~No audit-log read endpoint (`GET /audit-log` or similar)~~ | Audit Log Viewer page entirely | **Closed 2026-08-27** (Audit Log Viewer half only). `GET /audit-log` built (admin/auditor, filterable by action/entityType/userId/date-range, paginated). Audit Log page is now a real filterable table: absolute-timestamp/action-tag/entity(deep-links to camera detail)/correlation-id(copyable) columns, click-to-expand before/after diff view when metadata has one. Overview dashboard's "Recent Activity" panel is a separate, smaller follow-up — not built in this pass since it wasn't part of the originally-confirmed 8-gap scope; `listAuditLog()` is ready to reuse for it (scoped to ~10 rows for the current user) whenever that's picked up. | **Closed** (Overview panel: still open, small follow-up) |
| ~~3~~ | ~~No `GET /users` list endpoint~~ | Full user-management UI in Settings | **Closed 2026-08-27.** `GET /users` built (admin-only, paginated, never returns `passwordHash`); Settings' User Management panel now shows a real paginated table (email/role/department) with inline role editing via the existing `PATCH /users/:id/role`. | **Closed** |
| ~~4~~ | ~~No endpoint to set `ip_address` / `rtsp_port` on a camera~~ | Health monitoring's automated TCP check is effectively unusable for real cameras — there's no way to populate the field it depends on via the UI | **Closed 2026-08-27.** `PATCH /cameras/:id` now accepts `ipAddress`/`rtspPort`/`streamPath` (edit-only, never on create); Edit Camera form has a new collapsible "Network Configuration" section. The health-check cron can now be exercised against a real camera once an officer sets its IP via edit. | **Closed** |
| 5 | `POST /auth/refresh` expects the refresh token in the request body, not an httpOnly cookie | The PRD's recommended cookie-based refresh storage | Frontend v1 stores the refresh token in memory alongside the access token (not localStorage, not a cookie) and sends it in the request body per the real current contract. Revisit if/when the backend adds cookie support. | Open (decision made: body-token approach for v1) |
| ~~6~~ | ~~No free-text search param on `GET /cameras`~~ | Camera List's search input can only filter the currently-loaded page client-side | **Closed 2026-08-27.** `search` param added to `GET /cameras` (and CSV export), matching `ILIKE` against `name`/`address_text` server-side across the whole dataset. Camera List now has a real debounced search box wired to it. | **Closed** |
| ~~7~~ | ~~No password-change endpoint~~ | Settings had no way to change your own password | **Closed 2026-08-27.** `POST /auth/change-password` built (authenticated, current password required, revokes all refresh tokens on success). Settings now has a real Change Password section; a successful change signs the user out with a "please sign in again" message. **This is intentionally NOT self-service account recovery** — a locked-out user with no memory of their current password still has no path back in; true forgot-password/email recovery remains deferred to a future phase, per an explicit security decision (an unauthenticated reset-by-email-only flow was rejected as an account-takeover risk for a police-department user base). | **Closed** |
| 8 | `GET /gis/overlap-detection` — deferred by the user's own decision during backend GIS work, not a real gap | Map page has no overlap-detection toggle | No UI reference to it at all in v1 — adding the toggle back is a small addition once/if that endpoint ships. | Deferred (user decision) |
| ~~9~~ | ~~No endpoint to list known vendor_lookup brands~~ | Add/Edit form's Brand field has no autocomplete | **Closed 2026-08-27.** `GET /scoring/vendor-lookup/brands` built (roles: admin, field_officer); Brand field in the Hardware Details section is now a native `<datalist>`-backed autocomplete — a suggestion, not a restriction, so any brand can still be typed freely. | **Closed** |
| ~~10~~ | ~~No `GET /auth/me` (or similar) profile endpoint~~ | Settings' Account panel couldn't show the logged-in user's email | **Closed 2026-08-27.** `GET /auth/me` built (any authenticated role); `AuthContext` now exposes a `profile` field (`useQuery(['auth', 'me'])`) alongside the JWT-derived `user`; Settings shows the real email. | **Closed** |

## "Coming Soon" convention

Any page or feature blocked by an **Open** row above uses the shared
`<ComingSoon />` component (`src/components/shared/ComingSoon.tsx`) rather
than a broken or faked interaction — a calm, on-brand empty state
explaining specifically what's missing, never a silent no-op button or
console error. As of 2026-08-27, no page currently renders it (every gap
that used it — #1, #3, #4, #6, #7, #9 — is closed); the component stays in
the codebase since row #8's overlap-detection toggle is a plausible future
user of the same pattern.
