# Sentinel — The Idea, What's Built, What's Left

**Purpose of this document:** this is not a technical spec and not a build plan. It's the *thinking* document — the story of why Sentinel exists, told as one connected chain of cause-and-effect (not a feature list), plus an honest inventory of what's actually built today versus what's still missing. Written in plain language on purpose, so it can be read out loud to a jury or a teammate with zero technical background and still make sense.

For the actual technical build docs, see:
- [`model1-service/docs/MAIN.md`](model1-service/docs/MAIN.md) — the camera registry backend
- [`AI Registry/docs/MAIN.md`](AI%20Registry/docs/MAIN.md) — the vehicle Re-ID AI system

---

## 1. The Core Idea, In Plain Language

Most police CCTV systems fail before they even get to "smart AI" — they fail at the first, boring question: **do we even know which cameras exist, and are they working?**

Government audits across multiple Indian states consistently find **30–44% of CCTV cameras non-functional** at any given time. Nobody reliably knows this until they need a camera and it's dead.

Sentinel is built as a chain — each piece exists because the piece before it creates a real, specific gap that needs filling. Not a list of features bolted together, one connected argument:

```
1. You can't watch cameras you don't know exist or don't know are working.
        ↓ (so first, build a trustworthy inventory)
2. A camera that's "online" but nobody is watching stops nothing.
        ↓ (so next, actually connect to the working ones and watch them)
3. A human watching screens has limited attention — they miss things,
   and even when they see something, they can't instantly check
   "have I seen this exact vehicle somewhere else before?"
        ↓ (so finally, add AI that never blinks and never forgets)
4. AI needs two different jobs to solve this, not one:
   - Watch every camera, all the time, and quietly remember everything
   - Let a human search that memory later, on demand, by photo
```

That's the whole idea. Everything below is either already built proof of this chain, or a clearly-named gap still needed to complete it.

---

## 2. The Chain, Explained Link by Link (With Examples)

### Link 1 → 2: Why a camera registry has to exist before anything else

**The problem:** Without a registry, "watch our cameras" means guessing. Someone thinks there's a camera near Kalupur Circle, but nobody's sure it's still working, or even where exactly it is.

**What the registry gives you:** A real, trustworthy shortlist. Out of 10,000 cameras, the registry instantly tells you which 35 are near a specific highway exit *and* are currently online — instead of 10,000 unknowns.

**One-line summary:** Model 1 = a directory of TVs, and which ones are actually plugged in and working. It never turns any of them on.

### Link 2 → 3: Why just watching live video isn't the finish line either

**The problem:** Imagine a police officer sitting in front of a screen showing 10 live camera feeds. A getaway car speeds past camera #6 at 2:47 AM — but the officer is on a phone call, or looking at a different box on the screen, or just tired after a 6-hour shift. That moment is gone. Nobody saw it.

**Why a human alone can't solve this:** A person has one pair of eyes and limited attention. They cannot watch 10, 50, or 500 things simultaneously without ever missing a moment. This isn't about skill — it's a hard physical limit.

**Why "just rewatch the recording" doesn't really work either:** Even if the video was recorded, someone would have to manually scrub through hours of footage from every nearby camera, hoping to spot the right vehicle. That can take a full day of tedious work — by which time the trail is cold.

### Link 3 → 4: Why AI needs to do two different jobs, not one

This is the part worth being precise about, because it's easy to blur into one vague idea ("AI watches for us"). It's actually two separate abilities that work together:

**Job A — Detection ("AI never blinks"):** The AI watches every connected camera, continuously, and never gets distracted or tired. The moment any vehicle crosses any camera's view, the AI notices it — draws a box around it, logs the time and location — automatically, with no human needing to be watching that specific screen at that specific second.

**Job B — Re-Identification / Search ("AI never forgets"):** Later, when police actually need to investigate, they can ask a question of everything the AI has quietly recorded — for example, upload a photo of a suspicious car — and the AI instantly checks: "does this match anything I've seen before, on any camera, at any time?" It returns a chronological route: *seen at Camera X at 11:52 PM, then Camera Y at 12:08 AM, then Camera Z at 12:31 AM.*

**Why Job B only works because of Job A:** If the AI wasn't continuously running Job A — watching and fingerprinting *everything*, all the time, whether or not anyone asked it to — there would be nothing for Job B to search through later. The system isn't told "start looking for this car now." It's asked to search a memory that was *already being built the whole time*, which is exactly why it can answer questions reaching backward in time, not just forward from right now.

**One-line summary:** Job A is silent and continuous (always writing to memory). Job B is on-demand (reading from that same memory, whenever a human needs an answer).

### The plate problem — why "just read the license plate" isn't enough on its own

The obvious first idea is: read the license plate (this is called ANPR — Automatic Number Plate Recognition), match plates, done.

**Why that alone fails often in India specifically:** Roughly 78% of India's registered vehicles are two-wheelers, which frequently have small, dirty, bent, faded, or non-standard-format plates that a camera simply cannot read reliably — even a good one. There are also 50+ active plate formats across states, adding to the difficulty. So a system that *only* reads plates will silently fail on a huge share of real vehicles, exactly the ones most likely to be hard to trace any other way.

**This is why appearance-based re-identification (matching by what the vehicle looks like, not its plate) is the real differentiator** — it's the fallback that still works when the plate can't be read, which in practice is often. Plate reading and appearance matching are meant to work *together*, not as alternatives — plate reading first when it's legible (fast, precise), appearance matching always running as the fallback and cross-check.

---

## 3. What's Actually Built vs. What's Left — The Honest Inventory

```
┌──────────────────────────────────────────────────────────────┐
│ MODEL 1 — Camera Registry            ✅ FULLY BUILT           │
│ "Which cameras exist, where, do they work"                    │
└────────────────────────────┬───────────────────────────────────┘
                              │ (gives Model 2 a trusted, filtered
                              │  list of cameras to actually watch)
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ MODEL 2 — Live Video Wall            ❌ NOT BUILT              │
│ "Actually connect to cameras and watch them live"              │
└────────────────────────────┬───────────────────────────────────┘
                              │ (live video frames would feed
                              │  into the AI, continuously)
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ THE AI BRAIN                                                   │
│                                                                  │
│  Detect a vehicle in ONE photo          ✅ built, works well   │
│  Detect vehicles in LIVE video, 24/7    ❌ not built            │
│                                                                  │
│  Turn a vehicle into a "fingerprint"    ✅ built, works well   │
│  Save fingerprint + camera + time       ✅ built, works well   │
│                                                                  │
│  Search: upload photo → get the         ✅ built, works well   │
│  vehicle's full route on the map                               │
│                                                                  │
│  Read the license plate (ANPR)          ❌ not built at all    │
└──────────────────────────────────────────────────────────────┘
```

### Part 1 — Model 1: Camera Registry — ✅ Fully Built

| Piece | What it does, in plain words | Status |
|---|---|---|
| Camera Registry | Add cameras one by one, or upload thousands at once, with location/department/brand | ✅ Built, tested |
| GIS Map | See every camera as a pin on a real map | ✅ Built, tested |
| Health Check | Automatically pings each camera regularly — tells you if it's online or dead | ✅ Built, tested |
| Gap Analysis | Highlights areas on the map with NO camera coverage | ✅ Built, tested |
| Login & Roles | Different users (admin, field officer, viewer, auditor) see different things | ✅ Built, tested |
| Audit Log | Records exactly who changed what, and when | ✅ Built, tested |

**Bottom line:** This is done. You genuinely know, with confidence, which cameras exist, where they are, and whether they're working right now.

### Part 2 — Model 2: Live Video Wall — ❌ Not Built Yet

This is the video-wall idea you described: one screen, a dropdown to pick how many cameras to view at once (1, 4, 10...), the screen splits into a grid, and the officer freely picks which specific cameras go in each box.

| Piece | What it needs to do | Status |
|---|---|---|
| Connect to a real camera's live video | Actually pull a live video stream out of a camera (typically via RTSP, a standard camera video protocol) | ❌ Not built |
| Grid-view screen | The picker/grid screen itself — choose camera count, choose which cameras | ❌ Not built |
| Handle several cameras at once | Watch multiple live streams simultaneously without the system breaking | ❌ Not built |
| Feed live video into the AI | Send each live frame to the AI to be analyzed automatically, not just displayed for a human to watch | ❌ Not built |

**Bottom line:** This is the single biggest gap. Right now, zero live video connection exists anywhere in the system.

### Part 2, In Detail — Real Cameras Already Available, and How to Actually Build This

**Real discovery, checked directly against the database (not assumed):** the `camera` table already has **6 real cameras with live RTSP URLs**, all pointing at the hackathon's own ingest gateway (`live.corp8.cloud:8554` — see `HACKATHON_INGEST_SPEC.md`), one stream number per camera:

| Camera name | RTSP stream |
|---|---|
| Chiman bhai Bridge CSITMS-32_PTZ2 | `rtsp://live.corp8.cloud:8554/stream/1` |
| Janpath T CSITMS-10_PTZ2 | `rtsp://live.corp8.cloud:8554/stream/2` |
| O.N.G.C. Office BS-103_B1 | `rtsp://live.corp8.cloud:8554/stream/3` |
| Paldi Circle | `rtsp://live.corp8.cloud:8554/stream/4` |
| Visat teen Rasta | `rtsp://live.corp8.cloud:8554/stream/5` |
| Timbavadi gate-Junagadh | `rtsp://live.corp8.cloud:8554/stream/6` |

**Confirmed live and reachable** (checked directly by the project owner). This means Model 2 doesn't need a simulated/looped-video fallback — there are 6 real, working camera feeds to build against right now.

#### Step 1 — Grab still frames out of a continuous live stream

An RTSP stream is just endless live video, like a never-ending video call. To feed it to the AI, you don't process every single frame (a car barely moves between two frames a fraction of a second apart — wasteful). Instead, **grab one frame every second or two**, like taking a periodic snapshot.

The standard tool for reading RTSP is **FFmpeg** (the hackathon's own ingest spec already documents using it via `ffprobe`/`ffplay`). In Python, the clean way to use it is **OpenCV's `VideoCapture`**, which can open an RTSP URL exactly like it opens a video file, and hand you frames one at a time in a loop:

```python
import cv2

stream_url = "rtsp://live.corp8.cloud:8554/stream/1"
cap = cv2.VideoCapture(stream_url)

while True:
    success, frame = cap.read()   # grabs ONE frame from the live stream
    if not success:
        continue
    # 'frame' is now just an image — a normal picture, the exact same
    # kind of object as a photo someone uploads manually today
```

**The key insight worth sitting with:** once you have `frame`, it is *literally the same kind of thing* your existing detector already processes. There is no real difference between "a photo someone uploaded" and "one frame grabbed from a live stream" — both are just an image. The AI genuinely does not know or care which one it is.

#### Step 2 — Throttle it: don't process every frame

A live stream typically delivers 25-30 frames every second. Running the AI that often, per camera, is wasteful and pointless (nothing meaningfully changes frame-to-frame at that speed). Add a simple throttle: only actually process **1 frame every 1-2 seconds**, discard the rest.

```python
import time

last_processed = 0
PROCESS_EVERY_SECONDS = 1.5

while True:
    success, frame = cap.read()
    if not success:
        continue

    now = time.time()
    if now - last_processed < PROCESS_EVERY_SECONDS:
        continue   # skip this frame, too soon since the last one
    last_processed = now

    # NOW hand this frame to the existing AI pipeline
```

#### Step 3 — Feed that frame into the EXISTING pipeline (nothing new here)

This step should feel anticlimactic, in a good way — because it genuinely is. Every line below already exists in the codebase, already tested, already working:

```python
# The ALREADY-BUILT detector, exactly as it works today
detections = detector.detect(frame)   # same detect() already in use

for detection in detections:
    # The ALREADY-BUILT embedding/fingerprint code
    embedding = embedder.embed(detection.crop)

    # The ALREADY-BUILT database save
    store.save(Sighting(
        camera_id=camera_id,       # which of the 6 cameras this came from
        embedding=embedding,
        vehicle_class=detection.class_name,
        detection_confidence=detection.confidence,
        # ... etc, exactly like today
    ))
```

The only genuinely **new** code is Steps 1 and 2 above — grabbing frames from RTSP and throttling them. Everything after that is 100% reuse of what's already built and tested.

#### Step 4 — Watch all 6 cameras at once, independently

Each camera needs its own loop running at the same time, since they're 6 separate live streams. This introduces one genuinely new idea: **running several things in parallel** — one "watcher" per camera, all feeding into the same shared database.

```python
import threading

def watch_camera(camera_id, rtsp_url):
    cap = cv2.VideoCapture(rtsp_url)
    # ... the loop from Steps 1-3 above ...

cameras = [
    ("2ac7d3e2-...", "rtsp://live.corp8.cloud:8554/stream/1"),
    ("eae79aaf-...", "rtsp://live.corp8.cloud:8554/stream/2"),
    # ... all 6
]

for camera_id, url in cameras:
    thread = threading.Thread(target=watch_camera, args=(camera_id, url))
    thread.start()
```

Each thread is its own independent "eye" watching one camera, quietly filling the shared database — this is the "AI never blinks" idea from Section 2, now actually running on real feeds instead of manual uploads.

#### Step 5 — The video-wall screen (what a human officer actually sees)

This is the frontend piece, separate from the AI processing above. It only needs to **display** the 6 live streams so a human can watch too, alongside the AI quietly working in the background. The simplest real approach: an HTML `<video>` element per camera in a grid layout, using a browser-compatible streaming format — RTSP itself doesn't play directly in a web browser, so it typically gets converted to HLS or WebRTC first, a separate, well-documented conversion step (FFmpeg can also do this).

#### Summary — what's genuinely new vs. reused

| Piece | New or reused? |
|---|---|
| Grab frames from RTSP | **New** — a small, well-understood piece (OpenCV `VideoCapture`) |
| Throttle to 1 frame / 1-2 sec | **New** — a few lines of timing logic |
| Detect vehicle in frame | **Reused** — the exact existing detector |
| Fingerprint the vehicle | **Reused** — the exact existing embedder |
| Save to database | **Reused** — the exact existing `SightingStore` |
| Run 6 cameras at once | **New** — one thread per camera, a standard pattern |
| Video-wall display for humans | **New** — a frontend piece, separate from the AI |

### Part 2, Continued — RTSP vs ONVIF, Analog Cameras, and Checking Camera Status

The build plan above assumed the RTSP URL is already known (true for the 6 real cameras today). This section covers the cases where it isn't — worth remembering, since the `camera` table already has fields (`camera_type`, `onvif_status`, `ip_address`) built for exactly this.

#### RTSP vs ONVIF — what each one actually is

- **RTSP = the actual video pipe.** The address you connect to, and once connected, video just flows through it continuously. Every modern IP camera speaks RTSP.
- **ONVIF = a standard way to ask a camera questions and control it** (not the video itself). Things like "what's your actual RTSP URL?", "what resolutions do you support?", "move the camera" (PTZ). A camera "supporting ONVIF" means you can auto-discover its settings instead of needing to know its exact RTSP URL by manual configuration/guesswork.

**One-line version:** RTSP = the water flowing through the pipe. ONVIF = the pipe's control panel / instruction manual.

#### Getting the RTSP URL for each real camera situation

| Situation | What to do |
|---|---|
| IP camera, RTSP URL already known | Connect directly — this is the 6 real cameras today, nothing else needed. |
| IP camera, ONVIF supported, RTSP URL unknown | Use an ONVIF client to *ask* the camera for its stream URL, then use that URL exactly like the direct case. ONVIF doesn't replace RTSP — it just discovers it. |
| Analog camera | Analog cameras speak no network protocol at all (no RTSP, no ONVIF) — they need a physical encoder/DVR-NVR bridge box between the camera and the network. That box converts the analog signal and serves it out *as RTSP*. So even analog cameras end up back at an RTSP URL by the time software gets involved — just via hardware, not software. |

**ONVIF discovery example** (once you have the camera's IP):
```python
from onvif import ONVIFCamera

cam = ONVIFCamera("192.168.1.50", 80, "admin", "password123")
media_service = cam.create_media_service()
profiles = media_service.GetProfiles()
stream_uri = media_service.GetStreamUri({
    'StreamSetup': {'Stream': 'RTP-Unicast', 'Transport': {'Protocol': 'RTSP'}},
    'ProfileToken': profiles[0].token
}).Uri
# stream_uri is now a real, ready-to-use RTSP URL — camera gave it, no guessing
```

**Important:** ONVIF itself still needs the camera's IP address first — it can't summon an IP out of nowhere across the internet. It only finds IPs automatically (via a feature called WS-Discovery) if you're on the *same local network* as the camera.

#### Getting a camera's IP address, as the actual owner

Different from — and explicitly NOT the same as — probing infrastructure you don't own (see `HACKATHON_INGEST_SPEC.md`'s documented boundary on that). If you genuinely own the camera/network, this is easy:
1. Already documented somewhere (installer records, a network spreadsheet) — most common real case.
2. Check the router/network admin panel's "connected devices" list.
3. A sticker on the physical camera device itself (often shows a default IP).
4. A network scan of your own network: `nmap -sn 192.168.1.0/24`.
5. The camera brand's own free "finder" desktop app (Hikvision, Dahua, CP Plus, etc. all ship one).

#### Checking camera status — 3 different levels, answering 3 different questions

"Status" isn't one check — it's 3 separate, increasingly deep questions:

| Level | Question it answers | What data it needs | How to check |
|---|---|---|---|
| **1. Reachability** | Is anything even responding at this address? | IP + port | Simple TCP connection attempt (`socket.create_connection`) — this is what Model 1's existing health-check already does. |
| **2. RTSP handshake** | Is it genuinely speaking RTSP correctly (real resolution, real codec)? | **The full RTSP stream URL** — this is the only thing this check needs | `ffprobe -rtsp_transport tcp -show_entries stream=width,height,codec_name <rtsp_url>` |
| **3. Frame health** | Is the actual picture sensible (not black/frozen/overexposed)? | One real captured frame from the stream | Pull a frame via OpenCV, check its average brightness isn't near-zero or near-max |

**One-line memory hook:** *Level 1 needs just the IP. Level 2 needs the full RTSP URL. Level 3 needs an actual frame from the stream.*

A camera can pass Level 1 (network-reachable) while failing Level 2 (RTSP service broken) or Level 3 (lens covered, frozen feed) — each level catches a different kind of failure the one before it would miss.

#### Decision: use Level 2 for the 6 real cameras, not Level 1

**Real reason, specific to this setup:** the 6 real cameras don't have a separate, known IP address on their own — only a full RTSP URL is available (e.g. `rtsp://live.corp8.cloud:8554/stream/1`), where the host part is a shared domain name (the hackathon's ingest gateway), not a per-camera IP. Two consequences follow directly:

1. **Level 1 can't be done cleanly here** — it needs IP + port as separate values, and there's no clean per-camera IP to check, only a shared gateway host.
2. **Level 1 wouldn't actually tell you what you need to know anyway** — since all 6 cameras share the same host (`live.corp8.cloud:8554`), a Level 1 check would only confirm "the gateway itself is up," even if one specific stream (e.g. `/stream/3`) was individually broken. It can't distinguish between streams.

**Level 2 is the correct fit instead** — it works directly off the exact thing already available (the full RTSP URL), and it checks the *specific stream*, not just the shared host. This isn't a generic upgrade — it's the right check for a setup where the camera identity is baked into the URL path, not a separate IP.

### Part 3 — The AI Brain — ⚠️ Half Built

| Piece | What it does | Status |
|---|---|---|
| Detect a vehicle in **one uploaded photo** | Draws a box around any car/truck/bike/motorcycle in a still image | ✅ Built, works well |
| Detect vehicles in a **live video stream, continuously** | The same detection, but running automatically on live video, 24/7, with no human uploading anything | ❌ Not built |
| Turn a detected vehicle into a "fingerprint" | Converts a cropped photo of a vehicle into a unique set of numbers describing its appearance | ✅ Built, works well |
| Save the fingerprint with camera + time | Stores that fingerprint alongside which camera saw it and exactly when | ✅ Built, works well |
| Search: "find this vehicle" | Upload a photo → system searches every saved fingerprint → returns a chronological route on the map | ✅ Built, works well — this genuinely works today |
| Read the license plate (ANPR) | Try to read the plate number as text from a detected vehicle | ❌ Not built at all — zero plate-reading exists anywhere currently |

**Bottom line:**
- **What's genuinely solid today:** if you hand the system a photo of a vehicle, it can already tell you every place that exact vehicle has been seen before, plotted as a route on a real map. This already works, right now, end to end.
- **The catch:** that memory currently only gets filled by someone *manually uploading photos* — there is no automatic, always-on watching of live cameras yet. So the "AI never blinks" half of the idea isn't real yet; only the "AI never forgets" half is.
- **The second gap:** no plate-reading exists anywhere, meaning today the system can only recognize a vehicle by appearance, never by its plate number.

---

## 4. What Would Need to Get Built, To Complete the Idea

Not a schedule, not effort estimates — just naming the real remaining pieces honestly, in the order the chain above implies they'd naturally get tackled:

1. **Grab and throttle frames from the 6 real RTSP streams** — the very first missing piece; see Part 2's step-by-step breakdown above (OpenCV `VideoCapture` + a simple time-based throttle). Without this, nothing downstream (grid view, live detection) has anything to work with.
2. **Build the grid/video-wall screen** — the officer-facing piece: pick camera count, pick which cameras, see them live.
3. **Wire live video frames into the existing detector** — the detection AI already works on photos; the new work is running it continuously on a throttled live stream instead of one image at a time (Part 2, Steps 3-4 above — mostly reused code, not new AI).
4. **Add plate reading (ANPR)** — a separate, additional AI step: given a detected vehicle, try to read its plate as text.
5. **Combine plate + appearance matching into one search** — so a search can succeed by plate when it's readable, and automatically fall back to appearance matching when it isn't (which is often, especially for two-wheelers).
6. **Alerts** — let someone define "watch for this specific vehicle" (by plate or by photo), and get notified the moment it's seen again on any camera.

---

## 5. Open Questions Worth Deciding Before Going Further

These aren't technical questions — they're direction questions, worth deciding deliberately rather than defaulting into:

1. Given the limited time, is the goal to build a **small, real, working slice** of live video (all 6 real cameras, or a smaller subset) — proving the chain end-to-end — rather than attempting scale?
2. Should plate-reading (ANPR) be built fresh, or is there an existing, well-tested open-source tool worth reusing, the same way the vehicle detector reuses an existing model (YOLO) instead of being built from scratch?
3. ~~Is there an actual camera feed available, or does this need a simulator?~~ **Answered:** 6 real cameras with live RTSP URLs already exist in the database, pointed at the hackathon's own ingest gateway (`live.corp8.cloud:8554`), confirmed live and reachable. No simulator needed — see Part 2's detailed breakdown above.

---

## 6. Scaling to Many Cameras — Architecture, Real Cost, and How to Make It Cheaper

This section covers three connected questions that came up while thinking through Model 2 at real scale: *can the current design run 80,000 cameras, what would that actually cost, and is there a real way to make it cheaper* — each answered honestly, with real numbers where they exist and clear flags where they don't.

### 6.1 Why the current design (1 thread per camera) can't run 80,000 cameras on one machine

The build plan in Section 3, Part 2 uses one thread per camera:

```python
for camera_id, url in cameras:
    thread = threading.Thread(target=watch_camera, args=(camera_id, url))
    thread.start()
```

This works fine for 6 cameras. It does **not** work for 80,000 — one computer cannot hold open 80,000 live video connections, each running AI detection, without running out of memory and CPU long before getting close to that number. This is an honest limit, not a flaw to hide.

### 6.2 Why the *architecture* still scales, even though one machine can't

**The real fix: many independent workers, not one impossibly powerful one — all writing to the same shared database.**

Analogy: one security guard can't watch 80,000 cameras. 1,000 guards, each watching 80 cameras, all writing into the same shared logbook, can cover 80,000 between them. This works in Sentinel's design specifically because the "watching" code (`watch_camera()`) and the "memory" (the database) are already separate — a worker doesn't need to know how many *other* workers exist elsewhere; it just does its one job and writes to the shared store.

```
Instead of: 1 computer running 80,000 threads          ❌ impossible

Do this:    1,000 separate workers, each on its own
            machine/container, each watching ~80 cameras
                    │
                    ▼
            All workers write to the SAME shared database
            (the exact SightingStore / vehicle_sighting table
            already built)
                    │
                    ▼
            Search/route queries work identically regardless
            of whether the data came from 6 cameras or 80,000
```

**This is why the search side (Job B, "AI never forgets") already scales with zero code changes** — it's just a database query, and doesn't care how many cameras or workers fed it. Only the "watching" side (Job A) needs scaling, and it scales by *adding more independent workers*, not by rewriting anything.

**Honest caveats this still carries:** real infrastructure cost (more cameras = more compute, this doesn't shrink), a way to assign which worker watches which camera (simple at small scale, a proper scheduler worth it at large scale), and a database sized for the increased write volume.

### 6.3 First, the foundation — how GPU cost is actually calculated

Before the cost table in 6.4 makes sense, it helps to understand where every number in it actually comes from — built up from zero, one idea at a time.

**The one formula everything below is built from:**

```
Total Cost = (Price per hour of the GPU you rented) × (How many hours you run it)
```

That's the whole foundation. A GPU is rented, like a car — you pay for the TIME you use it, multiplied by how powerful the one you picked is.

**Step 1 — GPUs come in different "sizes," like cars.** A small/entry-level cloud GPU (e.g., T4-class) costs roughly $0.35–$0.50/hour; a mid-range one (e.g., L4-class) roughly $0.50–$1.00/hour; high-end GPUs used for heavy AI training run $2–$4+/hour. **For running a small detector like YOLO on live video, a small/mid-range GPU is genuinely enough** — picking the right-sized GPU, not over-buying power that isn't needed, is itself a cost decision.

**Step 2 — "Per hour" adds up fast because cameras never sleep.** A camera needs watching 24 hours a day, every day:

```
$0.40/hour × 24 hours/day = $9.60/day
$9.60/day  × 30 days      = ~$288/month
```

One single GPU, running continuously for a month, costs roughly **$250–$370** — this is exactly where that number in the 6.4 table below comes from: hourly rental price × (24 hours × 30 days).

**Step 3 — one GPU doesn't watch just 1 camera, it watches several at once.** A GPU can process several cameras' frames together (this is exactly the "batching" idea covered in full in Section 6.5.2 below) — realistically, one decent GPU handles roughly **10-20 camera streams simultaneously**, when only checking 1 frame every 1-2 seconds (not full 30fps).

**Step 4 — combine Steps 2 and 3 to get cost PER CAMERA, the number that actually matters:**

```
Cost of one GPU for a month  ÷  How many cameras that GPU covers
        ~$300              ÷           ~15 cameras
                    = ~$20 per camera, per month
```

**Step 5 — scaling to any number of cameras is now just multiplication:**

| Number of cameras | Math | Rough monthly cost |
|---|---|---|
| 1 camera | $25 × 1 | ~$25 |
| 10 cameras | $25 × 10 | ~$250 |
| 100 cameras | $25 × 100 | ~$2,500 |
| 1,000 cameras | $25 × 1,000 | ~$25,000 |
| 80,000 cameras | $25 × 80,000 | ~$2,000,000 (roughly ₹16-17 crore/month) |

**One-sentence summary to remember:** GPU cost = (price to rent one GPU per hour) × (24 hours × 30 days) ÷ (how many cameras that one GPU can watch at once) × (how many total cameras you want to run) — and every cost-saving technique in Section 6.5 below works by either making the GPU need to run LESS often, or making it cover MORE cameras at once. Both push this final number down.

### 6.4 What running 1,000+ workers would actually cost — the real numbers

**The expensive part is running AI (detection + Re-ID embedding) on video — this needs a GPU to be fast.** Using the formula built up in 6.3: one GPU realistically handles roughly 10-20 camera streams at once, so "1,000 cameras" means roughly 50-100 GPUs needed, not 1,000 separate machines.

Rough real-world cloud GPU cost (illustrative, standard cloud pricing, not a specific vendor quote):

| Item | Rough cost |
|---|---|
| One mid-range cloud GPU, running 24/7 | ~$250–$370/month |
| Per-camera cost (at ~10-15 cameras/GPU) | ~$20–$35/month |
| **1,000 cameras total** | **roughly $16,000–$37,000/month**, compute only |
| **80,000 cameras (full statewide scale)** | **well over ₹1 crore/month**, compute only, before storage/networking/staff |

**Why this is a genuine strength for the pitch, not a weakness to hide:** this is exactly why Sentinel's architecture deliberately does *not* try to watch all 80,000 cameras with AI at once — Model 1's registry lets a department pick the specific 50-100 cameras that actually matter (near a crime scene, a checkpoint, a sensitive junction), and only those get live AI processing. The cost story is a *reason the design is shaped the way it is*, not a gap being papered over.

### 6.5 Making it cheaper — 5 real, stackable techniques

These aren't alternatives to pick between — they're layers that stack on top of each other, each cutting cost further:

```
1. Region cropping    → only look at the road area, not the whole frame
2. Motion-gating       → only bother analyzing frames where something moved
3. Edge pre-filtering  → do the motion check locally, don't stream raw
                          video centrally for nothing
4. Batching            → when the AI does run, run it efficiently across
                          many cameras at once, not one-by-one
5. Resolution tuning   → (careful tradeoff) shrink only if accuracy loss
                          is acceptable for your camera distances
```

#### 6.5.1 Motion-gated analysis (the biggest lever — confirmed real, sourced research)

**The idea, confirmed valid and already industry-standard:** the same principle real VMS platforms already use for *storage* ("only record when there's motion") applies just as well to *AI compute* ("only run the expensive detector when there's motion") — this is a real, established, already-shipping pattern, not a novel idea needing invention.

**How it works — a cheap check gates the expensive one:**

```
Every frame → run a CHEAP motion check first (near-free, no GPU)
    → if NO motion: skip — don't touch the expensive AI at all
    → if motion IS detected: NOW run the full detector + Re-ID
```

The cheap check is plain pixel math, not AI — e.g. OpenCV's built-in background subtraction (`cv2.createBackgroundSubtractorMOG2()`), two lines of code, runs on CPU, no GPU needed.

**The mature, 3-layer version** (this is what real commercial systems actually use, per Genetec's own published documentation — continuous > motion-triggered > AI-classifier-triggered, each cheaper than the last):

```
Layer 1: Plain motion check (near-free, no AI)
    ↓ only if something moved
Layer 2: A tiny AI check — "is this really a vehicle, or just
         rain/shadow/leaves?" (small, fast, much cheaper than
         the full detector)
    ↓ only if it's probably a real vehicle
Layer 3: The full existing detector + Re-ID pipeline — now only
         running on frames that actually matter
```

**Real, sourced evidence this works — not asserted, verified via research:**

| Source | What it found | Type |
|---|---|---|
| NoScope (Stanford, VLDB 2017) | Gating a full detector behind cheap frame-difference checks: **265×–15,500× speedup** in their benchmark setup, within 1-5% accuracy of the full model | Peer-reviewed, but an extreme ceiling number from a controlled benchmark — not a promise for a general multi-class pipeline |
| "Intelligent Video Recording Optimization..." (arXiv:2411.02632) | Motion-gated YOLOv9 pipeline vs. continuous commercial (Hikvision) recording: **60% less footage** needed recording/analysis in a real 1-hour test | Peer-reviewed, real measured result |
| Reducto (SIGCOMM 2020) | Cheap pixel-level frame filtering before the model: **filters out 51–97%** of frames depending on content, while meeting accuracy targets | Peer-reviewed |
| Hikvision "Motion Detection 2.0" / AcuSense | Adds a small AI classification layer (person/vehicle/other) on top of plain motion detection specifically to cut false triggers (rain, shadows, animals): **38% increase in recognition accuracy** | Vendor's own official technical claim — credible source, not independently audited |
| Genetec Security Center | Documents three real recording tiers — continuous, motion-triggered, AI-classifier-triggered — explicitly as a cost/storage hierarchy | Vendor's own product documentation |
| Milestone XProtect | Ships configurable motion detection tied directly to recording, with "dynamic sensitivity" to reduce false triggers | Vendor's own product documentation |

**The one honest caveat, stated plainly:** how much this saves depends entirely on how busy a camera's location is. A quiet street sees long stretches with nothing happening — large savings. A busy highway junction has near-constant motion — savings shrink toward zero there, since the AI ends up running almost as often as before anyway. The honest claim is "savings proportional to how much of the footage is actually quiet," not a flat universal percentage.

**Pitch-ready one-liner:**
> "We don't run expensive AI detection on every frame of every camera, all the time — we run a cheap motion check first, and only invoke the full detection and Re-ID pipeline when something is actually happening. This is the same principle real VMS platforms already use for storage; we extend it to compute, which is the part that actually costs money at scale."

#### 6.5.2 Batching — run several cameras through the AI at once, not one at a time

**Start with an analogy.** Imagine a delivery truck that carries 20 boxes. Bad way to use it: drive out with 1 box, deliver, drive back, repeat 20 separate round trips. Good way: load all 20 boxes at once, drive out ONE time, deliver all 20. Same total boxes delivered, dramatically faster and cheaper — because most of the wasted "cost" was the repeated round trip itself, not the boxes.

**A GPU works exactly like this truck.** The "boxes" are camera frames. The "trip" is real setup overhead the GPU pays every single time it's asked to run the AI model — loading the frame into GPU memory, getting the model ready, waiting for the previous job to finish. **This setup overhead takes roughly the SAME amount of time whether processing 1 frame or 20 frames at once** — that's the entire secret.

**Side by side, with illustrative numbers:**

```
Without batching — one camera at a time:
  Camera 1's frame → [setup: 5ms] → [AI math: 10ms] → done (15ms)
  Camera 2's frame → [setup: 5ms] → [AI math: 10ms] → done (15ms)
  ... 20 cameras × 15ms each = 300ms total

With batching — 20 cameras' frames grouped together:
  20 frames stacked → [setup: 5ms, ONCE] → [AI math on all 20 at
  once: ~50ms, since GPUs are built for parallel calculation] → done
  Total: ~55ms for all 20 cameras
```

300ms vs. 55ms — the exact same total work, done roughly 5x faster, purely by not repeating the setup 20 separate times.

**Why a GPU specifically is built for this:** a CPU (your normal processor) is like a few extremely skilled workers doing one complex task well, one after another. A GPU is like thousands of simpler workers, all doing the *same simple task* simultaneously, side by side. AI detection math (like YOLO) is made of thousands of small, repetitive calculations — perfect for that "thousands of workers at once" design. But those thousands of workers only get properly used if given enough work at once — feed a GPU just 1 frame, and most of its capacity sits idle; feed it 20-32 frames together (a proper batch), and nearly all of it is finally being used.

**Real, well-documented tool for this:** NVIDIA's DeepStream SDK is built specifically for camera surveillance with multiple streams sharing one AI model.

**Real numbers found:** a single NVIDIA Jetson Orin edge device using this shared-batch approach can handle roughly **40 camera streams at once**, compared to roughly **11 streams** if each camera got its own separate model instance — nearly a 4x improvement from batching alone, not from any change to the AI model itself.

**Honest note for a small demo:** at only 6 cameras, batching barely matters — the GPU has plenty of spare capacity either way. The savings only become meaningful once running dozens or hundreds of cameras' worth of frames through the same GPU — a real technique for *scaling*, not something a small hackathon demo would notice.

**How this would connect to Sentinel's build (Section 3, Part 2):** instead of each camera's watcher thread calling `detector.detect(frame)` directly, each thread would drop its throttled frame into a shared queue. A separate process waits until it has, say, up to 16 frames waiting (or a short timeout passes, whichever comes first), runs the detector ONCE on all of them together, then hands each result back to the camera it came from.

#### 6.5.3 Edge processing — do the cheap check near the camera, not in the cloud

**The idea:** instead of sending every camera's full video stream all the way to a central server for processing, do the cheap motion-check step (6.5.1) *right at the camera location*, on a small inexpensive device, and only send video onward when something actually needs deeper analysis.

**Why this matters — a real, separate cost from GPU compute: bandwidth.** One camera streaming continuously in decent quality uses roughly 50GB/day. For 100 cameras, that's ~5 terabytes/day — cloud providers charge for that data transfer. Industry estimate: **$90,000–$220,000/year for just 100 cameras**, if streaming everything centrally instead of filtering locally first. (Source: a systems-integrator vendor blog — directionally sound, consistent with known bandwidth pricing, but not an independently audited figure — treat as an industry estimate.)

**The fix:** a cheap device near the camera (a Jetson Nano-class box, or even the camera's own built-in chip) runs the motion check locally. Only when something interesting happens does it send that specific clip/frame onward — not the constant raw stream.

#### 6.5.4 Region of Interest (ROI) cropping — only analyze the part of the frame that matters

**The idea:** in many camera views, only part of the image actually matters — e.g. the road/lane area — while the rest (sky, building walls, sidewalks far from the road) never has a vehicle in it. Crop the frame down to just that relevant region before running the AI, instead of analyzing the full frame.

**Why this saves cost:** less pixel area for the AI to process per frame means faster, cheaper analysis — and it can even *improve* accuracy, since irrelevant background that could confuse the model is removed.

**How practical this is:** a one-time setup step per camera (draw a box on the road area once, at registration time) rather than something recalculated per frame — cheap to add, and pairs naturally with the existing Model 1 registry, since each camera's location/context is already known there.

#### 6.5.5 Resolution downscaling — shrink the frame before analyzing (a real tradeoff, not a free win)

**The idea:** a high-resolution frame (1920×1080) costs more compute to analyze than a smaller one (960×540). Shrinking the frame before running the AI makes it process faster and cheaper.

**The honest, real tradeoff:** a well-known Google study (Huang et al., CVPR 2017 — the standard reference on this exact speed/accuracy tradeoff) found shrinking resolution gives real speed gains at a real accuracy cost — e.g. one measurement showed roughly 27% faster processing but ~16% worse accuracy on average. **Critically for Sentinel specifically: shrinking resolution hurts detecting small or far-away vehicles the most** — and vehicles at typical street-camera distances are already fairly small in frame. A real lever, but a genuine tradeoff to name honestly, not oversell as a pure win.

### 6.6 Putting it together — a realistic combined savings estimate (with an honest caveat)

Using the 1,000-camera example from Section 6.4 (~$25,000/month, no optimization), applying the techniques above one at a time:

**Step 1 — motion-gating (6.5.1), the biggest lever.** Realistic, conservative range for a mixed set of cameras (some busy, some quiet) — **50-80% reduction** in how often the expensive AI needs to run (a fair middle ground between the proven 60% study and accounting for busier locations):

```
$25,000/month × (1 − 0.65 average)  ≈  $8,750/month
                                        (roughly $16,250 saved)
```

**Step 2 — batching (6.5.2), stacking on top.** Roughly 2-2.5x more cameras per GPU when batching properly (vs. the ~15-camera baseline from 6.3):

```
$8,750/month ÷ ~2x efficiency  ≈  $4,000-$4,500/month
```

**Step 3 — right-sizing + not over-provisioning idle GPUs.** Since the AI now runs far less often, fewer GPUs may need to sit ready at all — a real, additional saving, but too hard to quantify confidently, so no specific number is claimed here.

**The honest total:**

```
No optimization:        ~$25,000/month
After motion-gating:    ~$8,750/month    (roughly 65% saved)
After + batching:       ~$4,000-4,500/month   (roughly 82-84% saved total)
```

**The important honesty caveat — read before repeating this number anywhere:** this combined "80%+" figure is a *reasoned estimate*, built by stacking separately-sourced, separately-measured numbers (Section 6.5's table) — it is **not** itself a number any single study or product measured as one combined, real-world result. Nobody in the underlying research ran "apply all these techniques together and measure the final combined savings." Stacking separately-proven pieces is a reasonable way to *estimate*, but it is genuinely different from a verified, single measurement — and should be presented to a jury with that distinction intact, not as a flat guaranteed number.

**The safe, honest way to say this to a jury:**
> "Based on real, published research on individual techniques — motion-gating (measured at 60% reduction in a real study) and GPU batching (measured at roughly 2x camera density in real deployments) — we estimate a realistic, combined cost reduction in the range of **60-80%** versus running full AI analysis continuously on every frame of every camera. This is a reasoned estimate built from separately-verified numbers, not a single benchmark of our exact combined system — which is the honest, correct way to present it."

### 6.7 Open, honestly unresearched question — does a system like Sentinel already exist?

**This is explicitly NOT researched yet — flagged here so it doesn't get quietly assumed one way or the other.**

Two different questions, with two different confidence levels:

- **"Does motion-gated video analysis exist as a technique?"** — Yes, confirmed, real, already shipping (Section 6.5.1 above). No ambiguity here.
- **"Does a complete system combining a camera registry + motion-gated live AI + appearance-based (non-plate) vehicle re-identification, the way Sentinel proposes, already exist as one product?"** — **Not actually researched.** What's below is an *inference* from Sentinel's own FSD, not a verified finding, and should not be repeated to a jury as settled fact:
  - Commercial VMS platforms (Milestone, Genetec, Hikvision) do combine live camera watching with motion detection and object classification.
  - They appear to be single-vendor, closed systems (buy the whole stack from one company) rather than an open registry spanning many camera brands/departments, and appear to center on plate-reading (ANPR) as the primary vehicle-identification method — not appearance-based Re-ID as a first-class fallback for the plate-less problem.
  - **This inference has not been checked against real sources.** A real research pass (same rigor as Section 6.5) is needed before this claim goes anywhere near a jury — otherwise it's a guess dressed up as a differentiator, which is exactly the kind of overclaim this whole document has tried to avoid.

---

## 7. Extending the Model — Adding ANPR, Watchlists, and Why Face Detection Stays Excluded

Section 6 covered the cost of running video analysis at all. This section covers a natural follow-up question: once that pipeline is running, can more capabilities (plate reading, watchlist alerts, face detection) be added onto it "for free," since the GPU is already busy computing? The honest answer is: **partly yes, partly no — it depends on whether the new capability reuses a detection already paid for, or needs an entirely new AI model of its own.**

### 7.1 Not every extension costs the same — a clear breakdown

| Extension | Reuses the existing detection? | New model needed? | Real extra cost |
|---|---|---|---|
| Vehicle Re-ID (already built) | Yes | No | Near-zero — already accounted for in Section 6 |
| Basic color/type attributes | Yes | A small extra model | Small |
| **ANPR (plate reading)** | Partially — needs the car crop, then runs its own plate-detector and OCR | **Yes, two more models** | **Real, meaningful extra cost** |
| **Face detection** | No | **Yes, a whole separate model** | **Real extra cost — and separately, a deliberate permanent exclusion (Section 7.3)** |
| Watchlist / wanted-list match | Yes, fully | No — just a database comparison against fingerprints already generated | Near-zero |

**Why ANPR isn't free, even though the GPU is already running:** the vehicle detector finds "there's a car" — it was never trained to find a license plate within that car, so reading a plate genuinely needs two additional, separate AI steps: a plate-detector (finds *where* the plate is) and an OCR model (reads the actual characters). That's real, additional computation every time it runs, not just a different way of using work already done.

**Why watchlist matching genuinely is free:** a watchlist check is just "does this vehicle's fingerprint — already generated for every detection — match one of a short list of fingerprints being watched for?" That's a small database comparison, not a new AI model, so it stacks onto the existing pipeline at essentially no extra cost.

### 7.2 "The GPU is already on" doesn't mean extra work is free — but sharing it IS cheaper than running separate services

**A GPU already running is like a stove that's already turned on.** The stove being on doesn't make cooking a second dish free — it still needs its own ingredients and time, and the stove has a limited number of burners. What actually determines cost is how much *extra work* (calculation) the new task adds — not whether the GPU happens to already be active.

**But there IS a real, correct way to make adding models much cheaper than treating them as separate systems: run them together, on the same GPU, in the same shared session — the same underlying idea as batching (Section 6.5.2).**

```
Expensive way — separate services, each paying its own setup cost:
  Frame → [Vehicle detector: full GPU call]
  Frame → [ANPR plate detector: SEPARATE full GPU call]
  Frame → [ANPR OCR: ANOTHER SEPARATE full GPU call]
  = 3 separate "trips," each repeating GPU setup overhead

Efficient way — models chained together on one shared GPU session:
  Frame → [Vehicle detector runs] → crop the car
  Same GPU session → [ANPR plate detector runs on the crop]
  Same GPU session → [ANPR OCR runs on the plate crop]
  Same GPU session → [Re-ID embedder runs on the car crop]
  = all models share one GPU "session," avoiding repeated
    loading/setup overhead per model
```

**The real saving is avoiding paying the GPU's setup/loading cost multiple times** — not making the extra work disappear. Continuing the stove analogy: tossing a second small thing into a pan that's already hot is cheaper than heating a whole second stove from scratch, but it still uses real extra ingredients and real extra time.

**Honest, illustrative range:** if a vehicle detector alone takes ~10ms per frame, adding ANPR (smaller models, same shared GPU session) might add another 5-8ms — not another full 10ms — because the expensive "load everything fresh" cost isn't paid twice. A real, meaningful saving, but not zero.

### 7.3 Why face detection stays excluded, regardless of cost

Even setting cost aside entirely, face recognition is a **firm, deliberate, permanent exclusion** from this project — already documented in Section 2's chain and worth restating plainly here: Delhi Police's own court testimony placed facial-recognition accuracy at roughly 2% (2018) and under 1% (2019); a documented case involved years of custody built partly on an 80%-similarity match; no Indian law currently defines facial-recognition evidentiary weight. This isn't a "maybe later, once it's affordable" gap — it's excluded on legal/accuracy grounds that have nothing to do with GPU cost, and stay true even if compute became free.

### 7.4 The honest, one-line summary

**Running more AI capabilities on the same GPU, in one shared pipeline, is genuinely much cheaper than running them as separate systems — but it is not free.** Each capability that needs its own model (like ANPR) is real, additional computation, not just a different shape of work already being done. The saving comes from sharing the GPU efficiently across models (the same principle as batching cameras together in Section 6.5.2), not from the extra work vanishing. Watchlist matching is the one genuine exception — it reuses data already generated and adds no new model at all.

---

## 8. Instant Notifications — Wanted Vehicles/Persons and the Real Case Database

Section 7.1 already established that watchlist matching is near-free, since it reuses the fingerprint every detection already generates. This section covers the full picture: where the "suspicious" list actually comes from (the police's existing case-records database, not something Sentinel invents), and — the genuinely new part — how a match instantly reaches a real police officer, not just sits in a database waiting to be searched.

### 8.1 The full chain, in plain language

```
1. Police already have a case-records database (wanted vehicles/persons)
        ↓
2. Sentinel needs to KNOW who/what is "suspicious" — pull that list in
        ↓
3. Every live detection gets checked against that list, automatically
        ↓
4. If it matches → don't wait for someone to search — PUSH a
   notification to the police, instantly
```

### 8.2 Link 1 → 2: Getting the "suspicious list," without duplicating the case database

**The key question:** does Sentinel need to rebuild the case database, or just read from it? **The honest, efficient answer: just read from it — don't duplicate it.** This is the same principle already used throughout the project (`vehicle-detection` doesn't have its own camera database — it reuses Model 1's `camera` table directly). The same idea applies here: Sentinel doesn't need its own full "wanted list," it needs a **small bridge table** pointing into the real case database.

```python
# A new, small table — NOT a duplicate of the whole case database,
# just a lightweight pointer into it
class Watchlist:
    watchlist_id: UUID
    case_id: str          # reference to the REAL case in the existing
                           # police case database (not duplicated here)
    plate_number: str      # if known
    vehicle_embedding: vector  # the fingerprint, generated the SAME
                                # way as every other vehicle sighting —
                                # reusing the exact same Re-ID code
    priority: str          # e.g. "high", "routine"
    added_by: UUID
    added_at: timestamp
```

**How a fingerprint gets into this table, two realistic ways:**
1. An officer uploads a known photo of the wanted vehicle — reuses the *already-built* upload → embed flow (Section 3, Part 3) with zero new code needed for this part.
2. The plate number alone is entered (no photo available), and matching happens by plate instead of appearance, once ANPR (Section 7.1) exists.

### 8.3 Link 2 → 3: Checking every live detection against the watchlist — the near-free part

This connects directly to the existing pipeline (Section 3, Part 2, Step 3), which already runs for every single detection:

```python
# EXISTING code, unchanged:
detections = detector.detect(frame)
for detection in detections:
    embedding = embedder.embed(detection.crop)
    store.save(Sighting(...))   # existing — always happens

    # NEW — one small addition, right here:
    watchlist_match = check_watchlist(embedding)
    if watchlist_match:
        trigger_alert(watchlist_match, detection, camera_id)
```

This is exactly the "near-free" extension established in Section 7.1 — it reuses the fingerprint already generated for every detection, adding one more comparison against a short watchlist (not the whole sightings history). No new AI model, no meaningful extra cost.

### 8.4 Link 3 → 4: Getting the notification to a real officer, instantly — the genuinely new part

**The core problem:** the system today is built around someone *asking a question* (upload a photo, search). A notification is the opposite — the *system* needs to reach out to a *human* without being asked, the moment something happens. Nothing like this exists in what's built today.

**The standard, real way this is built — a "publish and push" pattern:**

```
Detection matches watchlist
        ↓
System writes an "alert" record into the database (what, where, when, case ID)
        ↓
System PUSHES that alert out immediately, through one or more channels:
   - A real-time update to the officer's open dashboard/screen
     (WebSocket — a live, always-connected browser connection,
     different from a normal one-time API request)
   - A mobile push notification (like a WhatsApp/app notification)
   - An SMS to a registered phone number (for officers not staring
     at a screen)
```

**Why WebSocket specifically, and not just "check the database every few seconds":**
- **Bad way (polling):** the officer's screen asks the server "anything new?" every 5 seconds, forever — wasteful, and there's still up to a 5-second delay.
- **Good way (WebSocket / push):** the officer's screen holds one continuous open connection to the server. The moment the server has a new alert, it pushes it down that connection immediately — genuinely instant, and far less wasteful than constantly asking "anything new?"

### 8.5 The whole thing, put together

```
┌────────────────────────────────────────────────────┐
│ Police's EXISTING case database                     │
│ (wanted vehicles, cases — NOT duplicated)            │
└──────────────────────┬───────────────────────────────┘
                        │ (officer adds a photo or plate
                        │  number for a specific case)
                        ▼
┌────────────────────────────────────────────────────┐
│ Sentinel's small Watchlist table                     │
│ (case_id + fingerprint + plate, a lightweight bridge)│
└──────────────────────┬───────────────────────────────┘
                        │ (checked on EVERY live detection —
                        │  reuses the fingerprint already made)
                        ▼
┌────────────────────────────────────────────────────┐
│ Live detection pipeline (already built, Section 3)   │
│ → MATCH FOUND →                                       │
└──────────────────────┬───────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────┐
│ NEW: Alert system                                     │
│  - Save alert record (what/where/when/case)           │
│  - Push instantly via WebSocket (live screen)          │
│  - Optionally: mobile push / SMS                       │
└────────────────────────────────────────────────────┘
```

### 8.6 What's genuinely new vs. reused, honestly

| Piece | New or reused? |
|---|---|
| Reading fingerprints/plates from the case database | Reused pattern (the "don't duplicate, reference" principle already used throughout the project) |
| Generating a fingerprint from an uploaded photo | Fully reused — existing upload → embed flow |
| Checking each live detection against the watchlist | Small addition, near-free (Section 7.1's exact reasoning) |
| Saving an alert record | Small, new, simple |
| Pushing it out instantly (WebSocket / notification) | **Genuinely new** — the one real new piece of infrastructure this feature needs |
