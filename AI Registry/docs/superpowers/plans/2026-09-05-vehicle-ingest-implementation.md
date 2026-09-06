# Vehicle Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `vehicle-ingest`, a new standalone service that periodically
pulls one frame from each streamable camera's already-running live HLS
feed (served by `video-stream`) and runs it through the existing,
unmodified `vehicle-detection` pipeline (`run_pipeline()`), so live camera
footage produces real `vehicle_sighting` rows without any human uploading
a photo.

**Architecture:** `vehicle-ingest` never talks to a camera or an RTSP URL
directly. It calls `video-stream`'s existing HTTP API to get the camera
list and to ensure a camera's stream is running, then reads the newest
`.ts` segment file `video-stream` has already written to disk and extracts
one JPEG frame from it with a local, fast ffmpeg call (no network RTSP
connection, no repeated keyframe wait). That frame is handed to
`vehicle-detection`'s `run_pipeline()` (loaded once at process startup,
reused across every camera and cycle) and deleted immediately afterward.

**Tech Stack:** Python 3.12, FastAPI + uvicorn (for `/health`, matching
`video-stream`/`vehicle-detection`'s own convention), `httpx` for calling
`video-stream`'s API, local `ffmpeg` subprocess calls (already a hard
dependency of `video-stream`, already installed on this machine), pytest
for tests.

**Spec:** `AI Registry/docs/superpowers/specs/2026-09-05-vehicle-ingest-design.md`

## Global Constraints

- No new frontend work — this is a pure background service (spec §5).
- No changes to `video-stream`, `vehicle-detection`, or `vehicle-reid`'s
  existing code — everything here is additive, calling existing,
  unmodified APIs/functions (spec §5).
- No raw-frame retention of any kind — a frame is deleted immediately
  after `run_pipeline()` processes it (spec §3.3).
- `VehicleDetector` and `VehicleEmbedder` must be constructed exactly
  once, at process startup, and reused across every camera/cycle — never
  reconstructed per-frame (spec §4).
- Every streamable camera is cycled, not just ones a human is actively
  viewing (spec §3.2), each re-sampled roughly every 10-30 seconds.
- Same-machine, direct filesystem access to `video-stream`'s
  `data/hls/<camera_id>/*.ts` files — no new endpoint added to
  `video-stream` for this (spec §3, step 3; spec §6 explicitly defers a
  networked alternative).

---

## Task 1: Project scaffolding

**Files:**
- Create: `AI Registry/vehicle-ingest/pyproject.toml`
- Create: `AI Registry/vehicle-ingest/.gitignore`
- Create: `AI Registry/vehicle-ingest/src/__init__.py`
- Create: `AI Registry/vehicle-ingest/tests/__init__.py`

**Interfaces:**
- Produces: a real Python venv (`.venv/`) with `fastapi`, `uvicorn`,
  `httpx`, `pytest`, `pytest-asyncio` installed, ready for every later
  task to import from `src/`.

- [ ] **Step 1: Create the project directory and pyproject.toml**

```toml
[project]
name = "vehicle-ingest"
version = "0.1.0"
description = "Periodically pulls a frame from each streamable camera's live HLS feed (via video-stream) and runs it through vehicle-detection's existing detect -> embed -> store pipeline. No new AI model, no new storage format -- a scheduler that feeds the pipeline that already exists."
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn>=0.32",
    "httpx>=0.27",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

Save this to `AI Registry/vehicle-ingest/pyproject.toml`.

- [ ] **Step 2: Create .gitignore**

```
__pycache__/
*.pyc
.pytest_cache/
*.egg-info/
.venv/
.env
```

Save this to `AI Registry/vehicle-ingest/.gitignore`.

- [ ] **Step 3: Create empty package markers**

Create `AI Registry/vehicle-ingest/src/__init__.py` (empty file) and
`AI Registry/vehicle-ingest/tests/__init__.py` (empty file).

- [ ] **Step 4: Create and populate the venv**

Run:
```bash
cd "AI Registry/vehicle-ingest"
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```
Expected: installs cleanly, no errors. `pip show fastapi httpx pytest` all
resolve.

- [ ] **Step 5: Commit**

```bash
cd "AI Registry/vehicle-ingest"
git add pyproject.toml .gitignore src/__init__.py tests/__init__.py
git commit -m "chore: scaffold vehicle-ingest project"
```

---

## Task 2: `segment_frame.py` — extract one JPEG frame from a `.ts` segment

**Files:**
- Create: `AI Registry/vehicle-ingest/src/segment_frame.py`
- Test: `AI Registry/vehicle-ingest/tests/test_segment_frame.py`

**Interfaces:**
- Consumes: nothing from other tasks — this is a leaf module, only
  depends on `ffmpeg` being on `PATH` (already verified installed this
  session: ffmpeg 6.1.1-3ubuntu5).
- Produces:
  - `class SegmentFrameError(Exception)` with `.reason: str`
  - `def extract_frame(segment_path: str, output_path: str) -> None` —
    raises `SegmentFrameError` on failure, otherwise writes a JPEG to
    `output_path`. Later tasks (Task 4) call this directly.

This mirrors the real, verified-this-session command
(`ffmpeg -i <segment> -frames:v 1 -update 1 -q:v 2 <out>.jpg`) — already
tested directly against real camera output earlier in this project's
history and confirmed to produce valid JPEGs (1920x1080, ~31-140KB
depending on scene content).

- [ ] **Step 1: Write the failing test**

```python
# AI Registry/vehicle-ingest/tests/test_segment_frame.py
import os
import subprocess
import tempfile

import pytest

from src.segment_frame import extract_frame, SegmentFrameError


def _make_real_test_segment(path: str) -> None:
    """Generates a real, tiny, valid .ts segment using ffmpeg's own
    testsrc filter -- no network, no camera needed, but a genuine decodable
    video file, not a fake/mocked one."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=5",
            "-c:v", "libx264", "-f", "mpegts", path,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def test_extract_frame_produces_real_jpeg():
    with tempfile.TemporaryDirectory() as tmpdir:
        segment_path = os.path.join(tmpdir, "0.ts")
        output_path = os.path.join(tmpdir, "frame.jpg")
        _make_real_test_segment(segment_path)

        extract_frame(segment_path, output_path)

        assert os.path.exists(output_path)
        assert os.path.getsize(output_path) > 0
        with open(output_path, "rb") as f:
            header = f.read(3)
        # Real JPEG magic bytes (SOI marker) -- confirms this is a genuine
        # JPEG file, not an empty or corrupt one.
        assert header == b"\xff\xd8\xff"


def test_extract_frame_missing_segment_raises():
    with tempfile.TemporaryDirectory() as tmpdir:
        with pytest.raises(SegmentFrameError) as exc_info:
            extract_frame(os.path.join(tmpdir, "does_not_exist.ts"), os.path.join(tmpdir, "out.jpg"))
        assert exc_info.value.reason == "SEGMENT_NOT_FOUND"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "AI Registry/vehicle-ingest" && source .venv/bin/activate && pytest tests/test_segment_frame.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.segment_frame'`

- [ ] **Step 3: Write the implementation**

```python
# AI Registry/vehicle-ingest/src/segment_frame.py
"""
Extracts one JPEG frame from a real, already-on-disk HLS .ts segment file
(written by video-stream's own long-running ffmpeg process -- see
AI Registry/video-stream/src/stream_manager.py). This is a LOCAL FILE
decode, not a new network/RTSP connection -- the real, measured cost this
avoids (a fresh RTSP connection must wait for a keyframe, up to 20-122+
seconds on this project's actual cameras) was already paid once by
video-stream's own process before this segment file ever existed.
"""
import os
import subprocess


class SegmentFrameError(Exception):
    def __init__(self, reason: str, message: str = ""):
        self.reason = reason
        super().__init__(message or reason)


def extract_frame(segment_path: str, output_path: str) -> None:
    """
    Writes one JPEG frame (the segment's first decodable frame) to
    output_path. Raises SegmentFrameError on any failure -- a missing
    segment, a corrupt/truncated file, or ffmpeg itself failing --
    matching the skip-and-continue convention already established in
    vehicle-detection/src/pipeline.py (a bad frame should not crash the
    whole ingest cycle for every other camera).
    """
    if not os.path.exists(segment_path):
        raise SegmentFrameError(
            "SEGMENT_NOT_FOUND", f"Segment file does not exist: {segment_path}"
        )

    cmd = [
        "ffmpeg", "-y",
        "-i", segment_path,
        "-frames:v", "1",
        "-update", "1",
        "-q:v", "2",
        output_path,
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, timeout=15,
        )
    except FileNotFoundError:
        raise SegmentFrameError("FFMPEG_NOT_FOUND", "ffmpeg is not installed or not on PATH")
    except subprocess.TimeoutExpired:
        raise SegmentFrameError("FFMPEG_TIMEOUT", f"ffmpeg took longer than 15s on {segment_path}")

    if result.returncode != 0 or not os.path.exists(output_path):
        stderr_tail = result.stderr.decode(errors="replace")[-500:] if result.stderr else ""
        raise SegmentFrameError(
            "FFMPEG_FAILED", f"ffmpeg exited {result.returncode} on {segment_path}: {stderr_tail}"
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_segment_frame.py -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "AI Registry/vehicle-ingest"
git add src/segment_frame.py tests/test_segment_frame.py
git commit -m "feat: extract one JPEG frame from a real HLS segment file"
```

---

## Task 3: `video_stream_client.py` — talk to `video-stream`'s HTTP API

**Files:**
- Create: `AI Registry/vehicle-ingest/src/video_stream_client.py`
- Test: `AI Registry/vehicle-ingest/tests/test_video_stream_client.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `class VideoStreamClientError(Exception)` with `.reason: str`
  - `class StreamCamera` — a small dataclass with `camera_id: str`,
    `name: str`, `stream_path: str` (mirrors `video-stream`'s own real
    `GET /cameras` response shape, confirmed this session:
    `{"cameras": [{"camera_id", "name", "stream_path"}]}`)
  - `class VideoStreamClient` with:
    - `def __init__(self, base_url: str = "http://127.0.0.1:8100")`
    - `def list_cameras(self) -> list[StreamCamera]` — calls
      `GET {base_url}/cameras`
    - `def ensure_stream_running(self, camera_id: str) -> bool` — calls
      `GET {base_url}/stream/{camera_id}/index.m3u8`; returns `True` on a
      real `200`, `False` on a `503` (still connecting -- a real,
      expected transient state per `video-stream`'s own documented
      contract, not an error), raises `VideoStreamClientError` on any
      other status (404/500/502).
  - Later tasks (Task 5) construct one `VideoStreamClient` and call both
    methods.

- [ ] **Step 1: Write the failing test**

```python
# AI Registry/vehicle-ingest/tests/test_video_stream_client.py
import httpx
import pytest

from src.video_stream_client import VideoStreamClient, VideoStreamClientError, StreamCamera


class _FakeTransport(httpx.BaseTransport):
    """A real httpx transport that returns fixed, known responses --
    exercises VideoStreamClient's real HTTP parsing logic end-to-end
    without needing a real video-stream server running for this unit
    test. (Task 5's integration work is what proves this against the
    real, live service.)"""

    def __init__(self, responses: dict):
        self.responses = responses

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        if key not in self.responses:
            raise AssertionError(f"Unexpected request: {key}")
        status, json_body, headers = self.responses[key]
        return httpx.Response(status, json=json_body, headers=headers or {})


def _client_with(responses: dict) -> VideoStreamClient:
    client = VideoStreamClient(base_url="http://test")
    client._http = httpx.Client(transport=_FakeTransport(responses), base_url="http://test")
    return client


def test_list_cameras_parses_real_response_shape():
    client = _client_with({
        ("GET", "/cameras"): (200, {
            "cameras": [
                {"camera_id": "abc-123", "name": "Test Cam", "stream_path": "rtsp://x/y"},
            ]
        }, None),
    })
    cameras = client.list_cameras()
    assert cameras == [StreamCamera(camera_id="abc-123", name="Test Cam", stream_path="rtsp://x/y")]


def test_ensure_stream_running_true_on_200():
    client = _client_with({
        ("GET", "/stream/abc-123/index.m3u8"): (200, {}, None),
    })
    assert client.ensure_stream_running("abc-123") is True


def test_ensure_stream_running_false_on_503():
    client = _client_with({
        ("GET", "/stream/abc-123/index.m3u8"): (503, {"detail": "still starting"}, {"retry-after": "5"}),
    })
    assert client.ensure_stream_running("abc-123") is False


def test_ensure_stream_running_raises_on_404():
    client = _client_with({
        ("GET", "/stream/abc-123/index.m3u8"): (404, {"detail": "no stream_path registered"}, None),
    })
    with pytest.raises(VideoStreamClientError) as exc_info:
        client.ensure_stream_running("abc-123")
    assert exc_info.value.reason == "NOT_FOUND"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_video_stream_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.video_stream_client'`

- [ ] **Step 3: Write the implementation**

```python
# AI Registry/vehicle-ingest/src/video_stream_client.py
"""
Real HTTP client for video-stream's existing API (AI Registry/video-stream
-- see its docs/PRD.md Section 6 for the full, authoritative contract).
vehicle-ingest calls exactly the two endpoints a browser would call:
GET /cameras (the picker's data source) and
GET /stream/{camera_id}/index.m3u8 (starts/confirms the camera's ffmpeg is
running). No new endpoint is added to video-stream for this -- see this
project's spec, Section 6.
"""
from dataclasses import dataclass

import httpx


class VideoStreamClientError(Exception):
    def __init__(self, reason: str, message: str = ""):
        self.reason = reason
        super().__init__(message or reason)


@dataclass(frozen=True)
class StreamCamera:
    camera_id: str
    name: str
    stream_path: str


class VideoStreamClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8100"):
        self._http = httpx.Client(base_url=base_url, timeout=10.0)

    def list_cameras(self) -> list[StreamCamera]:
        try:
            response = self._http.get("/cameras")
        except httpx.HTTPError as e:
            raise VideoStreamClientError("REQUEST_FAILED", f"GET /cameras failed: {e}")

        if response.status_code != 200:
            raise VideoStreamClientError(
                "UNEXPECTED_STATUS", f"GET /cameras returned {response.status_code}"
            )

        body = response.json()
        return [
            StreamCamera(
                camera_id=c["camera_id"], name=c["name"], stream_path=c["stream_path"]
            )
            for c in body["cameras"]
        ]

    def ensure_stream_running(self, camera_id: str) -> bool:
        """
        Returns True once the camera's playlist is ready (a real 200 --
        video-stream's ffmpeg has written a first segment). Returns False
        on a 503 -- video-stream's own documented, expected "still
        starting" state (see its PRD Section 6) -- the caller should
        retry later, not treat this as an error. Raises
        VideoStreamClientError for every other status (404/500/502),
        which ARE real errors per video-stream's own contract.
        """
        try:
            response = self._http.get(f"/stream/{camera_id}/index.m3u8")
        except httpx.HTTPError as e:
            raise VideoStreamClientError("REQUEST_FAILED", f"GET playlist failed: {e}")

        if response.status_code == 200:
            return True
        if response.status_code == 503:
            return False
        if response.status_code == 404:
            raise VideoStreamClientError(
                "NOT_FOUND", f"Camera {camera_id} has no stream_path registered"
            )
        raise VideoStreamClientError(
            "UNEXPECTED_STATUS", f"GET playlist for {camera_id} returned {response.status_code}"
        )

    def close(self) -> None:
        self._http.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_video_stream_client.py -v`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "AI Registry/vehicle-ingest"
git add src/video_stream_client.py tests/test_video_stream_client.py
git commit -m "feat: add HTTP client for video-stream's existing API"
```

---

## Task 4: `newest_segment.py` — find the newest `.ts` segment for a camera

**Files:**
- Create: `AI Registry/vehicle-ingest/src/newest_segment.py`
- Test: `AI Registry/vehicle-ingest/tests/test_newest_segment.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `def find_newest_segment(hls_data_dir: str, camera_id: str) -> str | None`
    — returns the absolute path to the numerically-highest `N.ts` file in
    `<hls_data_dir>/<camera_id>/`, or `None` if the camera's directory
    doesn't exist or has no segments yet (a real, expected transient
    state -- matches how `video-stream`'s own `ensure_started` can return
    before the first segment exists).
  - Later tasks (Task 5) call this with `video-stream`'s real
    `DATA_DIR` path (`AI Registry/video-stream/data/hls`).

Segments are named `0.ts`, `1.ts`, `2.ts`, ... (confirmed this session,
real `video-stream` output) -- sorting by filename string would put
`10.ts` before `2.ts`; this must sort numerically.

- [ ] **Step 1: Write the failing test**

```python
# AI Registry/vehicle-ingest/tests/test_newest_segment.py
import os
import tempfile

from src.newest_segment import find_newest_segment


def test_finds_highest_numbered_segment_even_with_more_than_10():
    with tempfile.TemporaryDirectory() as tmpdir:
        camera_dir = os.path.join(tmpdir, "cam-abc")
        os.makedirs(camera_dir)
        # Deliberately create out of numeric order, including a >=10 case
        # that would sort wrong as a plain string ("10.ts" < "2.ts").
        for name in ["0.ts", "2.ts", "1.ts", "10.ts", "index.m3u8"]:
            with open(os.path.join(camera_dir, name), "w") as f:
                f.write("x")

        result = find_newest_segment(tmpdir, "cam-abc")

        assert result == os.path.join(camera_dir, "10.ts")


def test_returns_none_when_camera_dir_missing():
    with tempfile.TemporaryDirectory() as tmpdir:
        result = find_newest_segment(tmpdir, "does-not-exist")
        assert result is None


def test_returns_none_when_no_segments_yet():
    with tempfile.TemporaryDirectory() as tmpdir:
        camera_dir = os.path.join(tmpdir, "cam-abc")
        os.makedirs(camera_dir)
        with open(os.path.join(camera_dir, "index.m3u8"), "w") as f:
            f.write("x")

        result = find_newest_segment(tmpdir, "cam-abc")

        assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_newest_segment.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.newest_segment'`

- [ ] **Step 3: Write the implementation**

```python
# AI Registry/vehicle-ingest/src/newest_segment.py
"""
Finds the newest .ts segment file video-stream has already written for a
camera, directly on the shared filesystem -- see this project's spec,
Section 3 step 3, for why this reads video-stream's own data directory
directly rather than adding a new endpoint to it.
"""
import os
import re

_SEGMENT_NAME_RE = re.compile(r"^(\d+)\.ts$")


def find_newest_segment(hls_data_dir: str, camera_id: str) -> str | None:
    """
    Returns the absolute path to the highest-numbered N.ts file in
    <hls_data_dir>/<camera_id>/, or None if that directory doesn't exist
    or has no segment files yet -- both real, expected states (a camera
    that video-stream hasn't started yet, or one still waiting on its
    first segment).
    """
    camera_dir = os.path.join(hls_data_dir, camera_id)
    if not os.path.isdir(camera_dir):
        return None

    numbered = []
    for filename in os.listdir(camera_dir):
        match = _SEGMENT_NAME_RE.match(filename)
        if match:
            numbered.append((int(match.group(1)), filename))

    if not numbered:
        return None

    numbered.sort(key=lambda pair: pair[0])
    _, newest_filename = numbered[-1]
    return os.path.join(camera_dir, newest_filename)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_newest_segment.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "AI Registry/vehicle-ingest"
git add src/newest_segment.py tests/test_newest_segment.py
git commit -m "feat: find the newest HLS segment file for a camera"
```

---

## Task 5: `ingest_cycle.py` — one camera, one cycle, end to end

**Files:**
- Create: `AI Registry/vehicle-ingest/src/ingest_cycle.py`
- Test: `AI Registry/vehicle-ingest/tests/test_ingest_cycle.py`

**Interfaces:**
- Consumes:
  - `StreamCamera` (Task 3)
  - `VideoStreamClient.ensure_stream_running(camera_id: str) -> bool` (Task 3)
  - `find_newest_segment(hls_data_dir: str, camera_id: str) -> str | None` (Task 4)
  - `extract_frame(segment_path: str, output_path: str) -> None`,
    `SegmentFrameError` (Task 2)
  - `run_pipeline(image_paths: list, camera_id: str, detector, embedder, store) -> PipelineResult`
    — the REAL, existing, unmodified function from
    `AI Registry/vehicle-detection/src/pipeline.py` (confirmed this
    session: takes a list of file paths, a `camera_id` string, and
    pre-constructed `detector`/`embedder`/`store` objects; returns a
    `PipelineResult` with `.saved_sighting_ids: list` and
    `.skipped: list[tuple[str, str]]`)
- Produces:
  - `class CycleResult` with `.status: str` (one of `"saved"`,
    `"skipped_no_frame"`, `"skipped_pipeline_error"`,
    `"stream_not_ready"`) and `.detail: str`
  - `def run_one_cycle(camera, video_stream_client, hls_data_dir, detector, embedder, store) -> CycleResult`
    — later tasks (Task 6) call this once per camera per scheduling tick.

This is the task that actually wires Tasks 2-4 together with the
existing, unmodified `run_pipeline`. It intentionally does NOT construct
`detector`/`embedder`/`store` itself -- those are passed in, already
built once at process startup (Task 6), per the spec's Global Constraint
on never reconstructing models per-frame.

- [ ] **Step 1: Write the failing test**

```python
# AI Registry/vehicle-ingest/tests/test_ingest_cycle.py
import os
import tempfile
from unittest.mock import MagicMock

from src.ingest_cycle import run_one_cycle, CycleResult
from src.video_stream_client import StreamCamera


def _real_segment(path: str) -> None:
    import subprocess
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=5",
            "-c:v", "libx264", "-f", "mpegts", path,
        ],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def test_full_cycle_calls_pipeline_and_deletes_frame(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        camera = StreamCamera(camera_id="cam-1", name="Test", stream_path="rtsp://x")
        camera_dir = os.path.join(tmpdir, "cam-1")
        os.makedirs(camera_dir)
        _real_segment(os.path.join(camera_dir, "0.ts"))

        fake_client = MagicMock()
        fake_client.ensure_stream_running.return_value = True

        fake_pipeline_result = MagicMock()
        fake_pipeline_result.saved_sighting_ids = ["sighting-1"]
        fake_pipeline_result.skipped = []

        captured_frame_paths = []

        def fake_run_pipeline(image_paths, camera_id, detector, embedder, store):
            captured_frame_paths.extend(image_paths)
            assert camera_id == "cam-1"
            assert os.path.exists(image_paths[0])  # frame must exist WHEN pipeline runs
            return fake_pipeline_result

        monkeypatch.setattr("src.ingest_cycle.run_pipeline", fake_run_pipeline)

        result = run_one_cycle(
            camera=camera,
            video_stream_client=fake_client,
            hls_data_dir=tmpdir,
            detector=MagicMock(),
            embedder=MagicMock(),
            store=MagicMock(),
        )

        assert isinstance(result, CycleResult)
        assert result.status == "saved"
        # The frame must be deleted immediately after the pipeline call --
        # no raw-frame retention, per the spec's Global Constraints.
        assert not os.path.exists(captured_frame_paths[0])


def test_cycle_returns_stream_not_ready_without_calling_pipeline(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        camera = StreamCamera(camera_id="cam-1", name="Test", stream_path="rtsp://x")
        fake_client = MagicMock()
        fake_client.ensure_stream_running.return_value = False

        pipeline_called = []
        monkeypatch.setattr(
            "src.ingest_cycle.run_pipeline",
            lambda *a, **k: pipeline_called.append(True),
        )

        result = run_one_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
        )

        assert result.status == "stream_not_ready"
        assert pipeline_called == []


def test_cycle_returns_skipped_no_frame_when_no_segment_exists(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        camera = StreamCamera(camera_id="cam-1", name="Test", stream_path="rtsp://x")
        os.makedirs(os.path.join(tmpdir, "cam-1"))  # dir exists, but no .ts file in it yet
        fake_client = MagicMock()
        fake_client.ensure_stream_running.return_value = True

        result = run_one_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
        )

        assert result.status == "skipped_no_frame"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_ingest_cycle.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.ingest_cycle'`

- [ ] **Step 3: Write the implementation**

```python
# AI Registry/vehicle-ingest/src/ingest_cycle.py
"""
Runs one full ingest cycle for one camera: ensure video-stream has it
running, find its newest segment, extract one frame, hand it to
vehicle-detection's existing run_pipeline(), delete the frame. See this
project's spec (2026-09-05-vehicle-ingest-design.md) Section 3 for the
full architecture this implements step by step.
"""
import os
import sys
import tempfile
from dataclasses import dataclass

sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-detection", "src")
)
from pipeline import run_pipeline  # noqa: E402

from src.newest_segment import find_newest_segment
from src.segment_frame import extract_frame, SegmentFrameError
from src.video_stream_client import StreamCamera, VideoStreamClientError


@dataclass
class CycleResult:
    status: str  # "saved" | "skipped_no_frame" | "skipped_pipeline_error" | "stream_not_ready"
    detail: str


def run_one_cycle(
    camera: StreamCamera,
    video_stream_client,
    hls_data_dir: str,
    detector,
    embedder,
    store,
) -> CycleResult:
    try:
        is_ready = video_stream_client.ensure_stream_running(camera.camera_id)
    except VideoStreamClientError as e:
        return CycleResult("stream_not_ready", f"video-stream error: {e.reason}")

    if not is_ready:
        # A real, expected transient state -- video-stream's ffmpeg is
        # starting but hasn't written a first segment yet (can take up to
        # ~90s+ on this project's own cameras). Not an error -- the next
        # scheduled cycle for this camera will just try again.
        return CycleResult("stream_not_ready", "video-stream still starting this camera")

    segment_path = find_newest_segment(hls_data_dir, camera.camera_id)
    if segment_path is None:
        return CycleResult("skipped_no_frame", "no segment file written yet")

    with tempfile.TemporaryDirectory() as tmpdir:
        frame_path = os.path.join(tmpdir, "frame.jpg")
        try:
            extract_frame(segment_path, frame_path)
        except SegmentFrameError as e:
            return CycleResult("skipped_no_frame", f"frame extraction failed: {e.reason}")

        try:
            result = run_pipeline([frame_path], camera.camera_id, detector, embedder, store)
        except Exception as e:  # noqa: BLE001 -- a bad frame must never kill the whole ingest loop
            return CycleResult("skipped_pipeline_error", f"pipeline raised: {e}")
        # frame_path is deleted automatically here, on `with` block exit --
        # no raw-frame retention, per this project's Global Constraints.

    if result.saved_sighting_ids:
        return CycleResult("saved", f"{len(result.saved_sighting_ids)} sighting(s) saved")
    return CycleResult("skipped_pipeline_error", f"pipeline skipped: {result.skipped}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_ingest_cycle.py -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "AI Registry/vehicle-ingest"
git add src/ingest_cycle.py tests/test_ingest_cycle.py
git commit -m "feat: run one full ingest cycle for one camera"
```

---

## Task 6: `main.py` — the service entrypoint, scheduling loop, and `/health`

**Files:**
- Create: `AI Registry/vehicle-ingest/src/main.py`
- Test: `AI Registry/vehicle-ingest/tests/test_main.py`

**Interfaces:**
- Consumes:
  - `VideoStreamClient` (Task 3), constructed once
  - `run_one_cycle` (Task 5)
  - `VehicleDetector` from `vehicle-detection/src/detector.py` (real,
    existing class — constructed once here, per Global Constraints)
  - `VehicleEmbedder` from `vehicle-reid/src/embedder.py` (real, existing
    class — constructed once here)
  - `SightingStore` from `vehicle-detection/src/sighting_store.py` (real,
    existing class)
- Produces: a runnable FastAPI app (`app`) with `GET /health`, and a
  background asyncio task that cycles every camera on a repeating timer.
  This is the final task — nothing later consumes from it.

- [ ] **Step 1: Write the failing test**

```python
# AI Registry/vehicle-ingest/tests/test_main.py
from unittest.mock import MagicMock, patch

from httpx import ASGITransport, AsyncClient
import pytest

from src.main import app


@pytest.mark.asyncio
async def test_health_endpoint_reports_ok():
    # The lifespan (which loads real YOLO/ONNX models) is intentionally
    # NOT triggered here -- this test only exercises routing, matching
    # how vehicle-detection's own test_api.py keeps unit tests fast by
    # not loading real heavy models. Model-loading itself is exercised
    # for real in the manual verification step below (Step 6), against
    # the live service.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("src.main._camera_cycle_task", None):
            response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_main.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.main'`

- [ ] **Step 3: Write the implementation**

```python
# AI Registry/vehicle-ingest/src/main.py
"""
Entrypoint for vehicle-ingest: loads the real detection/embedding models
ONCE at startup (never per-frame -- see this project's spec Section 4 for
why that matters), then runs a background loop that cycles every
streamable camera on a repeating timer, pulling one frame from each and
feeding it to vehicle-detection's existing, unmodified run_pipeline() via
run_one_cycle().

Run locally:
    uvicorn src.main:app --port 8200
"""
import asyncio
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-detection", "src"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-reid", "src"))
from detector import VehicleDetector  # noqa: E402
from sighting_store import SightingStore  # noqa: E402
from embedder import VehicleEmbedder  # noqa: E402

from src.ingest_cycle import run_one_cycle
from src.video_stream_client import VideoStreamClient

VIDEO_STREAM_BASE_URL = os.environ.get("VIDEO_STREAM_BASE_URL", "http://127.0.0.1:8100")
HLS_DATA_DIR = os.environ.get(
    "VIDEO_STREAM_HLS_DATA_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "video-stream", "data", "hls"),
)
# Real cameras on this project's shared gateway have been measured this
# session producing segments 20-122+ seconds apart -- a per-camera cycle
# interval below the low end of that range would mostly just re-read the
# same still-current segment. 20s balances "reasonably fresh" against not
# hammering video-stream/the gateway needlessly.
CYCLE_INTERVAL_SECONDS = float(os.environ.get("VEHICLE_INGEST_CYCLE_INTERVAL", "20"))
DEFAULT_EMBEDDER_MODEL = os.path.join(
    os.path.dirname(__file__), "..", "..", "vehicle-reid", "models",
    "vehicle_vit_clip_reid_finetuned.onnx",
)

_video_stream_client: VideoStreamClient | None = None
_detector: VehicleDetector | None = None
_embedder: VehicleEmbedder | None = None
_camera_cycle_task: asyncio.Task | None = None
_last_cycle_summary: dict = {}


async def _camera_cycle_loop():
    global _last_cycle_summary
    while True:
        try:
            cameras = _video_stream_client.list_cameras()
        except Exception as e:  # noqa: BLE001 -- a listing failure must not kill the loop
            _last_cycle_summary = {"error": f"list_cameras failed: {e}"}
            await asyncio.sleep(CYCLE_INTERVAL_SECONDS)
            continue

        summary = {}
        store = SightingStore()
        try:
            for camera in cameras:
                store_result = run_one_cycle(
                    camera=camera,
                    video_stream_client=_video_stream_client,
                    hls_data_dir=HLS_DATA_DIR,
                    detector=_detector,
                    embedder=_embedder,
                    store=store,
                )
                summary[camera.camera_id] = store_result.status
        finally:
            store.close()
        _last_cycle_summary = summary

        await asyncio.sleep(CYCLE_INTERVAL_SECONDS)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    global _video_stream_client, _detector, _embedder, _camera_cycle_task
    _video_stream_client = VideoStreamClient(base_url=VIDEO_STREAM_BASE_URL)
    _detector = VehicleDetector()
    _embedder = VehicleEmbedder(DEFAULT_EMBEDDER_MODEL)
    _camera_cycle_task = asyncio.create_task(_camera_cycle_loop())
    yield
    _camera_cycle_task.cancel()
    _video_stream_client.close()


app = FastAPI(
    title="Vehicle Ingest",
    description="Periodically feeds frames from video-stream's live camera feeds into vehicle-detection's existing detect/embed/store pipeline.",
    version="0.1.0",
    lifespan=_lifespan,
)


@app.get("/health")
def health():
    return {"status": "ok", "last_cycle": _last_cycle_summary}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_main.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "AI Registry/vehicle-ingest"
git add src/main.py tests/test_main.py
git commit -m "feat: add vehicle-ingest service entrypoint and camera cycle loop"
```

- [ ] **Step 6: Manual, real, end-to-end verification (not a unit test — a genuine live check)**

This step is the one that actually proves the whole chain works against
real infrastructure — every prior task's tests use fakes/synthetic
segments deliberately, for speed and determinism, matching this
project's own established testing conventions. This step is where that
gets checked against the real system.

Run:
```bash
# Terminal 1 -- confirm video-stream is running (it already should be,
# per the rest of this project's history)
curl -s http://127.0.0.1:8100/health

# Terminal 2 -- start vehicle-ingest for real
cd "AI Registry/vehicle-ingest"
source .venv/bin/activate
uvicorn src.main:app --port 8200
```

Wait ~30-60 seconds (long enough for at least one full camera cycle at
the default 20s interval, across however many cameras `GET /cameras`
returns), then:

```bash
curl -s http://127.0.0.1:8200/health | python3 -m json.tool
```

Expected: `"status": "ok"`, and `"last_cycle"` shows a real per-camera
status map (e.g. `{"9f260651-...": "saved", "eb687530-...": "stream_not_ready", ...}`)
— not an empty object, confirming the loop genuinely ran against real
cameras. Then confirm a real row landed:

```bash
# From vehicle-detection, using its own real DB connection pattern
cd "../vehicle-detection"
source .venv/bin/activate
python3 -c "
import sys, os
sys.path.insert(0, 'src')
from sighting_store import SightingStore
store = SightingStore()
cur = store._conn.cursor()
cur.execute('SELECT COUNT(*) FROM vehicle_sighting WHERE detected_at > now() - interval \'2 minutes\';')
print('sightings in the last 2 minutes:', cur.fetchone()[0])
store.close()
"
```

If this returns 0, that is a real, valid possible outcome too (not every
camera necessarily has a vehicle in frame at the exact moment sampled) —
the thing being verified here is that the cycle *ran* and reached the
pipeline without crashing, not that a vehicle was guaranteed to be
detected. Stop the service with Ctrl-C when done.

---

## Self-Review Notes (completed during writing, per this skill's process)

- **Spec coverage:** §2 (research/chosen approach) → Tasks 2 & 4 (local
  segment read + frame extraction, no fresh RTSP connection). §3
  architecture steps 1-6 → Task 3 (steps 1-2), Task 4 (step 3), Task 2
  (step 4), Task 5 (steps 5-6, wiring). §3.1 (standalone service) → Task
  6 (own FastAPI app, own `/health`). §3.2 (all cameras, 10-30s cadence)
  → Task 6's `_camera_cycle_loop` iterates every camera from
  `list_cameras()`, `CYCLE_INTERVAL_SECONDS` defaults to 20 (mid-range).
  §3.3 (no frame retention) → Task 5's `with tempfile.TemporaryDirectory()`
  block, explicitly asserted in Task 5's own test. §4 (models loaded once)
  → Task 6's `_lifespan` constructs `VehicleDetector`/`VehicleEmbedder`
  exactly once, passed into every `run_one_cycle` call, never
  reconstructed in the loop.
- **Placeholder scan:** no TODO/TBD/"handle appropriately" language found;
  every step has real, complete code.
- **Type consistency:** `StreamCamera` (Task 3) is the same dataclass
  imported and used in Task 5 and Task 6. `CycleResult.status` string
  values (`"saved"`, `"skipped_no_frame"`, `"skipped_pipeline_error"`,
  `"stream_not_ready"`) are used consistently in Task 5's implementation,
  its own tests, and Task 6's summary dict. `run_pipeline`'s real
  signature (confirmed directly from
  `vehicle-detection/src/pipeline.py` this session) matches exactly how
  Task 5 calls it.
