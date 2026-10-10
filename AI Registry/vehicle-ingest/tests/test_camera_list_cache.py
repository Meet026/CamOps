"""
Tests for src/camera_list_cache.py — a small time-based cache so the
20s slow cycle and the 3s motion-check loop share ONE fetch of the
camera list instead of each independently calling GET /cameras on its
own schedule. Real, measured problem this fixes: with two loops each
calling list_cameras() on video-stream, the resulting concurrent load
(combined with many real ffmpeg/YOLO worker threads competing for CPU)
caused GET /cameras to occasionally time out — confirmed directly
against the live service, not a hypothetical concern.
"""
import time
from unittest.mock import MagicMock

from src.camera_list_cache import CameraListCache


def test_first_call_fetches_from_the_source():
    fetch = MagicMock(return_value=["cam-1", "cam-2"])
    cache = CameraListCache(fetch=fetch, ttl_seconds=20)

    result = cache.get()

    assert result == ["cam-1", "cam-2"]
    assert fetch.call_count == 1


def test_second_call_within_ttl_reuses_cached_value_without_refetching():
    fetch = MagicMock(return_value=["cam-1", "cam-2"])
    cache = CameraListCache(fetch=fetch, ttl_seconds=20)

    cache.get()
    cache.get()
    cache.get()

    # Three .get() calls, well within the 20s TTL -- only the FIRST one
    # should have actually hit the real fetch function. This is the
    # entire point: both loops calling .get() on the same cache object
    # must not double the real network traffic.
    assert fetch.call_count == 1


def test_call_after_ttl_expires_refetches(monkeypatch):
    fetch = MagicMock(side_effect=[["cam-1"], ["cam-1", "cam-2"]])
    fake_now = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: fake_now[0])

    cache = CameraListCache(fetch=fetch, ttl_seconds=20)

    first = cache.get()
    fake_now[0] += 21  # past the 20s TTL
    second = cache.get()

    assert first == ["cam-1"]
    assert second == ["cam-1", "cam-2"]
    assert fetch.call_count == 2


def test_a_failed_refetch_does_not_wipe_the_last_good_value():
    # Real, important behavior: if video-stream is briefly unreachable
    # exactly when the cache tries to refresh, both ingest loops should
    # keep working off the last known-good camera list rather than
    # suddenly seeing "no cameras at all" because one refresh attempt
    # failed.
    fetch = MagicMock(side_effect=[["cam-1", "cam-2"], RuntimeError("network blip")])
    cache = CameraListCache(fetch=fetch, ttl_seconds=0)  # TTL 0 -- always "expired"

    first = cache.get()
    second = cache.get()  # the underlying fetch raises this time

    assert first == ["cam-1", "cam-2"]
    assert second == ["cam-1", "cam-2"]  # stale-but-valid, not an empty list or a crash


def test_a_failed_first_ever_fetch_still_raises():
    # There's no "last good value" to fall back to on the very first
    # call -- this must surface as a real, visible error, not silently
    # return an empty list and let every camera look like it vanished.
    fetch = MagicMock(side_effect=RuntimeError("network blip"))
    cache = CameraListCache(fetch=fetch, ttl_seconds=20)

    try:
        cache.get()
        assert False, "expected RuntimeError to propagate"
    except RuntimeError:
        pass
