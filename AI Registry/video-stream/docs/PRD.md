# PRD — Video Stream Relay (`AI Registry/video-stream`)

**Status:** Implemented, manually verified against real hackathon cameras.
**Scope of this document:** the `video-stream` backend only — what it
actually does today, plus ([§4](#4-for-design-user-facing-flow)) the
user-facing states and flow a designer needs to design the watch-a-camera
experience this backend supports. No frontend/UI is built or specified
here — no AI/detection, no recording either. Those remain explicitly out
of scope for this service (see [Non-Goals](#3-non-goals)).

---

## 1. Purpose

Convert a registered camera's live RTSP feed into browser-playable HLS, on
demand, so any web frontend can play a live camera feed with a plain
`<video>` tag — without embedding an RTSP player, without any AI processing,
and without keeping every camera's stream running all the time.

This exists because RTSP (what CCTV cameras actually speak) is not
playable directly in a browser. HLS is. This service is the thin,
protocol-translating relay in between — nothing more.

## 2. Where It Lives

```
AI Registry/
├── model1-service/        (NestJS — camera registry, owns the `camera` table)
├── vehicle-detection/      (Python — AI detection pipeline)
├── vehicle-reid/            (Python — AI re-identification)
└── video-stream/            (Python/FastAPI — THIS service)
```

A sibling project, not a module inside `model1-service` or
`vehicle-detection`:
- Not part of `model1-service` — that service's own scope explicitly
  excludes live video handling.
- Not part of `vehicle-detection` / `vehicle-reid` — those are AI-focused;
  this service does no AI, no frame analysis, no inference of any kind.

It has no database of its own. It reads camera metadata directly from
`model1-service`'s existing Postgres database (see [§5](#5-data--dependencies)).

## 3. Non-Goals

Explicitly and deliberately out of scope, agreed before building:

- **No AI / detection / re-ID.** This service never inspects frame
  content. It relays bytes.
- **No recording or archival.** Segments exist transiently on disk only
  as long as a stream is actively being watched; nothing is retained.
- **No video-wall / grid UI.** This is backend plumbing a future grid
  frontend would call into — the UI itself is a separate, deferred piece
  of work.
- **No camera write access.** This service never creates, edits, or
  deletes rows in the `camera` table — read-only, always.
- **No authentication of its own.** Currently has no auth layer at all
  (see [§10](#10-known-gaps--deferred-work)).

## 4. For Design: User-Facing Flow

This section translates the backend behavior above into the states,
screens, and timing a designer needs to actually design the watch-a-camera
experience. Everything here is derived from real, verified backend
behavior (see [§9](#9-verification-log-real-tests-performed)) — none of it
is aspirational.

### 4.1 The end-to-end user journey

```
[Camera picker]  →  [Connecting]  →  [Playing]  →  [Stopped / idle]
      ↑                   ↓
      └──────── [Error states] ──────────────────┘
```

1. **Camera picker** — user sees a list of cameras (from `GET /cameras`:
   `camera_id`, `name` per camera — no thumbnail/preview image exists
   today, see [§4.5](#45-what-design-does-not-have-to-work-with-yet)).
   User selects one camera to watch.
2. **Connecting** — the moment a camera is selected, the frontend requests
   `GET /stream/{camera_id}/index.m3u8`. This is the state that needs the
   most design attention — see [§4.2](#42-the-connecting-state-the-most-important-screen).
3. **Playing** — a standard HLS player (e.g. hls.js feeding a `<video>`
   tag) is now playing the live feed. Live, not seekable/DVR — there is no
   rewind, this is a live relay only.
4. **Stopped / idle** — if the user navigates away or stops watching,
   nothing needs to happen client-side immediately; the backend's own idle
   sweep (90s of no requests) stops the stream server-side automatically.
   If the user comes back to the same camera later, it's a fresh
   "Connecting" state again — the backend does not remember or resume.
5. **Error states** — see [§4.3](#43-error-states-to-design-for).

### 4.2 The "Connecting" state — the most important screen

This is the single biggest UX fact in the whole system: **a camera's
first frame can realistically take 50–90 seconds to arrive.** This was
directly measured against real hackathon cameras, not estimated — see
[§9](#9-verification-log-real-tests-performed). It is caused by real
camera/network characteristics (long keyframe intervals of 20-50s, plus
network throughput to the shared RTSP gateway), not a bug, and is not
expected to get meaningfully faster.

Design implications:

- **This cannot be a generic small spinner.** A spinner that gives no
  sense of duration will read as broken or frozen well before 50 seconds
  pass. The screen needs to actively communicate "this is normal, please
  wait" — e.g. explicit copy ("Connecting to camera — this can take up to
  a minute"), a progress indicator that doesn't imply near-instant
  completion, or an elapsed-time counter.
- **Backend contract this state is built on:** the frontend polls
  `GET /stream/{camera_id}/index.m3u8` on a retry loop; the backend
  returns `503` with an honest `Retry-After: 5` header until the first
  segment exists, then `200` once it's ready. Design should assume this
  polling pattern (poll → wait → poll again) rather than a single
  blocking request.
- **No progress percentage is available from the backend.** There's no
  way to report "40% loaded" — the backend genuinely doesn't know how
  long the wait will be per-camera (it varies per camera, per run). Design
  around an indeterminate-but-bounded wait, not a determinate progress bar.
- **Cancel/back-out should stay available** the whole time — a user
  should be able to abandon a slow-loading camera and pick another without
  being stuck.

### 4.3 Error states to design for

| Situation | Real backend signal | Suggested user-facing meaning |
|---|---|---|
| Camera has no stream configured | `404` from playlist endpoint | "This camera doesn't have live streaming set up." |
| Camera lookup / DB unreachable | `502` / `503` from either endpoint | "Camera system temporarily unavailable — try again shortly." |
| ffmpeg/server-side failure to start | `500` from playlist endpoint | "Couldn't start this stream — try again or pick another camera." |
| Camera is streaming but a specific segment 404s | `404` from segment endpoint | Normally invisible/self-healing — the player just requests the next segment; only surface an error if segments fail repeatedly. |
| User picks an invalid/unknown camera_id | `404` | Same as "no stream configured" — don't distinguish these two to the user. |

### 4.4 Multi-camera / grid implications (for future work)

Not building the grid now, but worth designing with in mind since it's
the stated end goal: if a user opens a grid of, say, 4 cameras at once,
**each tile independently goes through its own 50–90s Connecting state.**
There is no bulk/parallel-start optimization on the backend — each camera
is its own independent ffmpeg process with its own independent startup
delay. Design should treat each grid tile as its own state machine (some
tiles playing while others still show Connecting is the normal, expected
case, not a bug to hide).

### 4.5 What design does not have to work with yet

Being explicit about what's *not* available today, so design doesn't
assume it exists:

- No camera thumbnail/preview images — `GET /cameras` returns only
  `camera_id`, `name`, `stream_path`.
- No stream health/quality indicator (resolution, bitrate, fps) exposed
  via the API.
- No "camera is currently offline/unreachable" signal distinct from a
  generic error — the backend doesn't proactively know a camera is down
  until it tries to stream it.
- No authentication — there's currently no login/permission concept this
  flow needs to account for (see [§10](#10-known-gaps--deferred-work)).
- No audio — video-only feeds (`-an` — audio is explicitly stripped).

## 5. Core Design

### 5.1 On-demand lifecycle (not always-on)

Given ~dozens of registered cameras, running ffmpeg for every camera
constantly would waste CPU/bandwidth on cameras nobody is watching. Instead:

- **Start:** the first request for a camera's playlist or segment starts
  that camera's ffmpeg process. Idempotent — safe to call on every request.
- **Stay alive:** every playlist/segment request "touches" the camera,
  resetting an idle timer. HLS players naturally re-poll the playlist every
  few seconds by nature of the protocol, so normal viewing keeps a stream
  alive without any separate heartbeat mechanism.
- **Stop:** a background sweep (runs every 15s) kills any camera whose
  idle timer has exceeded the timeout (default 90s) — terminates the
  ffmpeg process and deletes its on-disk output directory.

This means: N cameras registered, but only however many are actually
being watched right now have a live ffmpeg process running.

### 5.2 Request identifier: `camera_id`, not raw RTSP URL

Callers request a stream by `camera_id` (the same UUID `model1-service`
already assigns), never by passing a raw RTSP URL. The service looks up
the real `stream_path` from the database itself. This keeps RTSP
credentials/URLs out of frontend code and out of browser network tabs.

### 5.2a Gateway authentication (added after the gateway started requiring it)

The hackathon's shared RTSP gateway (`103.250.160.189:8554`) initially
accepted unauthenticated connections (as documented and tested earlier
in this build), then began rejecting every camera with a genuine `401
Unauthorized` — confirmed directly with a raw `ffmpeg` call against the
gateway, completely bypassing this app, independent of any code here.
The gateway's own published Integrator's Guide confirmed this was
deliberate: RTSP/WebRTC connections now require a registered email +
access password embedded in the URL as userinfo
(`rtsp://email:password@host:port/...`), with the email's `@`
percent-encoded per RFC 3986.

Fix: `stream_manager.py` reads `VIDEO_STREAM_RTSP_EMAIL` /
`VIDEO_STREAM_RTSP_PASSWORD` (from a local `.env` file, loaded via the
same manual, dependency-free approach `camera_lookup.py` already uses
for `model1-service/.env`) and injects them into the bare `stream_path`
URL immediately before launching ffmpeg — never stored in the database,
never sent to the frontend. One shared set of gateway credentials, not
one per camera, matching how the gateway itself issues them (one login
per integrator). Verified end-to-end after the fix: real `200` on the
playlist endpoint, a genuine H.264 segment produced and confirmed via
`ffprobe`.

**Known, accepted exposure:** ffmpeg's RTSP demuxer has no separate
credential flags (confirmed via `ffmpeg -h demuxer=rtsp`) — only
userinfo-in-URL is supported — so the authenticated URL appears in the
ffmpeg process's argv, visible to anything reading `ps aux` /
`/proc/<pid>/cmdline` on this machine. Acceptable for this single-user
hackathon dev box; would need a different approach (e.g. a wrapper
reading the URL from a file/fd instead of argv) before running on any
shared or multi-tenant host.

### 5.3 Storage: plain disk, not tmpfs

FFmpeg's HLS muxer is fundamentally file-based — it writes a `.m3u8`
playlist plus numbered `.ts` segment files; there is no in-memory/stdout
output mode. Segments are written to plain disk under
`video-stream/data/hls/<camera_id>/`.

tmpfs (RAM-backed storage) was considered and rejected for now — it
requires an OS/container-level mount step beyond this application's
control, and for this bounded, small-scale hackathon build, plain disk
is simpler and sufficient. `-hls_flags delete_segments` keeps disk usage
bounded regardless (see [§5.4](#54-segment-rotation)) — verified for real,
not assumed (see [§9](#9-verification-log-real-tests-performed)).

### 5.4 Segment rotation

FFmpeg is run with `-hls_flags delete_segments+append_list+temp_file`: it
deletes old segments itself as new ones are written, keeping only a small
rolling window (`HLS_LIST_SIZE = 4` segments) on disk per active camera.
This service does **not** implement its own segment-deletion logic — it
relies entirely on ffmpeg's own documented behavior for this.

`temp_file` (confirmed via `ffmpeg -h muxer=hls`: "write segment and
playlist to temporary file and rename when complete") closes a real race
that was directly observed causing visible video corruption in the
browser: without it, ffmpeg writes each segment straight to its final
filename, so `GET /stream/{camera_id}/{segment}.ts` — which serves
whatever bytes exist on disk at request time, with no completeness check
— could read a genuinely truncated `.ts` file if the request landed while
ffmpeg was still flushing it. `temp_file` makes a segment only ever
appear under its real name once fully written, so a request can no
longer observe a partial file.

## 6. Data & Dependencies

### 6.1 Database (read-only)

Reads directly from `model1-service`'s Postgres `camera` table (via its
existing `DATABASE_URL`, loaded from `model1-service/.env` — no duplicated
credentials, no second database).

Relevant real columns (from `model1-service/prisma/schema.prisma`):

| Column | Type | Notes |
|---|---|---|
| `camera_id` | `uuid` | Primary key, the request identifier this service uses |
| `name` | `string` | Human-readable name, used for listing |
| `stream_path` | `string?` | **Nullable.** RTSP path/URL. Many cameras won't have this set — that's expected, not an error |

`video-stream` never writes to this table.

### 6.2 External process: ffmpeg

The only external dependency for the actual media conversion. Must be
installed and on `PATH` (`apt-get install ffmpeg`, confirmed at ffmpeg
6.1.1-3ubuntu5 in the dev environment). If missing, `ensure_started()`
raises a clear `FFMPEG_NOT_FOUND` error rather than a raw
`FileNotFoundError`.

### 6.3 Python dependencies

```
fastapi, uvicorn, psycopg2-binary
```

Deliberately minimal. Notably: `psycopg2`'s connection helper
(`_connect_preferring_ipv4`) is duplicated from
`vehicle-detection/src/sighting_store.py` rather than imported — importing
across sibling services would pull in that project's full dependency graph
(numpy etc.) for the sake of one small function. This was a real bug
(`ModuleNotFoundError: No module named 'numpy'`) hit and fixed during
development by deliberately duplicating the function with a comment
explaining why.

The IPv4-preference fix itself exists because this dev sandbox's DNS
resolver tries an unusable advertised IPv6 route to the Postgres host
first; the code resolves the hostname to IPv4 and passes it via libpq's
`hostaddr` parameter, keeping the original hostname for TLS verification.

## 7. API Surface

Base: `http://<host>:8100` (local dev; `uvicorn src.api:app --port 8100`)

### `GET /health`
Liveness check. Returns `{"status": "ok"}`.

### `GET /cameras`
Lists every camera with a real (non-null) `stream_path` — i.e. every
camera this service is actually able to stream. Intended for a future
grid frontend's camera picker.

```json
{"cameras": [{"camera_id": "...", "name": "...", "stream_path": "rtsp://..."}]}
```

- `502` if the camera listing query fails.

### `GET /stream/{camera_id}/index.m3u8`
The core endpoint. Starts the camera's ffmpeg process if not already
running (idempotent), then serves its HLS playlist.

- `200` + playlist body, once the first segment exists.
- `404` if `camera_id` has no `stream_path` registered.
- `502` if the camera lookup query itself fails.
- `500` if ffmpeg fails to start (e.g. not installed).
- **`503` with `Retry-After: 5`** while the stream is starting but the
  first segment hasn't been written yet — a real, expected transient
  state, not an error. The response body honestly states first-segment
  latency can take up to roughly a minute on this network (see
  [§9](#9-verification-log-real-tests-performed) for the measured basis
  of that claim).

### `GET /stream/{camera_id}/{segment_name}.ts`
Serves one HLS segment file. Also counts as viewer activity (resets the
idle timer) — not just playlist requests.

- `200` + segment bytes (`video/mp2t`).
- `400` if `segment_name` resolves outside the camera's own directory
  (path-traversal guard — checks `os.path.realpath` stays inside the
  camera's directory before serving).
- `404` if the segment doesn't exist — expected when ffmpeg's own
  `delete_segments` already removed it, or the player requests slightly
  ahead of when it was written.

## 8. Lifecycle & Cleanup Details

| Setting | Default | Env var |
|---|---|---|
| Idle timeout (kill after no requests) | 90s | `VIDEO_STREAM_IDLE_TIMEOUT` |
| Sweep interval (how often idle check runs) | 15s | `VIDEO_STREAM_SWEEP_INTERVAL` |
| HLS segment duration (minimum) | 2s | (not env-configurable) |
| HLS rolling window size | 4 segments | (not env-configurable) |

The 90s idle default is not arbitrary — it was raised from an initial 45s
after real testing showed some cameras' first segment can take up to ~82s
to arrive on this network (see [§9](#9-verification-log-real-tests-performed)).
90s gives headroom so the idle sweep doesn't kill a camera while its very
first segment is still in flight.

At app shutdown, every running camera's ffmpeg process is terminated and
its directory cleaned up — no orphaned processes left behind by a normal
shutdown.

A per-camera `asyncio.Lock` prevents two concurrent first-requests for the
same camera from racing and spawning duplicate ffmpeg processes.

## 9. Verification Log (real tests performed)

Every claim below was directly observed against a real, live hackathon
camera (`camera_id = 157cb862-a15d-49f2-875e-58115b35163f`, RTSP gateway
`103.250.160.189:8554/stream/cam10`) during development — not assumed from
documentation alone.

- **First-segment startup latency:** measured at ~50s and ~82s across two
  separate real runs against the same camera. Root-caused to network
  throughput to the shared hackathon RTSP gateway (confirmed via `top`
  showing ~96% idle CPU — not a local resource constraint) combined with
  this camera's own long keyframe interval (segments observed with
  `EXT-X-TARGETDURATION` of 20s, 30s, and 50s across different runs — not
  a fixed value, and much longer than the configured 2s minimum, because
  `-hls_time` is a floor, not an exact duration; ffmpeg must wait for a
  real keyframe boundary to close a segment).
- **Segment content validity:** the actual `.ts` segment produced was
  confirmed via `ffprobe` to be real, valid 1920×1080 H.264 video — not
  an empty or corrupt file.
- **Segment rotation / deletion:** directly observed over a real ~4-minute
  run — segments 0, 1, and 2 were deleted from disk as segments 3–7 were
  written, with the playlist's `MEDIA-SEQUENCE` advancing correctly to
  match. Directory size stayed bounded (~5 files at a time) rather than
  growing unbounded.
- **Idle sweep cleanup:** confirmed twice — once after a normal idle
  period (no requests for >90s: ffmpeg process gone, directory deleted),
  and once after externally hard-killing the ffmpeg process (`kill -9`,
  simulating a crash) to confirm the sweep also cleans up an orphaned
  directory left behind by an unexpected process death.
- **API-served segment integrity:** a segment fetched through
  `GET /stream/{camera_id}/{segment}.ts` was confirmed byte-identical in
  size to the copy on disk.

## 10. Known Gaps / Deferred Work

Honestly listed, not glossed over — these have **not** been tested or
built yet:

- **No automated tests.** `pytest`/`httpx`/`pytest-asyncio` are already
  scaffolded in `pyproject.toml`'s dev dependencies and a `tests/`
  directory exists, but it's currently empty — no tests have been written.
- **No authentication/authorization.** Any caller who can reach the
  service can start a stream for any camera_id with a stream_path. Fine
  for a local hackathon demo; not production-ready.
- **Concurrent-request race handling** (the `asyncio.Lock` in
  `ensure_started`) is implemented but has not been exercised with real
  concurrent requests — only reasoned about, not load-tested.
- **Invalid `camera_id` → 404 path** has not been explicitly re-tested
  end-to-end since the latest changes.
- **Path-traversal guard** on segment requests has been code-reviewed but
  never actually hit with a real malicious `../`-style request.
- **App-level restart with a stream mid-flight**: orphan handling was
  tested for an ffmpeg *crash* (kill -9 on the ffmpeg process itself),
  but not for the FastAPI app process itself being restarted while
  ffmpeg children are still running.
- **No connection pooling** for the database — a fresh `psycopg2`
  connection is opened and closed per request. Deliberate for now (this
  service is low-traffic — playlist/segment polling every couple of
  seconds per active viewer, not per frame) but would need revisiting
  under higher load.
- **Fixed segment/window sizes** (`HLS_SEGMENT_SECONDS`,
  `HLS_LIST_SIZE`) are hardcoded constants, not environment-configurable
  like the timeouts are.
- **Some cameras' streams fail to decode in Chrome/Chromium specifically
  — a real, confirmed browser-level limitation, not an app bug.**
  Directly observed with one real camera: playback would start, run for
  anywhere from ~1 to ~3.5 minutes, then die with Chrome's own
  `PIPELINE_ERROR_DECODE` (`Failed to send video packet for decoding`,
  reported against a non-keyframe). Five different frontend-side fixes
  were tried and verified NOT to resolve it — widening hls.js's buffer-
  hole tolerance, bounding the live back-buffer, widening the live-reload
  retry budget, avoiding a redundant `recoverMediaError()` call that was
  actually racing against hls.js's own internal recovery, and clearing
  the browser's sticky `HTMLMediaElement.error` state before each
  reconnect (a real defect, fixed, but not the root cause). Research
  confirmed this is a known, independently-documented class of issue:
  Chromium's media decoder is measurably stricter than Firefox/Safari
  about certain cameras' stream content (non-standard GOP/keyframe
  structures, vendor-specific encoding quirks), and — since this relay
  deliberately does `-c:v copy` with no re-encoding — whatever the camera
  produces reaches the browser completely unchanged (see e.g.
  `github.com/blakeblackshear/frigate` discussion #20187, an unrelated
  NVR project hitting the byte-for-byte identical error with RTSP
  cameras). Not fixable without adding real transcoding — a genuine scope
  change from this build's explicit "nothing fancy" design. The frontend
  surfaces this as its own honest, non-retryable state
  (`err-decode`) rather than a generic error, and most cameras are
  unaffected.

## 11. Explicit Design Decisions Made (and why)

For traceability — these were real either/or decisions made during
development, not defaults assumed without thought:

| Decision | Chosen | Rejected alternative | Why |
|---|---|---|---|
| Trigger model | On-demand (start on first request) | Always-on for all registered cameras | Wastes CPU/bandwidth on unwatched cameras at hackathon scale |
| Request identifier | `camera_id` | Raw RTSP URL passed by caller | Keeps credentials out of frontend code/network tabs; single source of truth in the DB |
| Idle cleanup | Timeout-based auto-stop, HLS polling as de facto heartbeat | Explicit client heartbeat/keepalive endpoint | HLS's own protocol behavior already provides this signal; no extra client complexity needed |
| Segment storage | Plain disk | tmpfs (RAM-backed) | tmpfs needs an OS/container mount step outside this app's control; disk is sufficient at this scale, and `delete_segments` already bounds usage |
| DB access pattern | Direct read of `model1-service`'s existing DB/table | A separate camera registry duplicated into this service | Single source of truth; avoids sync/consistency problems between two copies of camera data |
| Cross-service code reuse | Deliberately duplicate one small helper function | Import from `vehicle-detection` directly | Avoids coupling two independently-deployed services and pulling in an unrelated, heavy dependency graph (numpy) for one function |
| `ensure_started()` blocking behavior | Return immediately; client retries on `503` + `Retry-After` | Block the request server-side until the first segment exists | Given real ~50-82s startup times, blocking a request that long has no advantage over a client retry loop the frontend needs anyway (to show a "connecting" state) |

## 12. Glossary

- **RTSP** — Real Time Streaming Protocol. The native protocol CCTV
  cameras speak. Not playable directly in a browser.
- **HLS** — HTTP Live Streaming. A browser-playable format: an `.m3u8`
  playlist referencing a sequence of `.ts` video segment files.
- **GOP / keyframe interval** — how often a video stream includes a full
  reference frame. HLS segments can only be cut at keyframe boundaries,
  which is why a camera with a long keyframe interval produces long
  first-segment delays.
