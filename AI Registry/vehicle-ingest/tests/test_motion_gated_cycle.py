"""
Tests for src/motion_gated_cycle.py — the fast (every few seconds) loop
that only decides "is this frame worth a real look", using the cheap
motion-diff check, and only calls into the existing, expensive
detect+embed+save pipeline (run_one_cycle's own machinery) when real
motion was found. Reuses run_one_cycle's actual frame-fetch step rather
than duplicating segment-finding/ffmpeg logic.
"""
import os
import tempfile
from unittest.mock import MagicMock

import numpy as np

from src.motion_gated_cycle import run_motion_gated_cycle, MotionGatedCycleResult
from src.video_stream_client import StreamCamera


def _real_segment(path: str, color: str = "gray") -> None:
    import subprocess
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"color=c={color}:size=320x240:rate=5:duration=1",
            "-c:v", "libx264", "-f", "mpegts", path,
        ],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def _make_camera_with_segment(tmpdir, segment_name="0.ts", color="gray"):
    camera = StreamCamera(camera_id="cam-1", name="Test", stream_path="rtsp://x")
    camera_dir = os.path.join(tmpdir, "cam-1")
    os.makedirs(camera_dir, exist_ok=True)
    _real_segment(os.path.join(camera_dir, segment_name), color=color)
    return camera


def test_skips_pipeline_when_no_previous_frame_exists_yet(monkeypatch):
    # The very first check for a camera has nothing to compare against --
    # this must never crash, and must never call the expensive pipeline
    # on the strength of "no prior frame" alone (that would defeat the
    # whole point: every camera's first-ever check would always run the
    # full pipeline). It should just record this frame as the new
    # baseline and report "no previous frame to compare."
    with tempfile.TemporaryDirectory() as tmpdir:
        camera = _make_camera_with_segment(tmpdir)
        fake_client = MagicMock()
        fake_client.ensure_stream_running.return_value = True

        pipeline_called = []
        monkeypatch.setattr(
            "src.motion_gated_cycle.run_pipeline",
            lambda *a, **k: pipeline_called.append(True),
        )

        result = run_motion_gated_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
            previous_frame=None,
        )

        assert isinstance(result, MotionGatedCycleResult)
        assert result.status == "no_previous_frame"
        assert pipeline_called == []
        # A real frame array must be returned so the CALLER can store it
        # as next cycle's baseline -- this function is pure w.r.t. the
        # caller's state, it never mutates/remembers anything itself.
        assert result.frame is not None
        assert isinstance(result.frame, np.ndarray)


def test_skips_pipeline_when_frame_is_identical_to_previous(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        camera = _make_camera_with_segment(tmpdir, color="gray")
        fake_client = MagicMock()
        fake_client.ensure_stream_running.return_value = True

        pipeline_called = []
        monkeypatch.setattr(
            "src.motion_gated_cycle.run_pipeline",
            lambda *a, **k: pipeline_called.append(True),
        )

        # First call establishes the baseline frame.
        first = run_motion_gated_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
            previous_frame=None,
        )

        # Second call compares against that exact same baseline frame
        # (same solid-color segment) -- no real motion, pipeline must
        # not be called.
        second = run_motion_gated_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
            previous_frame=first.frame,
        )

        assert second.status == "no_motion"
        assert pipeline_called == []


def test_runs_pipeline_when_frame_differs_significantly(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        camera = _make_camera_with_segment(tmpdir, segment_name="0.ts", color="black")
        fake_client = MagicMock()
        fake_client.ensure_stream_running.return_value = True

        fake_pipeline_result = MagicMock()
        fake_pipeline_result.saved_sighting_ids = ["sighting-1"]
        fake_pipeline_result.skipped = []
        pipeline_calls = []

        def fake_run_pipeline(image_paths, camera_id, detector, embedder, store, plate_reader=None):
            pipeline_calls.append(image_paths)
            assert os.path.exists(image_paths[0])  # frame exists WHEN pipeline runs
            return fake_pipeline_result

        monkeypatch.setattr("src.motion_gated_cycle.run_pipeline", fake_run_pipeline)

        first = run_motion_gated_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
            previous_frame=None,
        )

        # Replace the segment with a drastically different color before
        # the second check -- a real, visible change the motion-diff
        # must catch.
        _real_segment(os.path.join(tmpdir, "cam-1", "1.ts"), color="white")

        second = run_motion_gated_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
            previous_frame=first.frame,
        )

        assert second.status == "saved"
        assert len(pipeline_calls) == 1
        # The temp frame file handed to the pipeline must be cleaned up
        # immediately after -- same no-raw-frame-retention rule as
        # run_one_cycle.
        assert not os.path.exists(pipeline_calls[0][0])


def test_returns_stream_not_ready_without_touching_motion_detection(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        camera = StreamCamera(camera_id="cam-1", name="Test", stream_path="rtsp://x")
        fake_client = MagicMock()
        fake_client.ensure_stream_running.return_value = False

        pipeline_called = []
        monkeypatch.setattr(
            "src.motion_gated_cycle.run_pipeline",
            lambda *a, **k: pipeline_called.append(True),
        )

        result = run_motion_gated_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
            previous_frame=None,
        )

        assert result.status == "stream_not_ready"
        assert pipeline_called == []
        assert result.frame is None


def test_passes_plate_reader_through_to_pipeline(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        camera = _make_camera_with_segment(tmpdir, segment_name="0.ts", color="black")
        fake_client = MagicMock()
        fake_client.ensure_stream_running.return_value = True
        fake_pipeline_result = MagicMock()
        fake_pipeline_result.saved_sighting_ids = ["sighting-1"]
        fake_pipeline_result.skipped = []
        received = {}

        def fake_run_pipeline(image_paths, camera_id, detector, embedder, store, plate_reader=None):
            received["plate_reader"] = plate_reader
            return fake_pipeline_result

        monkeypatch.setattr("src.motion_gated_cycle.run_pipeline", fake_run_pipeline)
        sentinel_reader = object()

        first = run_motion_gated_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
            previous_frame=None, plate_reader=sentinel_reader,
        )
        _real_segment(os.path.join(tmpdir, "cam-1", "1.ts"), color="white")
        second = run_motion_gated_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
            previous_frame=first.frame, plate_reader=sentinel_reader,
        )

        assert second.status == "saved"
        assert received["plate_reader"] is sentinel_reader


def test_motion_cycle_hands_saved_plate_reads_to_the_wanted_alerter(monkeypatch):
    calls = []

    class _Alerter:
        def handle(self, camera_id, reads):
            calls.append((camera_id, list(reads)))
            return 1

    with tempfile.TemporaryDirectory() as tmpdir:
        camera = _make_camera_with_segment(tmpdir, segment_name="0.ts", color="black")
        fake_client = MagicMock()
        fake_client.ensure_stream_running.return_value = True
        result = MagicMock()
        result.saved_sighting_ids = ["s-1"]
        result.saved_plate_reads = [("s-1", "GJ01AB1234", 0.9)]
        result.skipped = []
        monkeypatch.setattr("src.motion_gated_cycle.run_pipeline", lambda *a, **k: result)

        first = run_motion_gated_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
            previous_frame=None, wanted_alerter=_Alerter(),
        )
        _real_segment(os.path.join(tmpdir, "cam-1", "1.ts"), color="white")
        second = run_motion_gated_cycle(
            camera=camera, video_stream_client=fake_client, hls_data_dir=tmpdir,
            detector=MagicMock(), embedder=MagicMock(), store=MagicMock(),
            previous_frame=first.frame, wanted_alerter=_Alerter(),
        )

    assert second.status == "saved"
    assert calls == [("cam-1", [("s-1", "GJ01AB1234", 0.9)])]
