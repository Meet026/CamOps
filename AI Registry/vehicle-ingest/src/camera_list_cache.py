"""
A small, time-based cache so the 20s slow cycle (_camera_cycle_loop) and
the 3s motion-check loop (_motion_check_loop) share ONE fetch of the
camera list, instead of each independently calling GET /cameras on its
own schedule.

Real, measured problem this fixes: with two loops each calling
list_cameras() on video-stream, the resulting concurrent load (combined
with many real ffmpeg/YOLO worker threads competing for CPU at the same
time) caused GET /cameras to occasionally time out — confirmed directly
against the live service during manual testing, not a hypothetical
concern. There was never a real need for both loops to ask "what cameras
exist?" as often as the faster loop runs; the camera list itself only
changes when someone adds/removes a camera in the registry, which is far
rarer than either loop's interval.
"""
import time
from typing import Callable, TypeVar

T = TypeVar("T")


class CameraListCache:
    def __init__(self, fetch: Callable[[], T], ttl_seconds: float):
        self._fetch = fetch
        self._ttl_seconds = ttl_seconds
        self._cached_value: T | None = None
        self._fetched_at: float | None = None

    def get(self) -> T:
        """
        Returns the cached value if it's still within ttl_seconds of the
        last successful fetch; otherwise calls through to the real
        fetch function and caches the result.

        If a refresh attempt fails (the underlying fetch raises) and a
        previous good value exists, that stale-but-valid value is
        returned instead of propagating the error — a brief network
        blip refreshing the cache should not make every camera
        momentarily look like it vanished for every caller. The one
        exception is the very first call ever: with nothing cached yet,
        there is no stale value to fall back to, so the error must
        propagate and be visible, not be swallowed into a silently
        empty result.
        """
        now = time.monotonic()
        is_fresh = (
            self._fetched_at is not None and (now - self._fetched_at) < self._ttl_seconds
        )
        if is_fresh:
            return self._cached_value

        try:
            value = self._fetch()
        except Exception:
            if self._cached_value is not None:
                return self._cached_value
            raise

        self._cached_value = value
        self._fetched_at = now
        return value
