# Hackathon Video Ingest Gateway — What's Expected

Source: event registration materials (received after registering for the
hackathon). This describes a **live video ingest gateway** the event
provides — a grid of cameras streamed in real time — and what a client
consuming it is expected to do correctly.

**This is not part of `model1-service` or `frontend` today.** Model 1 is a
camera *metadata* registry + GIS layer; it deliberately does not open RTSP
connections or decode video (see `model1-service/src/health-monitoring/jobs/tcp-port-check.ts`,
which does a bare TCP port check only, by design). This document exists so
we don't lose track of what the event actually expects if/when a Model
2-style consumer needs to be built.

---

## 1. What you're connecting to

Every camera is published as a **live RTP/RTSP stream**. One second of video
takes one second to arrive, frames carry monotonic presentation timestamps
(PTS), and there is **no seeking, no byte-range fetching, no running ahead
of real time**. Treat each endpoint like a physical camera on a live
network.

| Protocol | Endpoint | Intended for |
|---|---|---|
| RTSP | `rtsp://<host>:8554/stream/<id>` | AI inference (OpenCV, GStreamer, FFmpeg, DeepStream) |
| WebRTC (WHEP) | `http://<host>:8889/stream/<id>/whep` | Low-latency browser preview |
| HLS | `http://<host>/live/stream/<id>/index.m3u8` | Dashboards, mobile, restricted networks |

**Always discover endpoints from the catalogue, never hard-code them:**

```
curl -s http://<host>/api/ingest
```

Returns every camera with its `id`, location, codec, live status, stream
properties, and all three URLs. Camera ids and the set of available
cameras can change — **the catalogue is the contract, the URL pattern is
not.**

---

## 2. Connecting — reference snippets

### OpenCV (Python)
```python
import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
import cv2

cap = cv2.VideoCapture("rtsp://<host>:8554/stream/1", cv2.CAP_FFMPEG)
while True:
    ok, frame = cap.read()
    if not ok:
        break  # reconnect — see §3
    pts_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
    ...
```

### GStreamer
```
gst-launch-1.0 rtspsrc location=rtsp://<host>:8554/stream/1 protocols=tcp latency=200 \
 ! rtph264depay ! h264parse ! avdec_h264 ! videoconvert ! fakesink
```
For H.265 streams, use `rtph265depay` and `h265parse` instead.

### FFmpeg / ffprobe
```
ffplay -rtsp_transport tcp rtsp://<host>:8554/stream/1
ffprobe -rtsp_transport tcp rtsp://<host>:8554/stream/1
```

### NVIDIA DeepStream
Use `nvurisrcbin` / `uridecodebin` with the RTSP URI and set
`select-rtp-protocol=4` (TCP). Streams are H.264 or H.265; both decode on
`nvv4l2decoder` without CPU demuxing.

---

## 3. Do's and don'ts

**DO — Force RTSP over TCP.**
UDP is accepted but fails across NAT and most corporate firewalls. Partial
UDP delivery produces corrupt frames that look like model bugs. Set
`rtsp_transport=tcp` in every client. If port 8554 is blocked on your
network, use the HLS endpoint instead.

**DON'T — Trust the reported frame rate.**
`CAP_PROP_FPS` (and equivalents) often doesn't match the actual delivery
rate. Using it to convert pixels-per-frame into speed/dwell-time/any
time-derived metric produces incorrect results. Measure the real rate
yourself, or ignore declared frame rate and use timestamps.

**DO — Drive all timing from PTS, never from arrival time.**
Use `CAP_PROP_POS_MSEC` (OpenCV), buffer PTS (GStreamer), or RTP
timestamps — not wall-clock time at read. On connect, the gateway replays
the buffered group-of-pictures so the decoder can start at a keyframe, so
the first 1-2 seconds may arrive faster than real time. A tracker
timestamping by arrival will compute impossible velocities right after
every connection. Kalman filters / multi-object trackers must be fed PTS
deltas.

**DON'T — Assume a constant frame rate.**
Frame intervals aren't guaranteed uniform. Pipelines must tolerate
inter-frame gaps without treating them as a disconnect; motion models must
use actual elapsed PTS between frames, not a fixed cadence.

**DO — Reconnect automatically, with backoff.**
Feeds are supervised and may restart. Expect brief interruptions.
Reconnect with exponential backoff (start ~2s, cap ~30s). Do not
reconnect in a tight loop.

**DON'T — Treat decode warnings at join as fatal.**
The grid has both H.264 and H.265. Attaching mid-stream can produce
decoder messages (e.g. `Error constructing the frame RPS`, `Could not
find ref with POC`) until the first IDR frame arrives. Normal,
self-corrects. Don't abort on first decoder error.

**DON'T — Assume a uniform grid.**
Cameras differ in resolution, codec, frame rate, and bitrate. Read
per-camera properties from `/api/ingest` and size batching/buffers/decoders
accordingly. A fixed-shape inference batch across every camera won't work
unscaled.

**DO — Expect a scene discontinuity.**
Each feed is a continuous recording that loops. At the loop point the
scene cuts abruptly, similar to a camera reboot. Long-lived state
(background models, re-identification galleries, track ids) should
recover from a hard cut, not assume infinite continuity.

**DON'T — Plan around obtaining copies of the footage.**
No file download. The grid is consumed live over the protocols in §1, and
that's what evaluation exercises. `/stream/<id>` is the browser-playback
fallback — it answers range requests for a media player, so `curl`/`wget`
against it yields a partial file that *looks* complete. Build against a
live capture from the start.

**DON'T — Publish to the gateway.**
Consume only. Don't push streams to any path, don't call the gateway's
control API.

**DO — Pace your load.**
Each connected client gets its own copy of the stream. Open only cameras
you're actively processing; close captures you're finished with.

---

## 4. Pre-submission checklist

- [ ] Every client forces RTSP over TCP.
- [ ] No timing logic depends on `CAP_PROP_FPS` or frame arrival time.
- [ ] Inter-frame gaps do not crash or stall the pipeline.
- [ ] Reconnect with backoff is implemented and tested by restarting a feed.
- [ ] Decoder warnings on join are logged, not fatal.
- [ ] Camera list and per-camera properties are read from `/api/ingest`.
- [ ] Pipeline handles mixed H.264 / H.265 and mixed resolutions.
- [ ] Behaviour is sane across a scene discontinuity.

---

## 5. How this maps to what's already built

| Ingest-gateway concept | `model1-service` today |
|---|---|
| `ip_address`, `rtsp_port`, `stream_path` per camera | Stored as plain metadata columns on `camera` (`prisma/schema.prisma`) — never used to open a real connection |
| Reachability / liveness | `attemptTcpPortCheck` does a bare TCP connect-and-close only — explicitly **not** an RTSP handshake (see code comment in `tcp-port-check.ts`, and PRD §6a point 2 / FR-4) |
| `GET /api/ingest` catalogue | Not called or implemented anywhere in `model1-service` or `frontend` |
| RTSP / WHEP / HLS clients | None — no OpenCV/GStreamer/FFmpeg/DeepStream dependency in either project |

**Conclusion:** this entire spec describes a **separate consumer** (a
Model-2-style AI inference service) that hasn't been started yet. If the
hackathon expects a submission that actually connects to this gateway,
that is new, unbuilt work — not something hiding in the current backend.

---

## 6. Note on camera IP addresses

The RTSP URLs given per camera (e.g. `rtsp://live.corp8.cloud:8554/stream/1`)
point at the **gateway/relay host**, not the physical camera's own network
address. Resolving `corp8.cloud` only gives the streaming server's IP — it
says nothing about where the actual CCTV device sits on Gujarat Police's
internal network, and that device is almost certainly on a private,
non-public network regardless.

We are **not** attempting to derive a camera's real IP by DNS tricks, port
scanning, or similar — that would mean probing government surveillance
infrastructure without authorization, which is out of scope no matter how
the request is framed. If a camera's real IP is ever needed (e.g. to
populate `camera.ip_address` for a genuine on-network reachability check),
the only legitimate source is the event/organizers themselves — e.g. if
`GET /api/ingest` (§1) exposes it as a field once that endpoint is actually
reachable and used.

For now, the gateway hostname+path is stored as-is in `camera.stream_path`
(see `scripts/add-hackathon-camera.js` in `model1-service`), and
`camera.ip_address` is left null for these hackathon cameras — which is a
valid, expected state (see PRD's "unknown is valid, not a bug" philosophy),
not a gap to fill in by guessing.
