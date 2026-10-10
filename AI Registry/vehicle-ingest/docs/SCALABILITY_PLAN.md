# vehicle-ingest — Scaling to 80,000+ Cameras

**Status of this document:** a plan, not a build log. It describes what
this worker already does today (as of the motion-gated ingest + shared
camera-list cache work), what's genuinely production-grade at small
scale, and the concrete, ordered steps needed to take it from "works for
~30 cameras on one machine" to "works for 80,000+ cameras across many
machines." Nothing below is built yet unless explicitly marked as such —
this is the roadmap, following the same architecture already reasoned
through in `SENTINEL_IDEA_AND_ROADMAP.md` Section 6 (many independent
workers, not one impossibly powerful one, all writing to the same shared
database).

---

## 1. What exists today, and its real ceiling

`vehicle-ingest` currently runs as **one single process** on one
machine, with two background loops:

- A slow loop (`_camera_cycle_loop`, default every 20s) that walks every
  camera sequentially and runs the full detect+embed+save pipeline on
  each one's latest frame.
- A fast, motion-gated loop (`_motion_check_loop`, default every 3s)
  that does a cheap pixel-diff check first, and only calls the
  expensive pipeline when a camera's frame actually changed enough to
  be worth a real look — directly reduces how often the costly model
  inference runs, which matters a great deal at scale (see Section 3).

Both loops:
- Run their per-camera work via `asyncio.to_thread`, so the HTTP server
  (`/health`) stays responsive while that work happens — confirmed
  directly: ten consecutive `/health` checks, 2 seconds apart, all
  responded in under 25ms while both loops were actively running real
  per-camera work.
- Share **one** cached camera list (`CameraListCache`, TTL matching the
  slow loop's own interval) rather than each independently calling `GET
  /cameras` on its own schedule — this was a real, measured bug (GET
  /cameras intermittently timed out once both loops were calling it
  concurrently alongside dozens of real ffmpeg/YOLO worker threads) and
  is fixed, not hypothetical.

**The real ceiling: this is still fundamentally a single process
checking cameras one at a time, in a loop, on one machine.** At ~30
cameras this works fine — a full pass completes well within the cycle
interval. It does **not** scale to 80,000 cameras as-is, for reasons
that are structural, not a tuning problem:

1. **One machine cannot hold 80,000 concurrent real workloads.** Each
   camera's "did something change, and if so, embed it" work involves
   real CPU/GPU work (YOLO detection, ONNX embedding) and real I/O
   (an HTTP call to video-stream, an ffmpeg subprocess). Even with
   `asyncio.to_thread` keeping the HTTP server responsive, a single
   process is still bounded by this one machine's CPU, memory, and (for
   the embedding step specifically) GPU.
2. **A sequential loop over 80,000 cameras cannot complete within a
   short cycle interval.** Even a trivially cheap per-camera check,
   done one at a time, at 80,000 cameras, takes far longer than 3s or
   20s to get through the whole list once — the "cycle interval" stops
   meaning anything at that scale under today's one-at-a-time design.
3. **A single `httpx.Client`/database connection is not built for
   80,000 cameras' worth of concurrent traffic.** Even with the shared
   cache removing redundant camera-list fetches, every camera still
   needs its own `ensure_stream_running` check and (on a real
   detection) its own database write — that's a very different
   concurrency profile at 80,000 than at 30.

None of this is a flaw in today's code — it was never meant to be the
final, full-scale architecture. It's a correctly-built single worker,
which is exactly the unit the real scaling design (Section 2) is meant
to replicate many times over.

---

## 2. The real architecture: sharded workers, not one bigger loop

Per `SENTINEL_IDEA_AND_ROADMAP.md` Section 6.2's own analogy: one
security guard can't watch 80,000 cameras, but 1,000 guards, each
watching 80, all writing into the same shared logbook, can. Concretely,
for `vehicle-ingest` specifically:

```
Instead of:  1 process looping over 80,000 cameras      ❌ (today's shape, doesn't scale)

Do this:     N separate copies of this SAME process, each
             assigned a disjoint SLICE of the camera list
                     │
                     ▼
             All copies write to the SAME shared database
             (the already-existing vehicle_sighting table —
             zero schema change needed for this)
                     │
                     ▼
             Vehicle search/route queries work identically
             regardless of how many workers fed the data
```

This works cleanly here specifically because `vehicle-ingest`'s
"watching" code and its "memory" (the Neon/Postgres database via
`SightingStore`) are already separate — a worker instance doesn't need
to know how many *other* workers exist; it only needs to know **which
slice of cameras is its own responsibility**, and write to the shared
store exactly as it already does today.

### 2.1 Camera sharding — the one concrete mechanism needed first

Add two new env vars, read once at startup (same convention as this
project's existing `VEHICLE_INGEST_CYCLE_INTERVAL` / etc.):

```python
WORKER_SHARD_INDEX = int(os.environ.get("VEHICLE_INGEST_SHARD_INDEX", "0"))
WORKER_SHARD_COUNT = int(os.environ.get("VEHICLE_INGEST_SHARD_COUNT", "1"))
```

Then, right where today's code already applies `CAMERA_ALLOWLIST`
filtering (both loops, immediately after fetching the camera list),
add one more filter:

```python
if WORKER_SHARD_COUNT > 1:
    cameras = [
        c for c in cameras
        if hash(c.camera_id) % WORKER_SHARD_COUNT == WORKER_SHARD_INDEX
    ]
```

With this one change, running **5 copies** of the exact same process —
`VEHICLE_INGEST_SHARD_COUNT=5` and `VEHICLE_INGEST_SHARD_INDEX` set to
0, 1, 2, 3, 4 respectively — already divides 80,000 cameras into five
~16,000-camera slices, each handled by its own independent process,
with no other code change required. `CAMERA_ALLOWLIST` and shard
filtering compose cleanly (allowlist narrows first, then sharding
divides what's left), so existing test/scoping behavior is unaffected
when `WORKER_SHARD_COUNT` is left at its default of 1.

This is the single highest-leverage, lowest-risk change to make first —
everything else in this document assumes it exists.

### 2.2 What sharding does NOT yet solve (explicitly out of scope here)

- **Who decides how many workers to run, and deploys them.** Sharding
  makes N copies of this process *capable* of dividing the work; it
  does not itself launch N copies across N machines/containers, or
  decide what N should be as camera count grows. That's a real
  orchestration layer (e.g. Kubernetes with a fixed replica count, or a
  more dynamic autoscaler keyed off total registered camera count) —
  genuine infrastructure work, not something this codebase alone
  decides.
- **Rebalancing when a worker goes down.** With a fixed `hash() %
  WORKER_SHARD_COUNT` scheme, if worker 3 of 5 crashes, its ~16,000
  cameras simply go unwatched until it's restarted — there's no
  automatic reassignment to the remaining 4 workers. A fixed shard
  count accepts this gap in exchange for simplicity; a more
  sophisticated scheme (consistent hashing, a coordination service like
  etcd/Zookeeper assigning cameras dynamically) would close it, at real
  added complexity. Worth it well before 80,000 cameras, not necessarily
  the very first version.
- **Per-shard observability.** Today's `/health` endpoint reports on
  *all* cameras this process instance knows about. At N workers, you'd
  want a way to see "which of my 5 workers are healthy and what's each
  one's shard doing" from one place — a small addition (each worker
  already reports its own shard index), but not built yet.

---

## 3. Compute cost at scale, and why motion-gating matters even more here

This reuses `SENTINEL_IDEA_AND_ROADMAP.md` Section 6.3-6.4's own cost
model directly — restated briefly for this document's context:

```
Total GPU cost ≈ (price per GPU-hour) × (hours run) ÷ (cameras per GPU) × (total cameras)
```

At the roadmap's own illustrative numbers (~$0.40/GPU-hour, ~15 cameras
per GPU with naive per-camera inference), 80,000 cameras lands at
**roughly ₹1+ crore/month in compute alone**, before motion-gating or
batching are applied.

**This is exactly why the motion-gated loop built in this session
matters at scale, concretely, not just as a nice-to-have:** every
camera-check that the cheap pixel-diff correctly identifies as "nothing
changed" is a full YOLO+embedding run that never happens — and the real,
sourced research already gathered in the roadmap doc (NoScope, Reducto,
the Hikvision AcuSense figures) puts a realistic, camera-mix-dependent
savings range at roughly 50-80% fewer expensive-pipeline runs. Applied
to the cost formula above, that alone is the difference between ~₹1
crore/month and roughly ₹2,000-5,000/camera/month more realistically —
still a lot of money at 80,000 cameras, but a very different number.

**What this session's motion-gating does NOT yet include, that the
roadmap's own Section 6.5 names as further, stackable savings:**

1. **Batching across cameras** (roadmap 6.5.2) — today, each camera's
   frame (once motion is confirmed) is still embedded one at a time.
   Grouping multiple cameras' confirmed-motion frames into one batched
   GPU call, the way NVIDIA DeepStream-style pipelines do, is a real,
   separate, stackable saving on top of motion-gating — not yet
   implemented here.
2. **Edge-side motion gating** (roadmap 6.5.3) — today's motion check
   runs centrally (on whatever machine runs `vehicle-ingest`), after the
   frame has already been pulled from `video-stream`. Doing the cheap
   pixel-diff step *at or near the camera itself* and only forwarding a
   frame centrally when motion is real would additionally cut bandwidth
   costs, which are a distinct expense from GPU compute at this scale.
3. **Region-of-interest cropping** (roadmap 6.5.4) — not implemented;
   would let the motion-diff and the detector both ignore parts of a
   frame that never contain a vehicle (sky, building walls), which both
   speeds up and can improve accuracy.

---

## 4. Concrete, ordered next steps

In priority order — each step is independently useful and doesn't
require the next one to already exist:

1. **Camera sharding (Section 2.1).** Smallest code change, largest
   unlock — turns "one process, one machine" into "N identical
   processes, each handling its own slice," with zero new
   infrastructure required to *try* it (can be validated today by
   running two copies of this same process locally with different
   `VEHICLE_INGEST_SHARD_INDEX` values against the same database).
2. **Bounded per-process concurrency.** Even within one shard's slice of
   cameras, process that slice's cameras with a bounded worker pool
   (e.g. a semaphore capping concurrent `asyncio.to_thread` calls to a
   configurable number, rather than one dispatched per camera with no
   limit) — keeps one worker's own resource usage predictable as its
   assigned slice grows, instead of unbounded thread creation.
3. **An actual deployment/orchestration layer** that decides how many
   shards to run and keeps them running (Section 2.2's first bullet) —
   real infrastructure work, likely containerized (Docker +
   Kubernetes/ECS/similar), sized to however many cameras are actually
   registered at the time.
4. **GPU batching across cameras within a shard** (Section 3, item 1) —
   once sharding and bounded concurrency exist, batch confirmed-motion
   frames from multiple cameras in the same shard into one inference
   call rather than one-at-a-time.
5. **Edge-side motion gating** (Section 3, item 2) — a longer-lead-time
   investment (requires something running at/near each camera, not just
   centrally), worth it once bandwidth cost at the target camera count
   is itself a significant line item.
6. **Dynamic shard rebalancing** (Section 2.2's second bullet) — only
   worth the added complexity once worker failures at the target scale
   are frequent enough that losing a whole shard's coverage until
   manual restart is a real operational problem, not a rare event.
