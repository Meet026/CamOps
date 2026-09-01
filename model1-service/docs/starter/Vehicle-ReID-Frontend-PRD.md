# Vehicle Re-ID Route Search — Frontend Integration PRD

**Product:** Sentinel — Vehicle Re-Identification & Route Reconstruction
**Scope:** Frontend integration of the new `POST /vehicles/route` endpoint into the existing Sentinel frontend (the same app documented in `Sentinel-Frontend-PRD.md`) — a new page, a new nav item, no changes to any existing Model 1 page.
**Backend status:** Complete and verified. This document is written against the real, currently-shipped API — every field, error shape, and behavior referenced below was confirmed by a real `curl` request against a running server and a real stored sighting in the live database, not assumed. See `AI Registry/docs/VEHICLE_DETECTION_PHASE2_FINDINGS_AND_DECISIONS.md` Part 9 for the backend build notes.
**Audience:** Product designer + frontend engineering team (same audience/team as the Model 1 Frontend PRD)
**Relationship to `Sentinel-Frontend-PRD.md`:** This is an addition, not a replacement. Every design-system decision in that document (color, type, spacing, motion, component library) applies here unchanged — this PRD only specifies the new page(s), nav entry, and API integration layer needed for vehicle search. Do not duplicate or fork the design system for this feature.

---

## 0. What This Feature Does, In One Paragraph

An officer has a photo of one vehicle — cropped to just that vehicle, no other cars in frame (see Section 1.1 for why) — and wants to know: **has this exact vehicle been seen by any of our registered cameras, and if so, where and when, in order?** They upload the photo. The system finds visually-similar past sightings above a similarity threshold, and returns them sorted chronologically — a **route**: camera 1 at time A, camera 2 at time B, camera 3 at time C. The frontend's job is to make uploading that photo and reading that route back feel as fast and trustworthy as everything else in Sentinel, and to be honest about the two things this feature is explicitly not: a live video search, and a fully-validated matching model (see Section 1.2).

---

## 1. Product Context & Constraints (Read Before Building)

### 1.1 Why the uploaded photo must be pre-cropped to one vehicle

The detector (YOLO) finds *every* vehicle in whatever photo it's given — it has no way to know which one an officer means if a photo shows five cars. Two designs were considered for this: (a) a two-step "upload → click the box you mean → then search" flow, or (b) requiring the upload to already be a single-vehicle crop, so "the one vehicle in the photo" and "the one the officer means" are the same thing by construction. **(b) was the explicit decision** — it's simpler, ships now, and matches how officers already work with evidence photos (cropping/zooming to the vehicle of interest is a normal step before treating a photo as an ID reference). This PRD is written entirely around option (b). If a future officer workflow needs to search directly from an uncropped scene photo, that's a new, separate feature request (a "detect first, pick one, then search" flow) — not something this page's design should awkwardly try to half-support.

**Frontend implication:** the upload UI must guide the officer toward a single-vehicle crop — an in-browser crop tool before submit (Section 5.1) rather than trusting every uploaded photo to already be correctly cropped, since a photo with 3 cars in it will silently return 3 unrelated result groups (the API's honest behavior — see 1.3) with no way for the UI to know which one the officer wanted.

### 1.2 The model is real but not yet fully trained — be honest about this everywhere

The Re-ID model currently in production is a 500-vehicle fine-tune (Phase 1). Its own before/after evaluation found real, documented weaknesses (motion blur and background/camera bias are only partially fixed; a stricter separability check got *worse*, not better, after fine-tuning). A full 10,000-vehicle training run is in progress to replace it. **This is not a frontend concern to solve — the frontend's job is to never imply more certainty than the system actually has.** Concretely:

- The similarity score returned for every match must be shown, not hidden — a "91% match" and a "81% match" are different confidence levels and an officer should see the number, not just a binary "found/not found."
- Never use language like "confirmed match" or "verified" anywhere in this UI — use "possible match" / "similar vehicle" consistently.
- No claim that a route is "complete" — it's "sightings found above the current similarity threshold," not necessarily every time the vehicle was ever seen (misses are expected and documented backend-side).

### 1.3 The real API contract this page is built against

**Endpoint:** `POST /vehicles/route` (multipart form upload, field name `photo`)

**Success response** (confirmed via a real request against the live database):

```json
{
  "detections": [
    {
      "vehicle_class": "car",
      "detection_confidence": 0.6267205476760864,
      "route": [
        {
          "sighting_id": "5258e168-f9b5-4dbe-8dce-eb21ca3d3f18",
          "camera_id": "2ac7d3e2-c1b7-42a8-a588-0acd493db088",
          "camera_name": "Chiman bhai Bridge CSITMS-32_PTZ2",
          "latitude": 23.0708,
          "longitude": 72.5869,
          "detected_at": "2026-09-01T12:41:56.907121+00:00",
          "vehicle_class": "car",
          "similarity": 1.0
        },
        {
          "sighting_id": "9a759ef3-3afa-4cfa-bcb8-efb1f7bfc3f1",
          "camera_id": "2ac7d3e2-c1b7-42a8-a588-0acd493db088",
          "camera_name": "Chiman bhai Bridge CSITMS-32_PTZ2",
          "latitude": 23.0708,
          "longitude": 72.5869,
          "detected_at": "2026-09-01T12:42:07.782045+00:00",
          "vehicle_class": "car",
          "similarity": 0.8232134063782446
        }
      ],
      "route_threshold_used": 0.8
    }
  ]
}
```

**Key contract facts the frontend must design around, not around an idealized version of this:**

- `detections` is an **array** — because the detector runs on the whole uploaded image regardless of intent (Section 1.1). Per the pre-cropped-upload decision, the frontend should treat `detections.length === 1` as the expected/happy path and treat `> 1` as a signal the crop wasn't tight enough (Section 5.2's error/warning state), not as "multiple vehicles to choose between."
- `route` is **already sorted chronologically** (`detected_at` ascending) by the backend — the frontend must not re-sort by similarity, since the whole point of a "route" is time order, not match confidence order.
- `route` can be an **empty array** — a real, expected, non-error outcome meaning "no past sighting cleared the similarity threshold." This is different from "no vehicle was detected" (`detections` itself empty) — the two empty states need different copy (Section 5.2).
- `similarity` is a float 0–1, not a percentage — the frontend formats it as a percentage for display (`Math.round(similarity * 100)}%`).
- `route_threshold_used` is echoed back per detection — **always show this in the UI** (e.g., "Showing sightings ≥ 80% similar"), since it's a provisional, tunable value (Section 1.2) and officers should know what threshold produced the results they're looking at, not just trust an opaque list.
- `latitude`/`longitude` are always present on every route entry (backend guarantees this via an inner join against the camera table — a route entry can never exist without its camera's location) — the frontend can rely on this for map rendering without a null-check-per-pin.
- A detection can instead carry an `"error"` field (e.g. `"EMBEDDING_FAILED:..."`) in place of `route`/`route_threshold_used` if that specific detection's embedding step failed — a real, typed failure mode the frontend must render distinctly from "zero results" (Section 5.2).

**Failure responses:**
- `422` — detection failed outright (e.g., corrupt/unreadable image) — real backend behavior, `detail` carries a typed reason string.
- `503` — models not yet loaded (only possible immediately after a backend restart) — treat as a transient error, retry-able.
- Standard network/5xx — handled the same way the rest of Sentinel's API layer already handles them (Section 3).

**Also available:** `GET /health` — returns `{status, route_similarity_threshold, embedder_model_path}` — **[Backend Gap]**: not required for the officer-facing flow, but genuinely useful as an admin-only diagnostic (Section 6) since `route_similarity_threshold` is exactly the number officers need surfaced per Section 1.2/1.3 above, straight from the source of truth rather than hardcoded in the frontend.

---

## 2. Where This Lives in the Existing Product

This is **not a new product** — it's one new page inside the already-shipped Sentinel frontend (`frontend/`), reusing that app's auth, layout, theme, and component library wholesale.

### 2.1 Navigation

One new item in the persistent left rail (`src/components/layout/nav-config.ts`), positioned directly after **Map** and before **Scoring** — vehicle search is an investigative/operational tool, closer in kind to the Map than to the admin-facing Scoring/Health/Audit items:

```ts
{
  label: 'Vehicle Search',
  path: '/vehicle-search',
  icon: Search, // lucide-react, distinct from Map's icon
  roles: ['admin', 'field_officer'],
}
```

**Role scope, and why:** `field_officer` and `admin` only — this mirrors exactly who can already use Scoring (the other "does real investigative/operational work" page), and deliberately excludes `dept_viewer`/`auditor`, who are read-only oversight roles in the rest of the product. **[Open question for the user, Section 8]** — confirm this role split matches how vehicle search will actually be used in the field before finalizing.

### 2.2 New route

Added to `src/App.tsx` in the same lazy-loaded, `ProtectedRoute`-wrapped pattern every other authenticated page uses:

```tsx
const VehicleSearchPage = lazy(() =>
  import('@/pages/vehicle-search/VehicleSearchPage').then((m) => ({ default: m.VehicleSearchPage }))
)

// inside the AppLayout-wrapped <Route> group:
<Route
  path="/vehicle-search"
  element={
    <ProtectedRoute allowedRoles={['admin', 'field_officer']}>
      <VehicleSearchPage />
    </ProtectedRoute>
  }
/>
```

### 2.3 New API base URL — a second backend, not a new path on the existing one

This is the one genuinely new piece of frontend plumbing: **the vehicle-detection API is a separate deployed service** from `model1-service` (see the AI Registry architecture decision — Model 1 and the AI Registry projects are intentionally separate services, not merged into one backend). `src/api/client.ts`'s existing `apiClient` is hardcoded to Model 1's base URL and its auth/refresh interceptor logic (Section 4.3 of the Model 1 Frontend PRD) — that logic is specific to Model 1's JWT contract and must not be silently reused for a different backend with a different (or absent) auth story.

**New file, `src/api/vehicleClient.ts`**, following the same shape as `client.ts` but pointed at its own base URL and — for now — with no auth interceptor, since the vehicle-detection API currently has no authentication layer of its own (**[Backend Gap]**, flagged explicitly in Section 7 — not silently designed around):

```ts
import axios from 'axios'

const VEHICLE_API_BASE_URL =
  import.meta.env.VITE_VEHICLE_API_BASE_URL ?? 'http://localhost:8000'

export const vehicleApiClient = axios.create({
  baseURL: VEHICLE_API_BASE_URL,
})
```

**New file, `src/api/vehicles.ts`**, matching the existing per-domain API file convention (`cameras.ts`, `health.ts`, etc.):

```ts
import { vehicleApiClient } from './vehicleClient'
import type { VehicleRouteResponse } from '@/types/vehicleApi'

export async function searchVehicleRoute(photo: File): Promise<VehicleRouteResponse> {
  const formData = new FormData()
  formData.append('photo', photo)
  const response = await vehicleApiClient.post<VehicleRouteResponse>('/vehicles/route', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}
```

**New file, `src/types/vehicleApi.ts`** — kept separate from `src/types/api.ts` (which models Model 1's contract specifically) for the same reason the API client is separate: this is a different backend's contract and the two should never be conflated or accidentally coupled:

```ts
export interface VehicleRouteEntry {
  sighting_id: string
  camera_id: string
  camera_name: string
  latitude: number
  longitude: number
  detected_at: string // ISO 8601
  vehicle_class: string
  similarity: number // 0–1
}

export interface VehicleDetectionResult {
  vehicle_class: string
  detection_confidence: number
  route?: VehicleRouteEntry[]
  route_threshold_used?: number
  error?: string
}

export interface VehicleRouteResponse {
  detections: VehicleDetectionResult[]
}
```

---

## 3. Error Handling — Reusing, Not Reinventing

Sentinel already has a working error-message extraction pattern (`getApiErrorMessage`/`getApiErrorStatus` in `src/api/client.ts`, Section 4.3 area) built around Model 1's specific error body shape (`{message: string | string[]}`). The vehicle-detection API's error body is simpler (`{detail: string}`, FastAPI's default shape) — **do not** force it through the existing helper and get a wrong/blank message. Add a small parallel helper in `vehicleClient.ts`:

```ts
export function getVehicleApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError<{ detail?: string }>(error)) {
    return error.response?.data?.detail ?? fallback
  }
  return fallback
}
```

Toasts, retry buttons, and the Confirm Dialog component are all reused as-is from the existing shared component library (Section 6 of the Model 1 Frontend PRD) — no new error-presentation patterns needed.

---

## 4. Design Language for This Feature

Everything from `Sentinel-Frontend-PRD.md` Section 2 (color, type, spacing, motion, iconography) applies unchanged. Feature-specific notes:

- **Similarity is a new semantic value this product hasn't displayed before** — introduce it as a colored, labeled percentage, not a bare number: ≥90% in emerald ("Strong match"), 80–89% in the brand accent indigo ("Possible match" — the default threshold band), and (only if the threshold is ever lowered below 80% — Section 1.3) 70–79% shown in amber ("Weak match — review carefully"). This borrows the existing semantic-color logic (Section 2.1 of the Model 1 PRD) rather than inventing a new palette for one feature.
- **The route timeline is this page's "hero visual"** the same way the map is Model 1's — it deserves a real, considered visual treatment (Section 5.3), not a plain list dressed up as a table.
- **The AI-assisted violet accent** (`#A855F7`, Section 2.1 of the Model 1 PRD) is reused here for the similarity-score badges and the "possible match" language generally — it already carries the product-wide meaning "AI-assisted, not human-verified," which is exactly the honest framing Section 1.2 requires.

---

## 5. Page-by-Page Specification

### 5.1 Vehicle Search — Upload & Crop

**Purpose:** Get one clean, single-vehicle photo from the officer with minimal friction, and make the "why crop?" reasoning (Section 1.1) legible without requiring them to read documentation.

**Layout:** A focused, single-purpose upload screen — mirrors the restraint of the Bulk Upload page (Model 1 PRD 5.4) rather than a busy dashboard. Centered column, max-width ~720px.

**Components & Data:**
- A short, honest one-line explainer at the top: "Upload a photo of one vehicle to search past camera sightings." — sets the single-vehicle expectation before the officer even picks a file.
- Drag-and-drop / tap-to-upload zone (reusing the same visual pattern as Bulk Upload's file zone).
- **On file selection: an in-browser crop tool opens immediately**, before any upload happens — a simple draggable/resizable crop rectangle over the selected image (a lightweight library, e.g. `react-image-crop`, is the pragmatic choice here — no new heavy dependency needed). This directly implements the Section 1.1 decision: rather than trusting the source photo is already a clean single-vehicle crop, the product actively helps the officer produce one. A "Skip cropping — use full photo" link is available below the tool for cases where the source photo is already tight (avoids forcing a redundant crop step when it's not needed), but cropping is the default, encouraged path, not a hidden option.
- Primary "Search" button — disabled until a photo (cropped or explicitly skip-cropped) is staged, full-width, brand-accent, spinner-on-submit label swap (same pattern as every other primary submit button in the product, e.g. Model 1 PRD 4.1's login button).

**States:**
- *Idle:* upload zone only.
- *Cropping:* the crop tool, with live preview.
- *Searching:* button spinner; the whole form becomes non-interactive but stays visible (not replaced by a blank loading screen) — searching can take a few seconds (real detection + embedding inference), and keeping the form visible avoids a jarring layout swap for what's a fairly quick wait.
- *Success:* navigates to the Results view (Section 5.2) with the response held in local component state (no need for a route param / persisted search — a fresh search is cheap and this avoids stale-result bugs from back-button navigation).
- *Error (422, detection failed):* inline error message above the button — "Couldn't process that photo — try a clearer image." Photo stays staged so the officer can retry without re-uploading.
- *Error (503, models loading):* "The search service is still starting up — try again in a moment," with a retry button — an honest, specific message rather than a generic failure, since this is a real, distinct, transient backend state (Section 1.3).

**Responsive:** Single-column by design already; the crop tool's touch handles meet the 44×44px minimum (Model 1 PRD Section 7) for field use on a phone — this is exactly the kind of moment (Model 1 PRD Section 8) that must be excellent on mobile, since an officer photographing a vehicle in the field is a primary use case, not an edge case.

---

### 5.2 Vehicle Search — Results

**Purpose:** Answer "where and when was this vehicle seen" clearly, honestly reflecting the real API's shape (Section 1.3) including its genuinely-empty and multi-detection states rather than hiding them.

**Layout:** Two-column on desktop (a route timeline list on the left ~40%, a map on the right ~60% showing the same points as pins connected by a route line) — collapsing to a single stacked column (timeline above map) below 1024px, following the exact same responsive pattern as the Camera Detail page's two-column layout (Model 1 PRD 5.5).

**Components & Data (the `detections.length === 1` happy path):**
- A header restating the searched photo (small thumbnail) + the detected vehicle class + `detection_confidence`, and the threshold banner required by Section 1.3: **"Showing sightings ≥ {route_threshold_used * 100}% similar."**
- **Route Timeline** (left column): each `route` entry as a card, in the array's given chronological order (never re-sorted client-side) — camera name (bold), a monospace absolute timestamp (Model 1 PRD 2.2's convention for precise data), and the similarity badge (Section 4). Cards are connected by a subtle vertical line (a literal timeline visual), each with a small numbered marker (1, 2, 3…) that corresponds to matching numbered pins on the map — a shared numbering system ties the two panels together at a glance.
- **Map** (right column): reuses the existing custom Map Pin/Marker component and muted base-map style from the Model 1 GIS page (Model 1 PRD Section 6, "Map Pin / Marker" reuse) — plotting each route entry's real `latitude`/`longitude`, connected by a polyline in chronological order, with the same numbered markers as the timeline. This is the payoff visual for the whole feature — it should feel like the Model 1 GIS map's quality bar, not a lesser, bolted-on map.
- Clicking a timeline card highlights/centers its corresponding map pin, and vice versa — a small but real cross-panel interaction, consistent with how the Camera Detail page's sidebar stays in sync with its tabs.

**States, matching the real API's actual shapes (Section 1.3) — do not collapse these into one generic "no results" state:**
- *Empty route (`route: []`), vehicle detected fine:* "No past sightings found above the 80% similarity threshold." — an honest, calm empty state (reusing the Empty State component, Model 1 PRD Section 6), explicitly not phrased as an error, since this is a completely normal outcome, not a failure.
- *No vehicle detected (`detections: []`):* a distinct empty state — "No vehicle detected in that photo — try a clearer or closer crop." This is a different problem (bad photo) from "vehicle detected, but no matches" (above), and must read differently.
- *Multiple detections (`detections.length > 1`):* per the Section 1.1 decision, this means the crop wasn't tight enough, not "pick one." Show a clear warning above the results: "This photo appears to contain more than one vehicle — results may be unreliable. For best results, crop closely to a single vehicle." — then render each detection's results stacked below with its own small header, rather than pretending the ambiguity isn't there.
- *A detection carries `error` instead of `route`:* render that one detection's card as a small inline error ("Couldn't generate a fingerprint for this vehicle") rather than crashing the whole results view — one bad detection must not take down a result the officer can otherwise still read for the other detection(s).
- *Loading:* skeleton timeline cards + a skeleton map area (shimmer, not spinner — Model 1 PRD's established loading convention).

**Actions:**
- A "New Search" button (top of page) returns to 5.1 with a clean slate.
- No save/export/share action in v1 — **[Open question, Section 8]** — whether officers need to export a route (PDF/CSV) or attach it to a case record is a real product question, not assumed here.

**Responsive:** Timeline-above-map single column below 1024px (map given a fixed ~320px height on mobile, matching the Model 1 PRD's mobile map-embed pattern from the Add/Edit Camera form, Section 5.3), full interactivity retained.

---

## 6. Admin Diagnostic Panel (Optional, Low Priority)

A small addition to the existing Settings page (Model 1 PRD 5.10), admin-only: a read-only card showing the live `GET /health` response from the vehicle-detection API — `route_similarity_threshold` (so an admin always knows the current live threshold without asking a developer) and `embedder_model_path` (so it's visible which Re-ID model — the 500-vehicle or, later, the full fine-tune — is currently live). This directly surfaces Section 1.2's "be honest about model maturity" principle as a real, checkable fact in the product itself, not just documentation. Low priority — build after the core search flow (Sections 5.1–5.2) ships.

---

## 7. Backend Gaps Discovered While Writing This Document

Flagged honestly, per the same standard `Sentinel-Frontend-PRD.md` Section 9 holds — none of these block starting frontend work on the core flow (5.1–5.2), which is fully supported by the real, working endpoint today.

| Gap | Blocks | Suggested resolution |
|---|---|---|
| No authentication on the vehicle-detection API | This endpoint is currently open — anyone who can reach it can search, with no login/role check of its own. The frontend gates access via its own route (`ProtectedRoute`, Section 2.2), but that only stops *this UI* from exposing it to unauthorized users — it does not stop a direct API call from bypassing the frontend entirely. | Needs at minimum a shared-secret/API-key check before this ships to anything beyond an internal demo; a real per-user auth story (reusing Model 1's JWTs, most likely, since both are the same officers) is worth deciding deliberately — see Section 8. |
| No endpoint to export/save/share a route | The Results page's "New Search" is the only action in v1 (Section 5.2) — no way to attach a route to a case file or hand it to another officer | Not built here since it wasn't part of the approved scope; flag as a near-term addition once the core flow is validated with real users. |
| No way to search directly from an uncropped multi-vehicle scene photo | Explicitly out of scope per the Section 1.1 decision, not a gap to fix now — noted here only so it isn't lost as a possible v2 feature | A "detect first, then pick one box, then search" two-step flow, if ever needed — a genuinely different interaction model from this PRD's, not a small addition to it. |
| No video/frame-extraction ingestion yet | This PRD (and the backend it's built on) is images-only; video support is a tracked, separate, not-yet-built piece of the AI Registry roadmap | Out of scope for this PRD entirely — noted for completeness, not a blocker. |

---

## 8. Open Questions for the User

1. **Role scope** (Section 2.1) — confirm `admin` + `field_officer` is the right access list for this page, or whether `dept_viewer`/`auditor` need read-only visibility into vehicle search results too.
2. **Authentication on the vehicle-detection API** (Section 7) — this is a real security gap before any wider rollout; decide whether it reuses Model 1's existing JWTs (most natural, since it's the same user base) or needs its own auth layer, and when that work happens relative to shipping the frontend flow.
3. **Route export/save** (Section 5.2, Section 7) — do officers need to attach a found route to a case record, export it, or share it with another officer/department? Not built in this PRD's scope; worth deciding if it's a near-term follow-up.
4. **Similarity threshold visibility/control** — this PRD shows the threshold as read-only text (Section 5.2's banner, Section 6's admin panel). Should an admin be able to *change* `ROUTE_SIMILARITY_THRESHOLD` from the UI (it's already an env var on the backend, deliberately made configurable for exactly this kind of retuning), or does that stay a backend-only/ops-only change for now?
5. **Design tool / handoff format** — same question as `Sentinel-Frontend-PRD.md` Section 10.4: whether this PRD is the direct build spec, or a high-fidelity design pass (Figma or similar) happens first using it as the brief.
