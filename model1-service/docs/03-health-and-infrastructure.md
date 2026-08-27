# Phase 3: Health & Infrastructure

## What Was Built

**`GET /livez`** (`src/health/health.controller.ts`) — a liveness endpoint for ops/load-balancer probes. Not authenticated (`@Public()`), and excluded from the `/api/v1` prefix so it can be probed at a stable, version-independent path.

- Attempts `SELECT 1` against the database via `PrismaService`.
- Returns `200 { status: 'ok', database: 'ok', timestamp }` when the database responds.
- Returns `503 { status: 'error', database: 'unreachable', timestamp }` when it doesn't — confirmed manually by pointing the database connection at an invalid port and observing the 503 response, then restoring the correct connection and confirming 200 again.

## Important Distinction

`/livez` is a **service-level** health check — "is this process itself up and able to reach its database?" It is deliberately separate from the future `health-monitoring` business module (Phase 5+), which will track whether individual **cameras** are reachable and online. The two are unrelated concepts that happen to share the word "health."

## Verification

Confirmed via automated e2e test (`test/health.e2e-spec.ts`) and manual curl checks for both the 200 and 503 paths. Full detail in `testing/03-health-and-infrastructure-qa.md`.
