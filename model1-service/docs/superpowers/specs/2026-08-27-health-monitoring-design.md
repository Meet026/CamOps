# Health Monitoring (FR-4) — Design

## Scope

FR-4 in full: a scheduled TCP-reachability cron for IP cameras, a manual
check-now trigger that also serves as the analog-camera manual-status
mechanism (a real product gap the PRD left undefined), status history,
current-status, and at-risk endpoints.

Out of scope: FR-5 (GIS), any further FR-1/2/3 polish.

## PRD Corrections Made During Brainstorming

Two real gaps/conflicts were found and resolved against the user, not
silently reinterpreted:

1. **LLD's check-now definition was wrong.** The LLD stated check-now is
   "a no-op returning `unknown` if `ip_address` is null" — which would make
   it a no-op for every analog camera too, since analog cameras never have
   `ip_address`. But the PRD separately requires analog cameras be
   "manually updatable," and no endpoint anywhere in the docs ever defined
   *how*. Resolved: check-now becomes dual-mode — a real TCP check for IP
   cameras with an address, a manual status report (via request body) for
   everything else. This closes the previously-undefined analog-update gap
   using the endpoint the PRD already named for a different purpose,
   rather than inventing a new one.

2. **A proposed dept_viewer scoping change for `/health/at-risk` was
   rejected as contradicting the PRD.** The idea considered: dept_viewer
   sees at-risk cameras from all departments, but full detail only for
   their own. The PRD explicitly states, in three separate places (FR-6,
   Section 6a point 4, and a hard acceptance-test line), that dept_viewer
   "must never be able to view another department's cameras even by
   guessing a camera ID" — with no carve-out for partial/summary
   visibility. This endpoint therefore follows the PRD as documented:
   admin and field_officer only, no dept_viewer access of any kind.

## Module Layout

```
src/health/
├── health.module.ts
├── health.controller.ts       # GET /health/:cameraId/history, /current, /at-risk
│                               #   POST /health/:cameraId/check-now
├── health.service.ts          # history/current/at-risk reads, check-now orchestration
├── jobs/
│   ├── health-check.cron.ts   # the scheduled job itself
│   └── tcp-port-check.ts      # attemptTcpPortCheck(ip, port, timeoutMs) — plain Node net.Socket
```

## Cron Mechanics

- **Dynamic scheduling**: registered via `SchedulerRegistry.addCronJob()`
  at module init, reading `HEALTH_CHECK_CRON_INTERVAL_MINUTES` from config
  (default 5) to build the cron expression — not a hardcoded `@Cron(...)`
  decorator string. This is what makes the PRD's "configurable interval"
  requirement real rather than nominal.
- **Overlap guard**: an `isRunning` boolean on the cron class, checked and
  set at the top of each tick. If a previous run hasn't finished, the new
  tick logs a warning and returns immediately rather than starting a
  second concurrent run. Decided during brainstorming after reasoning
  through overlap risk: batching + per-check timeouts keep a run's total
  duration well under the 5-minute interval at this project's expected
  scale, but the guard is cheap insurance against camera-count growth or
  network conditions changing that assumption later.
- **Batching**: same shape as the existing bulk-upload background job —
  fixed batch size (e.g. 20), `Promise.all` within each batch, sequential
  across batches. Each individual TCP check has its own short timeout
  (2-3s) so one hanging/unreachable camera can't stall its batch.
- **Eligible cameras**: `camera_type = 'ip' AND ip_address IS NOT NULL AND
  is_active = true`. The `is_active` filter isn't explicit in the PRD's
  pseudocode but follows the existing project-wide pattern of never
  operating on soft-deleted cameras.
- **TCP check** (`tcp-port-check.ts`): plain Node `net.Socket` —
  `connect(port, host)`, resolves `{ online: true, responseTimeMs }` on
  `'connect'`, `{ online: false, responseTimeMs: null }` on
  `'error'`/`'timeout'`, always `destroy()`s the socket afterward. No
  external networking library — this is a basic reachability probe, not a
  protocol handshake, matching the PRD's explicit "TCP port check only,
  not RTSP handshake" scope boundary.
- **Default port**: `camera.rtspPort ?? 554` (554 is the IANA-registered
  standard RTSP port).
- **Write path**: one `camera_status_history` row per checked camera
  (`status`, `response_time_ms`, `checked_at: now()`), plus a
  `camera.current_status` update to match. **No audit_log entry** for
  cron-driven writes — FR-7's audit logging covers user actions
  (create/update/delete/export), not system-internal telemetry; this is
  consistent with treating the cron as infrastructure, not a user acting
  on the system.

## Read Endpoints

### `GET /health/:cameraId/history` — roles: all, dept_viewer scoped

Existence + dept_viewer 404-not-403 check via the existing
`CameraRegistryService.getCameraById` (same pattern as every other
single-camera read in the system), then a paginated
(`PaginationDto`, default 25/max 100) query of `camera_status_history`
rows for that camera, newest first.

### `GET /health/:cameraId/current` — roles: all, dept_viewer scoped

Same existence/scoping check, then returns
`{ currentStatus, ipAddress, rtspPort }` directly off the camera row —
no separate `camera_status_history` query needed, since `current_status`
is already kept live by the cron and check-now.

### `GET /health/at-risk` — roles: admin, field_officer only

No dept_viewer or auditor access (see PRD Corrections above). Returns
cameras with `>= HEALTH_AT_RISK_OFFLINE_THRESHOLD` (default 3, env-
configurable) offline events in `camera_status_history` within the
trailing `HEALTH_AT_RISK_WINDOW_DAYS` (default 14, env-configurable)
days. One raw SQL query:
`... FROM camera_status_history WHERE status = 'offline' AND checked_at
>= now() - interval '{window} days' GROUP BY camera_id HAVING count(*) >=
{threshold}`, joined back to `camera` for name/department/current_status
display context. Unscoped — this endpoint is never reached by
dept_viewer, so no department filter is applied.

**Response shape**: an array of
`{ cameraId, name, departmentId, currentStatus, offlineCount }` — no
envelope object, matching the existing `listCameras` response convention
(a bare array, not `{ data: [...] }`). **Not paginated** — unlike
`GET /cameras`, at-risk is an operational alert list expected to stay
small in practice (cameras that have failed 3+ times in two weeks are, by
definition, the exception, not the common case); a full page-based
contract would add complexity with no real benefit at this scale. If this
assumption turns out wrong in production, pagination can be added later
without a breaking change (an unpaginated array response can always
become a paginated one by wrapping it, whereas the reverse is a breaking
change for existing callers).

## `POST /health/:cameraId/check-now` — roles: admin, field_officer

Body: `{ status?: 'online' | 'offline' }` (optional — required only in the
manual-report branch below).

1. Load the camera via `getCameraById` (existence check; the caller's role
   here is never dept_viewer, so this is really just a 404-on-missing
   check, not an access restriction — reused for consistency with the rest
   of the codebase rather than a bespoke lookup).
2. **If `camera.cameraType === 'ip'` and `camera.ipAddress` is set**: any
   `status` in the body is silently ignored (not a validation error —
   sending it is harmless, just superfluous) — a real TCP check is
   authoritative when one is possible. Runs the same `attemptTcpPortCheck`
   the cron uses, writes the result the same way (history row +
   `current_status` update).
3. **Otherwise** (analog camera, or an IP camera with no `ip_address`
   yet): `status` is required in the body — `400 Bad Request` if missing,
   with a message explaining the camera can't be automatically checked and
   a status must be supplied. Writes the given status directly (history
   row + `current_status` update), `response_time_ms: null` since nothing
   was actually measured. **This is the analog-camera manual-update
   mechanism** the PRD required but never named an endpoint for.
4. Unlike the cron, this endpoint **does** write an `audit_log` entry
   (`@Audit('manual_health_check', 'camera')`) — it's a deliberate user
   action, not system-internal telemetry.

## Configuration

New env vars, following the project's existing pattern
(`configuration.ts` + `env.validation.ts`):
- `HEALTH_CHECK_CRON_INTERVAL_MINUTES` (default `5`)
- `HEALTH_AT_RISK_OFFLINE_THRESHOLD` (default `3`)
- `HEALTH_AT_RISK_WINDOW_DAYS` (default `14`)
- `HEALTH_CHECK_TCP_TIMEOUT_MS` (default `2500`)
- `HEALTH_CHECK_BATCH_SIZE` (default `20`)

## Error Handling

- A TCP check that times out or errors is a normal, expected outcome
  (`online: false`), never an exception that could crash a cron batch —
  matches the project-wide "unknown/offline is valid, not an error"
  philosophy already established for `onvif_status`/`ip_address`.
- The cron's overlap guard logs a warning and skips the tick silently
  (from the caller's perspective — there is no caller, it's scheduled) —
  never throws, never crashes the process.
- `check-now`'s 400 on a missing `status` for a non-checkable camera is
  the one place in this feature where a genuine client error (missing
  required input) surfaces as an HTTP error, consistent with how the rest
  of the codebase distinguishes "expected unknown state" from "caller did
  something wrong."

## Testing

Same TDD discipline as prior modules. `attemptTcpPortCheck` is tested
against a real local TCP server spun up in the test itself (both a
listening-port-succeeds case and a closed-port/refused-connection case) —
not mocked, since it's a thin wrapper with no external dependency to
isolate from. The cron class's `isRunning` guard is tested by manually
invoking the tick method twice without awaiting the first. `HealthService`
mocks `PrismaService` and the TCP-check function at the module boundary
for its own unit tests. E2E tests cover: history/current for a scoped
dept_viewer (own department succeeds, other department 404s), at-risk
role restriction, and check-now's dual-mode branch (a fake/mocked TCP
check for the IP path, a direct status body for the analog path).
