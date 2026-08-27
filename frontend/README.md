# Sentinel Frontend

React frontend for Model 1 — the unified CCTV camera registry and GIS
command center. Built against the real `model1-service` backend API, per
[`Sentinel-Frontend-PRD.md`](../Sentinel-Frontend-PRD.md) at the project
root.

## Stack

- **Vite + React + TypeScript** — build tooling and SPA framework.
- **Tailwind CSS v4 + hand-built primitives** (not a full shadcn/ui
  install) — the design system's color/spacing/radius tokens live in
  `src/index.css`'s `@theme` block, matching PRD Section 2 exactly.
- **TanStack Query** — all server state (caching, refetching, the bulk-
  upload job-polling pattern, the map's debounced viewport queries).
- **React Router** — client-side routing. Note: navigation between
  authenticated pages must go through in-app links/`navigate()`, never a
  full page reload — the access token is held in memory only (never
  localStorage, for XSS reduction) and is lost on a hard page load by
  design. This is enforced, tested behavior, not an oversight.
- **React-Leaflet + leaflet.heat** — the GIS map, coverage-gap overlay,
  and incident heatmap.

## Running locally

```bash
npm install
cp .env.example .env   # points at http://localhost:3000/api/v1 by default
npm run dev            # http://localhost:5173
```

Requires `model1-service` running locally (`npm run start:dev` in
`../model1-service`) — its `CORS_ALLOWED_ORIGINS` already includes
`http://localhost:5173` by default, no backend config changes needed.

## Backend gaps

See [`BACKEND_GAPS.md`](./BACKEND_GAPS.md) — a running record of every
place the UI needs something the backend doesn't expose yet (department
list, audit-log read endpoint, user list, etc.). Every gap gets the shared
`<ComingSoon />` component with an honest explanation, never faked data.

## Verification

This app has been manually verified end-to-end against the real running
backend using a headless-Chromium (Playwright) driver: real login, real
JWT decode, role-based nav, and a full camera-creation flow (form fill →
map pin placement → submit → real `POST /cameras` → real database row →
detail page render) all confirmed working with zero console errors. That
pass also caught and fixed a real infinite-render-loop bug in
`usePageTitle` (see its source comment) that `tsc`/build alone never would
have surfaced — a reminder that "it compiles" and "it works" are different
claims for this kind of app.
