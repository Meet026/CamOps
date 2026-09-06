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
