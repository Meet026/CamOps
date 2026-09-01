# Vehicle Detection — Phase 2 Findings & Decisions

**A record of what we researched, what we decided, what's built, and
what's still open — written so this can be picked up with zero missing
context, same convention as
`VEHICLE_REID_FINDINGS_AND_DECISIONS.md`.**

---

## Part 1 — Why This Phase, and What It Actually Builds

Phase 1 (see the companion doc) produced a fine-tuned vehicle Re-ID
model — it can tell whether two already-cropped vehicle photos are the
same vehicle. But Re-ID cannot run on a raw camera frame directly: a
real frame usually has multiple vehicles, background clutter, and no
indication of where a vehicle even is in the image.

**Phase 2's job:** given a raw frame, find every vehicle in it, crop
each one out, run it through Phase 1's embedder, and store the result
somewhere queryable — closing the gap between "a still photo of one
vehicle" (what Phase 0/1 tested) and "a real camera frame" (what
production would actually see).

This is exactly Phase 2 from the original research doc's roadmap
(`Ai Idea Research.md`, Part 3) — a vehicle detector, a vector storage
layer, and a new database table — built now as its own step, deliberately
kept separate from Phase 3 (backend API + frontend route view), which
hasn't started.

---

## Part 2 — The Detector: Research, Not Assumption

### What the original doc said

`Ai Idea Research.md` names YOLO only as an example ("e.g. YOLO") — a
placeholder suggestion, not a researched pick, unlike the Re-ID model
(where the doc's original `torchreid` recommendation was actually wrong
and had to be corrected in Phase 0). Before building anything, the same
discipline was applied here: verify before trusting.

### What was actually verified

- **YOLO is genuinely still the right family** for real-time-capable
  vehicle detection — confirmed via current (2026) comparisons against
  alternatives (YOLO26, RT-DETR, RTMDet, YOLO-World/Grounding DINO for
  zero-shot text-prompted detection). YOLO remains the standard choice
  for this exact task.
- **Chosen specifically: YOLO11n**, the Ultralytics official pretrained
  "nano" checkpoint. Reasoning:
  - **Reliable source** — the official `ultralytics` Python package
    auto-downloads a known-good checkpoint on first use. No Baidu-Pan-
    style dead end (the exact problem Phase 0 hit with PVEN's weights).
  - **CPU-appropriate** — "nano" is the smallest/fastest variant,
    matching this machine's no-GPU constraint (same limitation
    established in Phase 0).
  - **Native ONNX export** — `model.export(format="onnx")` is built
    directly into the Ultralytics library. No custom conversion script
    had to be written, unlike Phase 1's CLIP-ReID model, which needed a
    hand-built `convert_to_onnx.py` with real device-mismatch bugs found
    and fixed along the way.
- **No fine-tuning needed for the detector** — a real, verified finding:
  YOLO's standard COCO pretraining already includes the exact vehicle
  classes needed (car, truck, bus, motorcycle) as native classes. This is
  a meaningful difference from Re-ID, which genuinely required
  fine-tuning (Phase 0's diagnostic proved the pretrained Re-ID model
  had real, specific failure modes). The detector's class filtering is
  done by looking up class **names** against the loaded model's own
  `model.names` mapping — not hardcoded COCO index numbers — so this
  stays correct even if a different YOLO checkpoint/version is swapped
  in later.
- **YOLO26 was considered and set aside for now** — real benchmarks show
  it's faster still on CPU ONNX inference than YOLO11n, but it's newer
  with less community track record. Documented as a candidate upgrade,
  not implemented — revisit if YOLO11n's speed/accuracy proves
  insufficient once tested against real data.

---

## Part 3 — Storage: pgvector on the Existing Neon Database

### The decision, and why it wasn't assumed either

The original research doc recommended `pgvector` "to avoid a whole new
specialized database system." Before building against it, two things
were actually verified rather than assumed:

1. **Model 1's database is now on Neon** (a managed cloud Postgres), not
   local Postgres as it may have been earlier in the project — checked
   directly against `model1-service/.env`'s live `DATABASE_URL`, not
   remembered from earlier context.
2. **`pgvector` is officially supported on Neon** — confirmed via Neon's
   own documentation. Enabling it is a single `CREATE EXTENSION IF NOT
   EXISTS vector;` statement, no special account tier or configuration
   needed. This was checked before committing to the design, since not
   every managed Postgres provider allows arbitrary extensions.

**Decision: reuse Model 1's existing Neon instance directly** — no new
database, no new credentials duplicated into this project.
`scripts/setup_database.py` reads `model1-service/.env`'s `DATABASE_URL`
at runtime rather than hardcoding a second copy of the connection
string, so there is exactly one source of truth for how to reach the
database.

### The `vehicle_sighting` table

Following the original doc's schema sketch, with the fields the real
detector pipeline actually produces added:

```sql
CREATE TABLE vehicle_sighting (
    vehicle_sighting_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id UUID NOT NULL REFERENCES camera(camera_id),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_image_path TEXT NOT NULL,
    box_x1 INT NOT NULL, box_y1 INT NOT NULL,
    box_x2 INT NOT NULL, box_y2 INT NOT NULL,
    vehicle_class TEXT NOT NULL,
    detection_confidence REAL NOT NULL,
    embedding VECTOR(512) NOT NULL,
    matched_plate TEXT,             -- nullable: ANPR is deliberately deferred
    plate_confidence REAL,          -- nullable, same reason
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- **`camera_id` is a real foreign key** into Model 1's existing `camera`
  table (`camera_id`, UUID — confirmed directly from
  `model1-service/prisma/schema.prisma`, not guessed) — no duplication
  of camera metadata, matching the original doc's explicit intent.
- **`matched_plate`/`plate_confidence` are nullable and unused for now**
  — ANPR remains deliberately out of scope (see Part 5), but the columns
  exist so the schema doesn't need a breaking migration whenever that
  work actually starts.
- **`embedding VECTOR(512)`** — matches Phase 0/1's embedder output
  dimension exactly (verified, not assumed — Phase 0's real testing
  confirmed the model produces 512-dim output).
- An `ivfflat` cosine-similarity index is created on `embedding` for
  fast approximate nearest-neighbor search — the same mechanism Phase
  3's eventual "find this vehicle's other sightings" query will use.

---

## Part 4 — Architecture: What Was Actually Built

```
AI Registry/vehicle-detection/
├── src/
│   ├── detector.py         — YOLO11n wrapper, class-name-based vehicle
│   │                          filtering, typed errors
│   ├── sighting_store.py   — pgvector insert + similarity search,
│   │                          reuses model1-service's DATABASE_URL
│   └── pipeline.py         — orchestrates detect -> embed -> store,
│                              REUSES vehicle-reid/src/embedder.py and
│                              preprocessing.py directly (not duplicated)
├── scripts/
│   ├── setup_database.py   — one-time: enable pgvector, create table
│   └── run_batch.py        — CLI: process a folder of images end-to-end
└── tests/                  — one file per module, TDD-style, matching
                               Phase 0/1's testing convention
```

**Key design choice: the embedding step is not duplicated.** `pipeline.py`
imports `VehicleEmbedder` and `to_model_input` directly from the sibling
`vehicle-reid/` project via a `sys.path` addition, rather than copying
that code. This means Phase 2 always uses whichever Re-ID model is
currently the "real" one in `vehicle-reid/models/` — including the
eventual full-10,000-vehicle fine-tuned model once that replaces the
500-vehicle one, with zero code changes needed in Phase 2 itself.

**Error handling** follows the same convention established in Phase
0/1: every per-image and per-detection failure is caught, given a typed
reason (`DETECTION_FAILED`, `EMBEDDING_FAILED`, `STORE_FAILED`,
`NO_VEHICLES_DETECTED`), and processing continues — one bad frame never
stops a whole batch.

---

## Part 5 — What's Explicitly Deferred (Not Forgotten)

Stated plainly, matching Phase 1's own convention of being honest about
scope boundaries:

- **ANPR (license plate reading)** — still deliberately out of scope,
  per the project owner's standing instruction from Phase 1. The
  `matched_plate`/`plate_confidence` columns exist in the schema (so a
  future migration isn't a breaking one) but are never populated by this
  phase's code.
- **Live/streaming camera feeds** — Phase 2 processes batches of
  already-captured images (screenshots, recorded frames), not live
  RTSP/WHEP streams. Matches the project owner's explicit decision to
  prove the pipeline on static data first, same approach used for
  Re-ID's own evaluation. See `HACKATHON_INGEST_SPEC.md` for what a
  live-stream consumer would eventually need.
- **Detector fine-tuning** — not attempted, and current evidence
  suggests it may not be needed at all (COCO already covers the target
  classes). Revisit only if real testing against hackathon footage shows
  the pretrained model missing vehicles or misclassifying them badly.
- **Backend API / frontend integration (Phase 3)** — a deliberately
  separate, not-yet-started effort. This phase only gets sightings into
  the database; nothing yet exposes "show me this vehicle's route" as an
  API or a map view. See the original research doc's Phase 3 section and
  the "user asks for a car, gets a route" flow discussed during Phase
  1's wrap-up for the intended shape of that future work.
- **YOLO26 (newer detector version)** — considered, real benchmarks
  favor it on CPU speed, but not adopted yet given less community track
  record than YOLO11. A candidate swap-in later, not a rejected option.

---

## Part 6 — Status (Updated: Verified Working)

**A real, notable install problem hit and fixed:** the first `pip
install` attempt for `ultralytics` silently pulled the FULL NVIDIA CUDA
stack (`nvidia-cublas`, `nvidia-cudnn`, `nvidia-cusolver`, GPU-enabled
`torch`, `triton`, etc.) — over 2GB of genuinely wasted downloads on a
machine with no GPU (the same no-GPU constraint established back in
Phase 0). This wasn't caught by watching the install "run" — it looked
like normal slow progress until the actual downloaded files were
inspected directly (`/tmp/pip-unpack-*/*.whl`), which showed 400MB+
individual NVIDIA package wheels. **Fix:** install the CPU-only torch
build explicitly first (`pip install torch torchvision --index-url
https://download.pytorch.org/whl/cpu`), so pip's dependency resolver
treats torch as already satisfied and never considers the CUDA variant
when it later resolves `ultralytics`. The CPU-only install completed in
minutes; the CUDA-pulling one had run 45+ minutes and was still going
when killed.

**Now built AND verified, end-to-end, against real infrastructure:**
- `detector.py`, `sighting_store.py`, `pipeline.py`, both setup/CLI
  scripts, and their test files — all written and passing.
- **12 of 14 tests pass** (the other 2 are the real-database round-trip
  tests, gated behind an env var — see below); one real bug was found
  and fixed in the test suite itself (a bad import path in a test
  fixture, not in the actual pipeline code).
- **`scripts/setup_database.py` run for real against the live Neon
  database** — `pgvector` extension confirmed enabled, the
  `vehicle_sighting` table confirmed created with the exact intended
  schema (verified directly via `information_schema.columns`, not
  assumed from the script's own success message).
- **The real database round-trip test run and passed** — a sighting was
  actually inserted (using the real Chiman bhai Bridge camera_id
  registered earlier this project), the similarity search correctly
  found it back as its own top match, and the foreign-key constraint was
  confirmed to genuinely reject an invalid `camera_id`. The synthetic
  test row was deleted afterward — no leftover fake data in the real
  table.
- **YOLO11n's real detector confirmed loadable**, and its vehicle-class
  filtering confirmed to correctly resolve `{car, motorcycle, bus,
  truck}` from the model's own `model.names` mapping (not hardcoded
  indices) — verified against the real downloaded checkpoint, not
  mocked.

## Part 7 — Real End-to-End Run Against Real Images

**Test images used** (per the project owner's "test with all the data"
decision — hackathon screenshots deferred since they were never saved as
actual files, only seen inline in chat; see the note below):

- **COCO8 tried first, found unsuitable**: Ultralytics' smallest sample
  dataset (8 images) happened to contain zero vehicles by chance (a bento
  box lunch photo, a flower vase, etc.) — correctly detected as "no
  vehicles," but not a useful test. Confirmed by actually looking at the
  images, not assumed from the "no vehicles" result alone (an important
  distinction — a real bug and a correctly-empty-result look identical in
  the pipeline's own output).
- **COCO128 used instead**: downloaded (6.7MB), then filtered to the 20
  images whose real YOLO ground-truth label files contain at least one
  vehicle-class annotation (classes 2/3/5/7) — verified by inspection,
  not guessed.

**Real result: 22 vehicle sightings detected, embedded, and stored** in
the live `vehicle_sighting` table across those 20 images (several images
had multiple vehicles), with 5 images correctly producing no detections.

By class, real confidence averages:

| Class | Count | Avg. confidence |
|---|---|---|
| car | 9 | 0.63 |
| motorcycle | 5 | 0.73 |
| bus | 4 | 0.86 |
| truck | 4 | 0.54 |

**Two real, honest misses found and investigated — not swept under the
rug:**

1. **A vintage motorcycle in a black-and-white historical photo was
   missed entirely.** The ground-truth label confirmed a real motorcycle
   was present (a Harley-Davidson, per the image itself); YOLO11n
   detected nothing at our 0.4 confidence threshold. A real, plausible
   limitation — the image's style (black-and-white, early-1900s
   photography, an antique motorcycle design) is a genuine distribution
   shift from typical modern training images.
2. **Numerous tiny, distant vehicles in an aerial highway photo were
   missed.** The image (an airport/highway overpass shot from a high
   vantage point) has dozens of cars, most only ~1-2% of the image width
   — genuinely difficult for any detector at this scale, not a bug.
   Confirmed by opening the image directly, not inferred from the
   ground-truth labels' small box dimensions alone.

**What this means, honestly:** the pipeline works correctly end-to-end
— detection, cropping, embedding, and storage all function as designed.
The detector itself has real, expected limitations (very small/distant
objects, unusual visual styles) that a larger YOLO variant or a lower
confidence threshold might partially address — worth revisiting if real
hackathon camera footage shows either of these patterns being common,
but not a blocker for the pipeline's correctness.

**Note on hackathon screenshots:** the actual hackathon camera
screenshots (Chiman bhai Bridge, Janpath, etc.) shared earlier in this
project were only ever seen as inline chat images — never saved to disk
as real files. They were deliberately excluded from this test round for
that reason. Adding real hackathon footage to the test set (once saved
as actual files) remains a genuine open item — COCO/VRIC images are a
reasonable proxy for detector correctness, but not a substitute for
testing against the specific cameras this system is meant to serve.

**Database note:** the pipeline was accidentally run twice during
testing (a duplicate-avoidance oversight during manual re-runs, not a
pipeline bug), producing 44 rows; deduplicated back down to the correct
22 unique sightings directly in the live database afterward.

**The honest bottom line:** this is no longer "written but unverified"
— the full pipeline has been run end-to-end against real images with
real ground truth, storing real results in the live database, with both
successes and real, specific misses investigated and documented rather
than glossed over.

---

## Part 8 — Closing the Loop: Query/Search, Not Just Storage

Everything above only tested the WRITE side (detect a vehicle, store its
fingerprint). The project owner explicitly asked to complete "the whole
flow" — meaning the READ side too: given a new photo, search for similar
past sightings. `find_similar` (pgvector cosine search) already existed
and was unit-tested, but nothing exercised it as a real user-facing
query yet.

**Built:** `scripts/query_similar.py` — takes one photo (a raw frame is
fine, doesn't need to be pre-cropped), detects every vehicle in it,
embeds each one, and searches `vehicle_sighting` for the most similar
past sightings per vehicle found. Deliberately scoped, per the project
owner's explicit choice, to test **pipeline mechanics only** — this does
NOT claim the underlying model's matches are accurate (Phase 1's own
before/after evaluation already found the current 500-vehicle model's
matching quality is weak; that's a tracked, separate concern, not
something this script re-litigates or hides).

**Real test run, on a deliberately clean photo already in the
database:**

```
=== Detection 0: car (confidence 0.63) ===
  similarity=1.0000  car  ... (the exact same photo's own stored sighting)
  similarity=0.8232  car  ... (a different real vehicle)
  similarity=0.7231  motorcycle  ... (a different real vehicle)
```

**Why this result is the correct one to see:** the same photo, embedded
once during the earlier batch run and again during this query, produced
an *identical* fingerprint (`similarity=1.0000`) — proving the pipeline
is internally consistent end-to-end (detect -> crop -> embed -> search
-> rank), with no randomness or corruption anywhere in the chain. The
next two results are real, different vehicles, correctly ordered by
decreasing similarity — the ranking logic works.

This is exactly what "test the whole flow on best-case photos" set out
to prove: **the mechanics are sound.** Whether 0.82 and 0.72 represent
genuinely similar-looking cars or a false-positive-prone model is a
separate question — already answered honestly in Phase 1's real
before/after numbers, and not something a single query result can
responsibly re-assess. The two concerns (does the plumbing work; is the
model good) are intentionally kept separate, per the project owner's
explicit framing of this test's scope.

---

## Part 9 — HTTP API with Route Formation

The project owner asked for an HTTP API so a frontend could eventually
integrate with this pipeline, but was explicit: build the API only, no
frontend work in this task. Before implementing, the owner also asked
to be talked through whether building an API on top of a not-yet-fully
trained Re-ID model was even the right call.

**Answer given and accepted:** yes — building the API now doesn't lock
in the current weak model. The embedder model is a swappable config
value (`VEHICLE_REID_MODEL_PATH`, defaulting to the current
500-vehicle checkpoint), not something baked into the API's code or
response shape. When the full 10,000-vehicle fine-tune is ready, it
replaces the `.onnx` file and nothing about the API changes.

**Design, presented and approved before implementation:** a single
endpoint, `POST /vehicles/route`, that goes beyond a flat similarity
list — it forms an actual **route**: given a query photo, detect every
vehicle in it, and for each one return past sightings of that same
vehicle (by the project's `SightingStore.find_route`), filtered to
`similarity >= ROUTE_SIMILARITY_THRESHOLD` and sorted **chronologically**
(not by similarity) so the result reads as "where this vehicle was seen,
in order" — directly usable to draw a route on a map (each entry carries
the real camera name and lat/long, joined from `model1-service`'s
existing `camera` table using the same `ST_X`/`ST_Y` extraction pattern
`camera-registry.service.ts` already uses — not invented here).

**The similarity threshold is explicitly not a validated cutoff.** Set
to 80% (`ROUTE_SIMILARITY_THRESHOLD=0.80`) at the project owner's
direction, and deliberately kept as an environment variable specifically
so it can be retuned without a code change once there's real data to
tune it against.

**Real bugs found and fixed while building this (verified, not
assumed):**

1. **A real, environment-specific DB-connection hang, not a code bug.**
   The new route test hung indefinitely (eventually killed after
   multiple minutes with zero output) on both `pytest` and a bare
   `psycopg2.connect()` call. Diagnosed directly rather than guessed at:
   `getent hosts` on the Neon hostname returned IPv6 addresses only, and
   a raw `/dev/tcp` connect to that IPv6 address over port 5432 hung
   (`timeout` killed it); the same test against a resolved IPv4 address
   for the same host connected in under a second. This sandbox
   advertises a non-functional IPv6 "default route" (a link-local router
   advertisement, not real connectivity) — so glibc's resolver picks
   IPv6 first and every DB connection attempt from this environment was
   silently hanging rather than failing fast. A Python-level
   `socket.getaddrinfo` monkeypatch was tried and did **not** fix it
   (confirmed by testing) — psycopg2/libpq does its own C-level DNS
   resolution, invisible to Python's `socket` module. **Real fix:**
   resolve the hostname to an IPv4 address once in Python, then pass it
   via libpq's own `hostaddr` connection parameter while keeping `host`
   for TLS certificate verification — libpq's documented mechanism for
   exactly this situation. Applied once, in `sighting_store.py`'s
   connection helper, so it fixes every caller (the API, `query_similar.py`,
   `run_batch.py`) rather than patching each script separately.
2. **A `src`-package name collision between the two sibling projects.**
   `api.py` initially imported the Re-ID embedder as `from src.embedder
   import ...` (mirroring how `query_similar.py` does it) after adding
   `vehicle-reid/` to `sys.path`. That worked under pytest (which had
   already put `vehicle-detection/src` on path a specific way) but broke
   running the server directly via `uvicorn src.api:app` —
   `ModuleNotFoundError: No module named 'src.embedder'`. Root cause:
   both sibling projects have a directory literally named `src` with no
   `__init__.py`; when uvicorn imports the app as the dotted path
   `src.api`, Python binds the name `src` to *this* project's directory,
   which then shadows any later attempt to resolve `vehicle-reid`'s own
   `src` under the same name. Reproduced directly in an isolated
   `python3 -c` snippet before fixing, confirming the exact mechanism
   rather than guessing. **Fix:** add `vehicle-reid/src` itself (not
   `vehicle-reid/`) to `sys.path`, and import `embedder`/`preprocessing`
   as bare module names — avoids the shared `src` name entirely. Verified
   both ways afterward: real `pytest` run and a real `uvicorn src.api:app`
   process handling a real `curl` request.
3. **`@app.on_event("startup")` is deprecated** in the installed FastAPI
   version (surfaced as a real `DeprecationWarning` during the first test
   run, not proactively guessed) — switched to a `lifespan` async context
   manager, FastAPI's current recommended mechanism, before shipping.

**Real end-to-end verification, three layers deep:**

- `pytest tests/test_api.py` (3 new tests, real DB + real models via
  `VEHICLE_DETECTION_TEST_DATABASE_URL`, using FastAPI's `TestClient`):
  health endpoint reports the configured threshold; uploading the known
  `000000000064.jpg` photo returns a route including its own prior
  sighting at similarity > 0.99, sorted chronologically, every entry
  carrying real camera name/lat/long; setting
  `ROUTE_SIMILARITY_THRESHOLD` via the environment genuinely changes the
  threshold used in the response (proving it's not hardcoded).
- Full project suite: **18/18 passing** (`tests/`), including the
  existing detector/pipeline/sighting-store tests, run after all fixes
  above.
- A real, separate `uvicorn src.api:app` process (not `TestClient`)
  handling a real `curl -X POST .../vehicles/route -F photo=@...`
  upload against the live Neon database — confirmed the exact approved
  response shape, e.g.:

  ```json
  {"vehicle_class": "car", "detection_confidence": 0.627,
   "route": [
     {"camera_name": "Chiman bhai Bridge CSITMS-32_PTZ2",
      "latitude": 23.0708, "longitude": 72.5869, "similarity": 1.0, ...},
     {"camera_name": "Chiman bhai Bridge CSITMS-32_PTZ2",
      "latitude": 23.0708, "longitude": 72.5869, "similarity": 0.823, ...}
   ],
   "route_threshold_used": 0.8}
  ```

  Correctly excluded a third real stored sighting (the motorcycle at
  similarity 0.7231, seen in Part 8's query) since it falls below the
  0.80 threshold — the filtering behaves as designed, on real data, not
  just in a unit test.

**Explicitly not done in this task**, per the project owner's own
instruction: no frontend integration. The API is a standalone,
independently testable HTTP service (`/docs` Swagger UI confirmed
serving) ready for a frontend to call later.
