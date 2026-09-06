# Vehicle Ingest — Design Spec

**Status:** Approved, ready for implementation planning
**Date:** 2026-09-05
**Context:** Connects two already-built, separate systems — `video-stream`
(live per-camera HLS relay, see `AI Registry/video-stream/docs/PRD.md`) and
`vehicle-detection`/`vehicle-reid` (image-only detect → embed → store
pipeline, see `AI Registry/docs/VEHICLE_DETECTION_PHASE2_FINDINGS_AND_DECISIONS.md`).
Neither existing service can ingest live video today — `vehicle-detection`'s
`run_pipeline()` only accepts a list of static image file paths.

---

## 1. Problem

The current Re-ID pipeline only ever sees a photo someone hands it — there
is no path from "a camera is streaming live" to "a sighting exists in
`vehicle_sighting`." This spec adds that missing path: a new service that
periodically pulls a frame from each streamable camera's already-running
live feed and runs it through the existing, unchanged detection pipeline.

## 2. Research Findings (what shaped this design)

Three real approaches were investigated before choosing one — see the
brainstorming-session research; summarized here for traceability:

1. **Spawn a fresh ffmpeg per snapshot** (`ffmpeg -frames:v 1 snap.jpg`
   against the raw RTSP URL, on a timer) — the obvious first idea, and
   the command itself was verified to work directly against a real
   camera this session. **Rejected**: a sourced discussion
   (`bluenviron/mediamtx` #584, `go2rtc` #1736) confirms ffmpeg must wait
   for a fresh keyframe on every new connection — and this project's own
   cameras have already been measured this session producing segments
   20–122+ seconds apart. Spawning a new connection every 10-30s would
   mean most snapshot attempts are still waiting on their first keyframe
   when the next one is due.
2. **Frigate's real architecture** (one continuous ffmpeg per camera,
   raw YUV frames piped into shared memory, adaptive frame-dropping) —
   real, documented (`deepwiki.com/blakeblackshear/frigate`), and
   genuinely more capable, but solves a harder problem (sub-second
   reaction across dozens of always-on cameras) than this project needs.
   **Rejected as overkill** for a periodic-sampling use case.
3. **Read from `video-stream`'s already-running output** — `video-stream`
   already keeps one ffmpeg process alive per actively-watched camera,
   already paid the keyframe-wait cost once, and already writes real
   `.ts` segments to disk. Pulling one frame out of the *newest segment
   file* is a fast, local file-decode — no new RTSP connection, no
   repeated keyframe wait. **Chosen** — reuses existing, already-working
   infrastructure instead of duplicating it.

## 3. Architecture

```
video-stream (existing, unchanged)
  produces live HLS segments per camera, on demand via GET /stream/.../index.m3u8
        │
        ▼
vehicle-ingest  (NEW — this spec)
  a standalone service; for every camera with a stream_path, on a
  repeating per-camera timer:
    1. GET video-stream's /cameras once at startup (and periodically
       refreshed) to get the current camera list
    2. GET /stream/{camera_id}/index.m3u8 — same call the browser makes;
       ensures video-stream's ffmpeg is running for this camera and
       returns once the first segment exists
    3. locate the newest .ts segment for that camera directly on disk
       (video-stream/data/hls/<camera_id>/*.ts — same machine, shared
       filesystem access, no new HTTP endpoint needed on video-stream)
    4. run a fast local `ffmpeg -i <segment> -frames:v 1 -update 1 <tmp>.jpg`
       against that segment file (local file decode, not a network
       connection — this is the step that avoids re-paying the keyframe
       wait)
    5. hand the resulting frame to vehicle-detection's existing,
       unchanged run_pipeline() — loaded once at process startup, not
       per-frame (see §5)
    6. delete the temp frame immediately after step 5 completes
        │
        ▼
run_pipeline()  (existing, unchanged — detect → crop → embed → store)
        │
        ▼
vehicle_sighting table  (existing, unchanged)
```

### 3.1 Standalone service, not a background task inside an existing one

Approved: `vehicle-ingest` is its own project
(`AI Registry/vehicle-ingest/`), its own process, own `/health` endpoint —
matching how `video-stream`, `vehicle-detection`, and `vehicle-reid` are
already separated by responsibility. Rejected: adding this as a background
loop inside `vehicle-detection` would couple that service's actual job
(answer on-demand detection requests) with a second, unrelated job
(continuously ingest every live camera on a timer).

### 3.2 Scale and cadence

Approved: cycle through **every** camera with a registered `stream_path`
(~30 today), each camera re-sampled roughly every **10-30 seconds** —
not just cameras someone happens to be watching live in the browser. This
means `vehicle-ingest` itself is what keeps a camera's `video-stream`
entry alive (via its own periodic `GET .../index.m3u8` calls) even when no
human is watching — a real, deliberate expansion of `video-stream`'s
"idle cameras get swept" behavior: from `vehicle-ingest`'s perspective,
every streamable camera is now permanently "being watched."

### 3.3 Frame retention: none

Approved, matching the storage math worked out earlier in this project's
history: the raw frame is fully disposable. It exists only in a temp file
for the few seconds `run_pipeline()` needs to detect + crop + embed it,
then it is deleted. Nothing about the full frame is retained anywhere —
only the small, already-existing `vehicle_sighting` row (crop + embedding
+ metadata) persists, exactly as it does today for a manually-uploaded
photo.

## 4. Real Gap This Spec Must Close: `run_pipeline()` Cannot Run Continuously Today

`scripts/run_batch.py` is the only existing caller of `run_pipeline()`,
and it loads `VehicleDetector` (YOLO) and `VehicleEmbedder` (ONNX Re-ID)
fresh on every invocation, then exits. That is correct for a one-shot
batch job over a static folder — it is the wrong shape for something
called every 10-30 seconds across ~30 cameras: reloading two real models
that often would be needlessly slow and wasteful.

`vehicle-ingest` must instead load `VehicleDetector` and `VehicleEmbedder`
**once, at process startup** — mirroring exactly the pattern
`vehicle-detection/src/api.py`'s own `_lifespan` already uses for its
FastAPI app — and reuse those same loaded objects across every camera and
every cycle. `run_pipeline()` itself needs no changes; it already accepts
a pre-constructed `detector`/`embedder`/`store` rather than constructing
them internally.

## 5. Non-Goals (this build)

- **No motion detection / smart pre-filtering.** Every cycle runs full
  detection on whatever frame comes back, even if nothing changed since
  the last one. A real, deferred optimization (Frigate's own approach) —
  not needed for this build's scale.
- **No new frontend.** Pure background service; nothing in
  `frontend/src/pages/stream/` changes because of this spec.
- **No changes to `video-stream`, `vehicle-detection`, or `vehicle-reid`'s
  existing code.** This is additive — a new service that calls existing,
  unmodified APIs/functions.
- **No raw-frame archival**, per §3.3.
- **No ANPR / license-plate reading** — unrelated, separate, pre-existing
  scope decision (see
  `AI Registry/docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md`).

## 6. Open Questions for the Implementation Plan

Left for the writing-plans step, not decided here:

- Exact per-camera concurrency model (sequential cycle through all 30
  cameras vs. one lightweight async task per camera) — affects how
  quickly a full sweep of all cameras completes relative to the
  10-30s target cadence.
- Whether `vehicle-ingest` needs its own idle/backoff logic for a camera
  whose `stream_path` repeatedly fails (e.g. the real gateway auth/decode
  issues already documented in `video-stream`'s own PRD Known Gaps) —
  likely yes, to avoid hammering a genuinely broken camera every cycle.
- Whether `vehicle-ingest` reads `video-stream`'s `data/hls/` directory
  directly (same machine, simplest) or whether a small new read-only
  endpoint on `video-stream` (e.g. "give me the newest segment's bytes")
  is worth adding for deployment flexibility (different machines) later.
  This spec assumes same-machine direct file access, matching how both
  services already run today.
