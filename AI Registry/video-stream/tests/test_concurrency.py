"""
Tests the real, confirmed bug this session: _ensure_stream_running (used
by GET /stream/{camera_id}/index.m3u8) called _get_camera_lookup() and
lookup.get_stream_path() -- both blocking, synchronous calls
(CameraLookup.__init__ does a real psycopg2.connect()) -- directly, with
no await, inside an `async def` handler. Confirmed directly against the
live service: once vehicle-ingest's motion-check loop started requesting
~20 cameras' streams concurrently every few seconds, the WHOLE service
(including unrelated requests like GET /health) became unresponsive for
over 20 seconds, recovering only after a full process restart.

These tests call the real async handler function directly (NOT through
FastAPI's TestClient, which runs requests through its own thread/portal
machinery and does not reproduce this failure mode -- confirmed directly
during this session's own investigation) so they exercise the real
property that broke: does a slow, blocking-shaped lookup call stall
*other* coroutines scheduled on the same event loop while it's in
flight.
"""
import asyncio
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import api as api_module  # noqa: E402


class _SlowBlockingLookup:
    """Stands in for a real CameraLookup whose constructor/queries hit a
    genuinely slow/contended database connection -- a blocking
    time.sleep() here has the exact same effect on the event loop as a
    slow psycopg2 call would, which is the only property these tests
    need to exercise."""

    def __init__(self, delay_seconds: float):
        self._delay_seconds = delay_seconds

    def get_stream_path(self, camera_id):
        time.sleep(self._delay_seconds)
        return None  # no stream_path -> a clean 404, not a real ffmpeg start


@pytest.fixture(autouse=True)
def _reset_patches(monkeypatch):
    yield
    # Nothing to explicitly reset -- monkeypatch's own fixture teardown
    # already reverts _get_camera_lookup after each test.


async def _other_event_loop_work() -> list[float]:
    """Repeatedly yields back to the event loop and records how long
    each yield actually took -- if something else has the loop blocked,
    these gaps balloon far past the requested sleep duration."""
    delays = []
    for _ in range(8):
        start = time.monotonic()
        await asyncio.sleep(0.02)
        delays.append(time.monotonic() - start)
    return delays


def test_ensure_stream_running_does_not_block_other_coroutines(monkeypatch):
    monkeypatch.setattr(
        api_module, "_get_camera_lookup", lambda: _SlowBlockingLookup(delay_seconds=0.3)
    )

    async def _run():
        slow_call = asyncio.create_task(api_module._ensure_stream_running("cam-x"))
        other_work = asyncio.create_task(_other_event_loop_work())

        delays = await other_work
        try:
            await slow_call
        except Exception:
            pass  # expected: 404 (no stream_path) raised as an HTTPException

        return delays

    delays = asyncio.run(_run())

    # Each 0.02s sleep should take close to 0.02s if the event loop is
    # genuinely free -- the real bug would inflate these toward 0.3s
    # (the slow lookup's own duration), since nothing else could run
    # until it finished.
    assert max(delays) < 0.1, f"event loop was blocked -- max delay was {max(delays):.3f}s"


def test_many_concurrent_ensure_stream_running_calls_overlap(monkeypatch):
    """
    Directly mirrors the real failure scenario: ~20 cameras' worth of
    concurrent stream-start requests, same as vehicle-ingest's
    motion-check loop sends every few seconds. Proves they genuinely run
    concurrently (fixed) rather than serializing one after another
    behind a blocked event loop (the bug).
    """
    in_flight = {"count": 0, "max_concurrent": 0}

    class _TrackedSlowLookup(_SlowBlockingLookup):
        def get_stream_path(self, camera_id):
            in_flight["count"] += 1
            in_flight["max_concurrent"] = max(in_flight["max_concurrent"], in_flight["count"])
            result = super().get_stream_path(camera_id)
            in_flight["count"] -= 1
            return result

    monkeypatch.setattr(
        api_module, "_get_camera_lookup", lambda: _TrackedSlowLookup(delay_seconds=0.2)
    )

    async def _run():
        tasks = [
            asyncio.create_task(api_module._ensure_stream_running(f"cam-{i}"))
            for i in range(20)
        ]
        for t in tasks:
            try:
                await t
            except Exception:
                pass

    start = time.monotonic()
    asyncio.run(_run())
    elapsed = time.monotonic() - start

    # Fixed: 20 lookups, each taking 0.2s, run concurrently -- total
    # wall-clock stays close to ~0.2s, not ~20 x 0.2s = 4s serialized.
    assert elapsed < 1.0, f"calls were not concurrent -- took {elapsed:.2f}s total"
    assert in_flight["max_concurrent"] > 1
