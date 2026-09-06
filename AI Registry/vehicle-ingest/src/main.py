"""
Entrypoint for vehicle-ingest: loads the real detection/embedding models
ONCE at startup (never per-frame -- see this project's spec Section 4 for
why that matters), then runs a background loop that cycles every
streamable camera on a repeating timer, pulling one frame from each and
feeding it to vehicle-detection's existing, unmodified run_pipeline() via
run_one_cycle().

Run locally:
    uvicorn src.main:app --port 8200
"""
import asyncio
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-detection", "src"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-reid", "src"))
from detector import VehicleDetector  # noqa: E402
from sighting_store import SightingStore  # noqa: E402
from embedder import VehicleEmbedder  # noqa: E402

from src.ingest_cycle import run_one_cycle
from src.video_stream_client import VideoStreamClient

VIDEO_STREAM_BASE_URL = os.environ.get("VIDEO_STREAM_BASE_URL", "http://127.0.0.1:8100")
HLS_DATA_DIR = os.environ.get(
    "VIDEO_STREAM_HLS_DATA_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "video-stream", "data", "hls"),
)
# Real cameras on this project's shared gateway have been measured this
# session producing segments 20-122+ seconds apart -- a per-camera cycle
# interval below the low end of that range would mostly just re-read the
# same still-current segment. 20s balances "reasonably fresh" against not
# hammering video-stream/the gateway needlessly.
CYCLE_INTERVAL_SECONDS = float(os.environ.get("VEHICLE_INGEST_CYCLE_INTERVAL", "20"))
# MUST stay identical to vehicle-detection/src/api.py's
# DEFAULT_EMBEDDER_MODEL. These two services write and read the same
# `embedding` column, and embeddings from different models are NOT
# comparable: measured directly, the SAME image embedded by the base
# and the fine-tuned model has a cosine similarity of only 0.4974 to
# itself across the two models. A mismatch here would not raise an
# error — every query would silently score ~0.5 against everything and
# the route feature would return nothing, forever, for no visible
# reason. Changing the model on one side REQUIRES changing it here and
# re-embedding (or discarding) existing rows.
DEFAULT_EMBEDDER_MODEL = os.path.join(
    os.path.dirname(__file__), "..", "..", "vehicle-reid", "models",
    "vehicle_vit_clip_reid.onnx",
)
# Optional test/scoping knob: a comma-separated allowlist of camera_ids.
# When set, only these cameras are cycled -- lets a controlled test run
# against a handful of real cameras instead of the full fleet, without
# touching video-stream (still returns all 30; this filters the list
# vehicle-ingest itself acts on). Unset (the default) means every
# camera from GET /cameras is cycled, unchanged from before this existed.
_CAMERA_ALLOWLIST_RAW = os.environ.get("VEHICLE_INGEST_CAMERA_IDS", "")
CAMERA_ALLOWLIST = {c.strip() for c in _CAMERA_ALLOWLIST_RAW.split(",") if c.strip()} or None

_video_stream_client: VideoStreamClient | None = None
_detector: VehicleDetector | None = None
_embedder: VehicleEmbedder | None = None
_camera_cycle_task: asyncio.Task | None = None
_last_cycle_summary: dict = {}


async def _camera_cycle_loop():
    global _last_cycle_summary
    while True:
        try:
            cameras = _video_stream_client.list_cameras()
        except Exception as e:  # noqa: BLE001 -- a listing failure must not kill the loop
            _last_cycle_summary = {"error": f"list_cameras failed: {e}"}
            await asyncio.sleep(CYCLE_INTERVAL_SECONDS)
            continue

        if CAMERA_ALLOWLIST is not None:
            cameras = [c for c in cameras if c.camera_id in CAMERA_ALLOWLIST]

        summary = {}
        store = SightingStore()
        try:
            for camera in cameras:
                store_result = run_one_cycle(
                    camera=camera,
                    video_stream_client=_video_stream_client,
                    hls_data_dir=HLS_DATA_DIR,
                    detector=_detector,
                    embedder=_embedder,
                    store=store,
                )
                summary[camera.camera_id] = store_result.status
        finally:
            store.close()
        _last_cycle_summary = summary

        await asyncio.sleep(CYCLE_INTERVAL_SECONDS)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    global _video_stream_client, _detector, _embedder, _camera_cycle_task
    _video_stream_client = VideoStreamClient(base_url=VIDEO_STREAM_BASE_URL)
    _detector = VehicleDetector()
    _embedder = VehicleEmbedder(DEFAULT_EMBEDDER_MODEL)
    _camera_cycle_task = asyncio.create_task(_camera_cycle_loop())
    yield
    _camera_cycle_task.cancel()
    _video_stream_client.close()


app = FastAPI(
    title="Vehicle Ingest",
    description="Periodically feeds frames from video-stream's live camera feeds into vehicle-detection's existing detect/embed/store pipeline.",
    version="0.1.0",
    lifespan=_lifespan,
)


@app.get("/health")
def health():
    return {"status": "ok", "last_cycle": _last_cycle_summary}
