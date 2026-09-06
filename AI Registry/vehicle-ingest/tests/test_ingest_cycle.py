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
