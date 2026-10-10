"""
The fast, frequent (every few seconds — see MOTION_DETECTION_INTERVAL_SECONDS
in src/main.py) counterpart to ingest_cycle.run_one_cycle's slower, fixed
20s cycle: checks whether a camera's latest frame actually changed enough
to be worth a real look, and only then calls into the same expensive
detect+embed+save pipeline run_one_cycle already uses. The slower cycle
keeps running unchanged as a fallback net (catches anything this faster,
cheaper check might miss), so nothing about today's behavior regresses —
this only adds an earlier, cheaper opportunity to catch a vehicle that
passed between two of the slower cycle's 20-second checks.

Deliberately reuses run_one_cycle's own segment-finding/frame-extraction
building blocks (find_newest_segment, extract_frame) and its exact
run_pipeline-loading mechanism, rather than duplicating that logic.
"""
import os
import tempfile
from dataclasses import dataclass

import cv2
import numpy as np

from src.ingest_cycle import run_pipeline  # reuses the same loaded function
from src.motion_detector import has_significant_motion
from src.newest_segment import find_newest_segment
from src.segment_frame import extract_frame, SegmentFrameError
from src.video_stream_client import StreamCamera, VideoStreamClientError


@dataclass
class MotionGatedCycleResult:
    # "saved" | "no_motion" | "no_previous_frame" | "skipped_no_frame" |
    # "skipped_pipeline_error" | "stream_not_ready"
    status: str
    detail: str
    # The frame actually read this cycle (as a BGR numpy array), for the
    # CALLER to keep and pass back in as `previous_frame` next cycle.
    # None only when no frame could be read at all (stream_not_ready /
    # skipped_no_frame) — there's nothing to hand back as a baseline.
    frame: np.ndarray | None


def run_motion_gated_cycle(
    camera: StreamCamera,
    video_stream_client,
    hls_data_dir: str,
    detector,
    embedder,
    store,
    previous_frame: np.ndarray | None,
) -> MotionGatedCycleResult:
    try:
        is_ready = video_stream_client.ensure_stream_running(camera.camera_id)
    except VideoStreamClientError as e:
        return MotionGatedCycleResult("stream_not_ready", f"video-stream error: {e.reason}", None)

    if not is_ready:
        return MotionGatedCycleResult(
            "stream_not_ready", "video-stream still starting this camera", None
        )

    segment_path = find_newest_segment(hls_data_dir, camera.camera_id)
    if segment_path is None:
        return MotionGatedCycleResult("skipped_no_frame", "no segment file written yet", None)

    with tempfile.TemporaryDirectory() as tmpdir:
        frame_path = os.path.join(tmpdir, "frame.jpg")
        try:
            extract_frame(segment_path, frame_path)
        except SegmentFrameError as e:
            return MotionGatedCycleResult(
                "skipped_no_frame", f"frame extraction failed: {e.reason}", None
            )

        current_frame = cv2.imread(frame_path)
        if current_frame is None:
            # A real, if rare, failure mode: ffmpeg wrote a file but it
            # isn't a decodable image (truncated write, race with
            # video-stream rotating the segment mid-read). Treat the
            # same as "couldn't get a usable frame" rather than crash.
            return MotionGatedCycleResult(
                "skipped_no_frame", "extracted frame could not be decoded", None
            )

        if previous_frame is None:
            # Nothing to compare against yet — this frame itself becomes
            # the baseline for next cycle. Deliberately NOT treated as
            # "motion" (a camera's very first check must never
            # automatically trigger the expensive pipeline just because
            # there was no prior frame to compare it to).
            return MotionGatedCycleResult(
                "no_previous_frame", "no prior frame to compare against yet", current_frame
            )

        try:
            is_motion = has_significant_motion(previous_frame, current_frame)
        except ValueError as e:
            # Frame shape changed (e.g. stream reconfigured resolution)
            # — treat this new frame as a fresh baseline rather than
            # erroring the whole cycle out.
            return MotionGatedCycleResult(
                "no_previous_frame", f"frame shape changed, resetting baseline: {e}", current_frame
            )

        if not is_motion:
            return MotionGatedCycleResult("no_motion", "no significant change since last check", current_frame)

        try:
            result = run_pipeline([frame_path], camera.camera_id, detector, embedder, store)
        except Exception as e:  # noqa: BLE001 — a bad frame must never kill the whole ingest loop
            return MotionGatedCycleResult(
                "skipped_pipeline_error", f"pipeline raised: {e}", current_frame
            )
        # frame_path is deleted automatically here, on `with` block exit
        # — no raw-frame retention, matching run_one_cycle's own rule.

    if result.saved_sighting_ids:
        return MotionGatedCycleResult(
            "saved", f"{len(result.saved_sighting_ids)} sighting(s) saved", current_frame
        )
    return MotionGatedCycleResult(
        "skipped_pipeline_error", f"pipeline skipped: {result.skipped}", current_frame
    )
