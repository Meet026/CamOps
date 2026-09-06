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
