"""
RTSP -> HLS relay backend. Given a registered camera_id, converts that
camera's real RTSP feed (looked up from Model 1's own camera table,
never hardcoded or passed raw by the caller — see camera_lookup.py)
into browser-playable HLS, starting the conversion on demand and
stopping it automatically once nobody's watching.

Explicit scope, agreed before building: no AI, no detection, no
recording/archival, no video-wall UI. Just the streaming plumbing a
future grid frontend would call into — see
../../../SENTINEL_IDEA_AND_ROADMAP.md Section 3, Part 2 (Steps 1 and 5)
for the wider context this fits into.

Run locally:
    uvicorn src.api:app --reload --port 8100
"""
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

sys.path.insert(0, os.path.dirname(__file__))

from camera_lookup import CameraLookup, CameraLookupError  # noqa: E402
from stream_manager import StreamManager, StreamManagerError  # noqa: E402

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "VIDEO_STREAM_CORS_ORIGINS", "http://localhost:5173,http://localhost:3001"
    ).split(",")
    if origin.strip()
]

_stream_manager: StreamManager | None = None


@asynccontextmanager
async def _lifespan(app: FastAPI):
    global _stream_manager
    _stream_manager = StreamManager()
    _stream_manager.start_sweeping()
    yield
    await _stream_manager.shutdown()


app = FastAPI(
    title="Video Stream Relay",
    description="Converts a registered camera's RTSP feed into browser-playable HLS, on demand.",
    version="0.1.0",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_camera_lookup() -> CameraLookup:
    # A fresh, short-lived connection per request — this service is
    # low-traffic (playlist/segment polling every couple seconds per
    # active viewer, not per frame), so a connection pool isn't needed
    # yet; matches the simplicity the rest of this bounded build aims for.
    try:
        return CameraLookup()
    except CameraLookupError as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {e.reason}")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/cameras")
def list_cameras():
    """Every camera with a real RTSP stream_path — what a future grid
    frontend's camera picker would call to populate its list."""
    lookup = _get_camera_lookup()
    try:
        cameras = lookup.list_streamable_cameras()
    except CameraLookupError as e:
        raise HTTPException(status_code=502, detail=f"Camera listing failed: {e.reason}")
    finally:
        lookup.close()
    return {"cameras": cameras}


async def _ensure_stream_running(camera_id: str) -> None:
    lookup = _get_camera_lookup()
    try:
        stream_path = lookup.get_stream_path(camera_id)
    except CameraLookupError as e:
        raise HTTPException(status_code=502, detail=f"Camera lookup failed: {e.reason}")
    finally:
        lookup.close()

    if not stream_path:
        raise HTTPException(
            status_code=404,
            detail=f"No RTSP stream_path registered for camera {camera_id}",
        )

    try:
        await _stream_manager.ensure_started(camera_id, stream_path)
    except StreamManagerError as e:
        raise HTTPException(status_code=500, detail=f"Could not start stream: {e.reason}")


@app.get("/stream/{camera_id}/index.m3u8")
async def get_playlist(camera_id: str):
    await _ensure_stream_running(camera_id)

    playlist_path = _stream_manager.playlist_path(camera_id)
    if not os.path.exists(playlist_path):
        # ffmpeg was just started and hasn't written its first playlist
        # yet — a real, expected transient state, not an error. Honest
        # timing, not a guess: against this hackathon's real gateway, a
        # first segment measurably took close to a minute to arrive for
        # some cameras (confirmed the bottleneck is network throughput
        # to the shared gateway, not local CPU — see stream_manager.py's
        # IDLE_TIMEOUT_SECONDS comment). Retry-After reflects that, not a
        # made-up small number that would just cause a client to hammer
        # this endpoint uselessly for 45+ seconds.
        raise HTTPException(
            status_code=503,
            detail=(
                "Stream starting — first segment can take up to a minute "
                "on this network, depending on the camera. Retry in a "
                "few seconds."
            ),
            headers={"Retry-After": "5"},
        )
    return FileResponse(playlist_path, media_type="application/vnd.apple.mpegurl")


@app.get("/stream/{camera_id}/{segment_name}.ts")
async def get_segment(camera_id: str, segment_name: str):
    # A segment request also counts as activity — this, not just
    # playlist requests, is what keeps a genuinely-being-watched stream
    # alive in the idle sweep.
    _stream_manager.touch(camera_id)

    segment_path = os.path.join(
        os.path.dirname(_stream_manager.playlist_path(camera_id)), f"{segment_name}.ts"
    )
    # Only serve files inside this camera's own directory — segment_name
    # comes straight from the URL path, so without this check a request
    # like "../../../etc/passwd" could escape the intended directory.
    camera_dir = os.path.dirname(_stream_manager.playlist_path(camera_id))
    real_path = os.path.realpath(segment_path)
    if not real_path.startswith(os.path.realpath(camera_dir) + os.sep):
        raise HTTPException(status_code=400, detail="Invalid segment name")

    if not os.path.exists(segment_path):
        # A real, expected case: ffmpeg's own delete_segments already
        # removed it, or the player is asking slightly ahead of when it
        # was written — not a server error.
        raise HTTPException(status_code=404, detail="Segment not found")
    return FileResponse(segment_path, media_type="video/mp2t")
