"""
Codec handling in StreamManager.ensure_started.

Per the gateway's Integrator's Guide (sentinel.gujarat.gov.in/resource),
cameras mix codecs — confirmed with ffprobe: cam06/cam12/cam17 are HEVC,
cam07/cam09/cam24 are H.264. Chromium has no HEVC decoder in MSE, so an
HEVC source passed through with `-c:v copy` fails in the browser with an
unrecoverable decode error. HEVC sources are therefore transcoded to
H.264; H.264 sources keep the fast copy path.

The probe that decides this is slow on this gateway (3-10s+, sometimes
timing out), so it must never hold up a request: ensure_started kicks it
off in the background and returns, and the next poll starts ffmpeg once
the codec is known. Clients already poll (503 + Retry-After), so these
tests drive ensure_started the same way.
"""
import asyncio
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import stream_manager  # noqa: E402


class _FakeProcess:
    def poll(self):
        return None

    def terminate(self):
        pass

    def wait(self, timeout=None):
        return 0


@pytest.fixture
def commands(monkeypatch):
    captured = []

    def _fake_popen(cmd, **kwargs):
        captured.append(cmd)
        return _FakeProcess()

    monkeypatch.setattr(stream_manager.subprocess, "Popen", _fake_popen)
    return captured


async def _poll_until_started(manager, camera_id, url, max_polls=200):
    for _ in range(max_polls):
        await manager.ensure_started(camera_id, url)
        if manager.is_running(camera_id):
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"{camera_id} never started")


def test_hevc_source_is_transcoded_to_h264(monkeypatch, tmp_path, commands):
    monkeypatch.setattr(stream_manager, "_probe_video_codec", lambda url: "hevc")
    manager = stream_manager.StreamManager(data_dir=str(tmp_path))

    asyncio.run(_poll_until_started(manager, "cam-hevc", "rtsp://example.invalid/stream/cam06"))

    assert "libx264" in commands[0]
    assert "copy" not in commands[0]


def test_h264_source_is_still_stream_copied(monkeypatch, tmp_path, commands):
    monkeypatch.setattr(stream_manager, "_probe_video_codec", lambda url: "h264")
    manager = stream_manager.StreamManager(data_dir=str(tmp_path))

    asyncio.run(_poll_until_started(manager, "cam-h264", "rtsp://example.invalid/stream/cam07"))

    assert "copy" in commands[0]
    assert "libx264" not in commands[0]


def test_first_request_returns_immediately_while_codec_probe_is_slow(monkeypatch, tmp_path, commands):
    # Real regression: the request waited for the probe, measured at 12s
    # per playlist request live — past vehicle-ingest's 10s client
    # timeout (REQUEST_FAILED), and slow enough per camera that the idle
    # sweeper stopped streams before their first segment arrived.
    def _slow_probe(url):
        time.sleep(0.5)
        return "h264"

    monkeypatch.setattr(stream_manager, "_probe_video_codec", _slow_probe)
    manager = stream_manager.StreamManager(data_dir=str(tmp_path))

    async def _run():
        start = time.monotonic()
        await manager.ensure_started("cam-x", "rtsp://example.invalid/x")
        elapsed = time.monotonic() - start
        await _poll_until_started(manager, "cam-x", "rtsp://example.invalid/x")
        return elapsed

    elapsed = asyncio.run(_run())

    assert elapsed < 0.1, f"request waited {elapsed:.2f}s for the probe"
    assert len(commands) == 1


def test_slow_codec_probe_does_not_block_the_event_loop(monkeypatch, tmp_path, commands):
    # Real regression: a blocking ffprobe inside async ensure_started froze
    # the whole service — a live GET /health measured 9.5s.
    def _slow_probe(url):
        time.sleep(0.3)
        return "h264"

    monkeypatch.setattr(stream_manager, "_probe_video_codec", _slow_probe)
    manager = stream_manager.StreamManager(data_dir=str(tmp_path))

    async def _other_work():
        delays = []
        for _ in range(8):
            start = time.monotonic()
            await asyncio.sleep(0.02)
            delays.append(time.monotonic() - start)
        return delays

    async def _run():
        start_task = asyncio.create_task(
            _poll_until_started(manager, "cam-x", "rtsp://example.invalid/x")
        )
        delays = await _other_work()
        await start_task
        return delays

    delays = asyncio.run(_run())
    assert max(delays) < 0.1, f"event loop was blocked -- max delay was {max(delays):.3f}s"


def test_concurrent_requests_probe_and_start_only_once(monkeypatch, tmp_path, commands):
    probe_calls = []

    def _probe(url):
        probe_calls.append(url)
        time.sleep(0.1)
        return "h264"

    monkeypatch.setattr(stream_manager, "_probe_video_codec", _probe)
    manager = stream_manager.StreamManager(data_dir=str(tmp_path))

    async def _run():
        await asyncio.gather(*[
            _poll_until_started(manager, "cam-x", "rtsp://example.invalid/x") for _ in range(10)
        ])

    asyncio.run(_run())

    assert len(probe_calls) == 1
    assert len(commands) == 1


def test_codec_is_probed_once_per_camera_even_across_stream_restarts(monkeypatch, tmp_path, commands):
    # The idle sweeper stops streams nobody touched recently; a camera's
    # codec doesn't change between restarts, so re-probing is wasted time.
    probe_calls = []

    def _probe(url):
        probe_calls.append(url)
        return "hevc"

    monkeypatch.setattr(stream_manager, "_probe_video_codec", _probe)
    manager = stream_manager.StreamManager(data_dir=str(tmp_path))

    async def _run():
        await _poll_until_started(manager, "cam-hevc", "rtsp://example.invalid/stream/cam06")
        await manager.stop("cam-hevc")
        await _poll_until_started(manager, "cam-hevc", "rtsp://example.invalid/stream/cam06")

    asyncio.run(_run())

    assert len(probe_calls) == 1
    assert len(commands) == 2
    assert all("libx264" in cmd for cmd in commands)


def test_failed_probe_falls_back_to_copy_and_is_not_retried_during_cooldown(monkeypatch, tmp_path, commands):
    # A camera whose probe fails (e.g. the unreachable live.corp8.cloud
    # gateway) must not pay the probe timeout again on every visit.
    probe_calls = []

    def _probe(url):
        probe_calls.append(url)
        return None

    monkeypatch.setattr(stream_manager, "_probe_video_codec", _probe)
    manager = stream_manager.StreamManager(data_dir=str(tmp_path))

    async def _run():
        await _poll_until_started(manager, "cam-12", "rtsp://example.invalid/stream/cam12")
        await manager.stop("cam-12")
        await _poll_until_started(manager, "cam-12", "rtsp://example.invalid/stream/cam12")

    asyncio.run(_run())

    assert len(probe_calls) == 1
    assert all("copy" in cmd for cmd in commands)


def test_failed_probe_is_retried_after_cooldown(monkeypatch, tmp_path, commands):
    # A None result means the probe failed, not that the camera has no
    # codec — caching it forever would pin an HEVC camera to the broken
    # copy path.
    results = iter([None, "hevc"])
    monkeypatch.setattr(stream_manager, "_probe_video_codec", lambda url: next(results))
    monkeypatch.setattr(stream_manager, "CODEC_PROBE_RETRY_SECONDS", 0.0)
    manager = stream_manager.StreamManager(data_dir=str(tmp_path))

    async def _run():
        await _poll_until_started(manager, "cam-12", "rtsp://example.invalid/stream/cam12")
        await manager.stop("cam-12")
        await _poll_until_started(manager, "cam-12", "rtsp://example.invalid/stream/cam12")

    asyncio.run(_run())

    assert "copy" in commands[0]
    assert "libx264" in commands[1]
