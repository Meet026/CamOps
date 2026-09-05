"""
Manages one ffmpeg subprocess per actively-watched camera: starts it
on demand (the first time a camera's HLS playlist or segment is
requested), tracks when it was last accessed, and stops + cleans up
any camera nobody has requested in a while.

Real, documented ffmpeg behavior relied on here (not assumed — see
AI Registry/video-stream/README.md for the sourcing):
- The HLS muxer only writes to real files (a .m3u8 playlist + numbered
  .ts segments) — there is no in-memory output mode, so a per-camera
  directory on disk is the standard, not a workaround.
- `-hls_flags delete_segments` makes ffmpeg delete old segments itself
  as new ones are written — this module does NOT implement its own
  segment-deletion logic, only whole-directory cleanup once a camera's
  stream is stopped entirely.
- `-hls_flags temp_file` (confirmed via `ffmpeg -h muxer=hls`: "write
  segment and playlist to temporary file and rename when complete") —
  without it, ffmpeg writes each segment straight to its final filename,
  so a request landing while a segment is still being flushed to disk
  can read a genuinely truncated .ts file. Real, observed symptom: a
  browser rendering visible video corruption (block artifacts/tearing)
  mid-stream rather than a clean frame, traced to api.py's get_segment
  serving whatever bytes exist on disk at request time with no
  completeness check. temp_file fixes this at the source — a segment
  only appears under its real name once ffmpeg has fully written it, so
  a request can never observe a partial file.
"""
import asyncio
import os
import shutil
import time
import urllib.parse

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "hls")


def _load_local_env() -> None:
    """
    Loads AI Registry/video-stream/.env into os.environ, if present —
    the same manual, no-new-dependency approach camera_lookup.py already
    uses for model1-service/.env (this project keeps dependencies
    deliberately minimal; see docs/PRD.md). Only sets a variable if it
    isn't already in the real process environment, so an explicit
    `export FOO=bar` before launching uvicorn still wins over the file.
    """
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip()


_load_local_env()

# The hackathon's shared RTSP gateway started requiring per-connection
# credentials (confirmed for real: a bare stream_path now gets a genuine
# 401 Unauthorized from the gateway itself, verified directly with
# ffmpeg, independent of this app). Per the gateway's own published
# Integrator's Guide, the fix is a registered email + access password
# embedded in the URL as userinfo (rtsp://email:password@host:port/...),
# with the email's "@" percent-encoded (RFC 3986 — a raw "@" inside the
# userinfo segment would be parsed as the userinfo/host separator, not
# part of the email). These live only here, as environment variables —
# never in the camera table's stream_path column, and never sent to the
# frontend; see camera_lookup.py and api.py for why the DB stays a bare,
# credential-free URL (a single set of gateway credentials, not one per
# camera, matching how the gateway itself hands them out — one login per
# integrator, not per camera).
#
# Known, accepted exposure: ffmpeg's RTSP demuxer has no separate
# credential flags (confirmed via `ffmpeg -h demuxer=rtsp` — only
# userinfo-in-URL is supported), so the authenticated URL necessarily
# appears in this process's argv, which means the password is visible to
# anything reading `ps aux`/`/proc/<pid>/cmdline` on this machine. Not
# fixable at the ffmpeg-invocation layer with this tool. Acceptable for
# this single-user hackathon dev box; would need revisiting (e.g. a
# wrapper reading the URL from an fd/file instead of argv) before running
# on any shared or multi-tenant host.
RTSP_GATEWAY_EMAIL = os.environ.get("VIDEO_STREAM_RTSP_EMAIL")
RTSP_GATEWAY_PASSWORD = os.environ.get("VIDEO_STREAM_RTSP_PASSWORD")


def _with_rtsp_credentials(rtsp_url: str) -> str:
    """
    Injects the gateway's registered email/password into a bare
    rtsp:// URL as userinfo, if configured. Returns the URL unchanged
    when no credentials are configured (e.g. local dev against a gateway
    that doesn't require auth) or when the URL already carries userinfo
    (never override a stream_path that already specifies its own
    credentials).
    """
    if not RTSP_GATEWAY_EMAIL or not RTSP_GATEWAY_PASSWORD:
        return rtsp_url

    parsed = urllib.parse.urlparse(rtsp_url)
    if parsed.username or parsed.password:
        return rtsp_url

    encoded_email = urllib.parse.quote(RTSP_GATEWAY_EMAIL, safe="")
    netloc = f"{encoded_email}:{RTSP_GATEWAY_PASSWORD}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return urllib.parse.urlunparse(parsed._replace(netloc=netloc))

# How long a camera's process stays running with nobody requesting its
# playlist/segments before the idle sweep kills it. HLS players poll the
# playlist every ~segment-duration seconds by nature of the protocol, so
# normal viewing naturally keeps refreshing this — no separate client
# heartbeat is needed.
#
# Real, measured constraint this default accounts for: against the
# hackathon's actual RTSP gateway, ffmpeg's stream-copy (no re-encoding
# at all) was observed running at roughly 0.24x real-time — a raw
# 1920x1080 feed took close to a full minute to produce its first
# HLS segment, not the few seconds a fast connection would suggest.
# Confirmed via `top` that this machine's CPU was ~96% idle throughout
# — the bottleneck is network throughput to the shared gateway, not
# local compute. The default here is set comfortably above that
# measured worst case so a camera doesn't get killed by the idle sweep
# while its very first segment is still arriving.
IDLE_TIMEOUT_SECONDS = float(os.environ.get("VIDEO_STREAM_IDLE_TIMEOUT", "90"))
SWEEP_INTERVAL_SECONDS = float(os.environ.get("VIDEO_STREAM_SWEEP_INTERVAL", "15"))

# Deliberately no server-side "wait for first segment" timeout here.
# ensure_started() starts ffmpeg and returns immediately; the client
# polls the playlist endpoint and gets a 503 + Retry-After until the
# first segment lands (confirmed for real to take up to ~50s on this
# network — see api.py's get_playlist). Blocking a request for that
# long would tie up a connection for no benefit over a client retry
# loop, which the frontend needs anyway to show a "connecting" state.

# Segment duration and rolling window size — small values keep live
# latency low; `delete_segments` keeps only ~list_size+1 segments on
# disk at any time regardless of these exact numbers.
HLS_SEGMENT_SECONDS = "2"
HLS_LIST_SIZE = "4"


class StreamManagerError(Exception):
    def __init__(self, reason: str, message: str = ""):
        self.reason = reason
        super().__init__(message or reason)


class StreamManager:
    def __init__(self, data_dir: str = DATA_DIR):
        self._data_dir = data_dir
        os.makedirs(self._data_dir, exist_ok=True)
        self._processes: dict[str, asyncio.subprocess.Process] = {}
        self._last_access: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._sweep_task: asyncio.Task | None = None

    def _camera_dir(self, camera_id: str) -> str:
        return os.path.join(self._data_dir, camera_id)

    def playlist_path(self, camera_id: str) -> str:
        return os.path.join(self._camera_dir(camera_id), "index.m3u8")

    def touch(self, camera_id: str) -> None:
        """Marks a camera as just-accessed — resets its idle timer."""
        self._last_access[camera_id] = time.time()

    def is_running(self, camera_id: str) -> bool:
        proc = self._processes.get(camera_id)
        return proc is not None and proc.returncode is None

    async def ensure_started(self, camera_id: str, rtsp_url: str) -> None:
        """
        Starts ffmpeg for this camera if it isn't already running.
        Idempotent — safe to call on every request. Uses a per-camera
        lock so two concurrent first-requests for the same camera don't
        race and spawn two ffmpeg processes for it.
        """
        self.touch(camera_id)
        if self.is_running(camera_id):
            return

        lock = self._locks.setdefault(camera_id, asyncio.Lock())
        async with lock:
            # Re-check after acquiring the lock — another request may
            # have already started it while we were waiting.
            if self.is_running(camera_id):
                return

            camera_dir = self._camera_dir(camera_id)
            os.makedirs(camera_dir, exist_ok=True)

            playlist = os.path.join(camera_dir, "index.m3u8")
            segment_pattern = os.path.join(camera_dir, "%d.ts")

            # Built here, right before use — the credential-bearing URL
            # never gets stored on self or passed back to any caller;
            # only this local variable, fed straight into the ffmpeg
            # argv below, ever holds it.
            authenticated_url = _with_rtsp_credentials(rtsp_url)

            cmd = [
                "ffmpeg",
                "-rtsp_transport", "tcp",
                "-i", authenticated_url,
                "-c:v", "copy",
                "-an",
                "-f", "hls",
                "-hls_time", HLS_SEGMENT_SECONDS,
                "-hls_list_size", HLS_LIST_SIZE,
                "-hls_flags", "delete_segments+append_list+temp_file",
                "-hls_segment_filename", segment_pattern,
                playlist,
            ]
            try:
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
            except FileNotFoundError:
                raise StreamManagerError(
                    "FFMPEG_NOT_FOUND", "ffmpeg is not installed or not on PATH"
                )
            self._processes[camera_id] = process

    async def stop(self, camera_id: str) -> None:
        """Kills the ffmpeg process (if running) and deletes its output
        directory. Safe to call even if the camera was never started."""
        process = self._processes.pop(camera_id, None)
        if process is not None and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=5)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()

        self._last_access.pop(camera_id, None)
        self._locks.pop(camera_id, None)

        camera_dir = self._camera_dir(camera_id)
        if os.path.isdir(camera_dir):
            shutil.rmtree(camera_dir, ignore_errors=True)

    async def _sweep_once(self) -> None:
        now = time.time()
        idle_cameras = [
            camera_id
            for camera_id, last_seen in list(self._last_access.items())
            if now - last_seen > IDLE_TIMEOUT_SECONDS
        ]
        for camera_id in idle_cameras:
            await self.stop(camera_id)

    async def _sweep_loop(self) -> None:
        while True:
            await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
            await self._sweep_once()

    def start_sweeping(self) -> None:
        if self._sweep_task is None:
            self._sweep_task = asyncio.create_task(self._sweep_loop())

    async def shutdown(self) -> None:
        """Stops the sweep loop and every running camera — called once
        at app shutdown so no orphaned ffmpeg processes are left behind."""
        if self._sweep_task is not None:
            self._sweep_task.cancel()
            self._sweep_task = None
        for camera_id in list(self._processes.keys()):
            await self.stop(camera_id)
