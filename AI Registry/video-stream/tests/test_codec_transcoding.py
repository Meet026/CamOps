"""
Tests a real, confirmed bug: ensure_started() always runs ffmpeg with
`-c:v copy` (stream passthrough, no re-encoding), regardless of the
source camera's codec. Per the hackathon gateway's own published
Integrator's Guide (sentinel.gujarat.gov.in/resource), cameras use mixed
codecs -- confirmed directly with ffprobe against real cameras on this
gateway: cam06, cam12, cam17 are HEVC/H.265, while cam07, cam09, cam24
are H.264. Most Chromium browsers have no HEVC decoder wired into MSE,
so an HEVC camera passed through untouched fails in the browser with a
genuine, unrecoverable decode error (confirmed live: Chrome's
VaapiVideoDecoder rejects the stream with PIPELINE_ERROR_DECODE) --
not a transient network/buffering issue, and not fixable by retrying.

Fix: probe the source codec before starting ffmpeg, and transcode
(`-c:v libx264`) only when the source is HEVC, leaving the existing
fast copy path untouched for H.264 cameras.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import stream_manager  # noqa: E402


def test_ensure_started_transcodes_hevc_source_to_h264(monkeypatch, tmp_path):
    monkeypatch.setattr(stream_manager, "_probe_video_codec", lambda rtsp_url: "hevc")

    captured_cmd = {}

    class _FakeProcess:
        def poll(self):
            return None

    def _fake_popen(cmd, **kwargs):
        captured_cmd["cmd"] = cmd
        return _FakeProcess()

    monkeypatch.setattr(stream_manager.subprocess, "Popen", _fake_popen)

    manager = stream_manager.StreamManager(data_dir=str(tmp_path))

    import asyncio

    asyncio.run(manager.ensure_started("cam-hevc", "rtsp://example.invalid/stream/cam06"))

    cmd = captured_cmd["cmd"]
    assert "copy" not in cmd, f"HEVC source should not be stream-copied: {cmd}"
    assert "libx264" in cmd, f"HEVC source should be transcoded to H.264: {cmd}"


def test_ensure_started_still_copies_h264_source(monkeypatch, tmp_path):
    """Confirms the fix doesn't regress the existing fast path for
    cameras that are already browser-compatible H.264."""
    monkeypatch.setattr(stream_manager, "_probe_video_codec", lambda rtsp_url: "h264")

    captured_cmd = {}

    class _FakeProcess:
        def poll(self):
            return None

    def _fake_popen(cmd, **kwargs):
        captured_cmd["cmd"] = cmd
        return _FakeProcess()

    monkeypatch.setattr(stream_manager.subprocess, "Popen", _fake_popen)

    manager = stream_manager.StreamManager(data_dir=str(tmp_path))

    import asyncio

    asyncio.run(manager.ensure_started("cam-h264", "rtsp://example.invalid/stream/cam07"))

    cmd = captured_cmd["cmd"]
    assert "copy" in cmd, f"H.264 source should still be stream-copied: {cmd}"
    assert "libx264" not in cmd, f"H.264 source should not be transcoded: {cmd}"
