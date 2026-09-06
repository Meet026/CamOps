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
