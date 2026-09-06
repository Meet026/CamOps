"""
Runs one full ingest cycle for one camera: ensure video-stream has it
running, find its newest segment, extract one frame, hand it to
vehicle-detection's existing run_pipeline(), delete the frame. See this
project's spec (2026-09-05-vehicle-ingest-design.md) Section 3 for the
full architecture this implements step by step.
"""
import importlib.util
import os
import sys
import tempfile
from dataclasses import dataclass

from src.newest_segment import find_newest_segment
from src.segment_frame import extract_frame, SegmentFrameError
from src.video_stream_client import StreamCamera, VideoStreamClientError


def _load_run_pipeline():
    """
    Loads vehicle-detection's run_pipeline() by exact file path rather
    than via sys.path + `import pipeline`. Real, confirmed bug that
    forced this: both vehicle-detection and this project name their
    source directory `src`. This module (vehicle-ingest's own
    `src.ingest_cycle`) is imported first, so Python caches `src` in
    sys.modules as THIS project's package. vehicle-detection's
    pipeline.py then does `from src.embedder import ...` (expecting ITS
    sibling vehicle-reid/src to resolve) -- Python reuses the
    already-cached, wrong `src` module instead of re-resolving it, and
    the import fails with "No module named 'src.embedder'". Loading
    pipeline.py by explicit file path alone does NOT fix this on its
    own, confirmed directly: pipeline.py's own body still runs `from
    src.embedder import ...` at exec time, which still finds the stale
    cached entry. The real fix: temporarily evict vehicle-ingest's own
    `src` entry from sys.modules for the duration of pipeline.py's
    exec_module() call, so its internal imports re-resolve `src` fresh
    against vehicle-reid's path -- then restore it immediately after, so
    every OTHER module in this project keeps importing its own `src`
    normally.
    """
    detection_src_dir = os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-detection", "src")
    reid_src_dir = os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-reid", "src")
    for path in (detection_src_dir, reid_src_dir):
        if path not in sys.path:
            sys.path.insert(0, path)

    pipeline_path = os.path.join(detection_src_dir, "pipeline.py")
    spec = importlib.util.spec_from_file_location("vehicle_detection_pipeline", pipeline_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["vehicle_detection_pipeline"] = module

    this_projects_src = sys.modules.pop("src", None)
    try:
        spec.loader.exec_module(module)
    finally:
        # Also drop whatever "src" pipeline.py's own exec left behind
        # (vehicle-reid's src package) before restoring ours, so later
        # imports of vehicle-ingest's own src.* submodules aren't
        # resolved against the wrong cached package either.
        sys.modules.pop("src", None)
        if this_projects_src is not None:
            sys.modules["src"] = this_projects_src

    return module.run_pipeline


run_pipeline = _load_run_pipeline()


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
