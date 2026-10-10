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
from sighting_store import SightingStore, _connect_preferring_ipv4, _load_database_url  # noqa: E402
from embedder import VehicleEmbedder  # noqa: E402

from src.camera_list_cache import CameraListCache
from src.ingest_cycle import run_one_cycle
from src.motion_gated_cycle import run_motion_gated_cycle
from src.plate_reader import make_plate_reader
from src.wanted_alerts import WantedAlerter
from src.wanted_watcher import WantedPlateWatcher, load_active_from_db
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
# The fast, motion-gated loop: cheap pixel-diff check only, no model
# inference, so polling faster than the slow cycle is genuinely cheap —
# but 3s is still chosen deliberately, not as fast as technically
# possible. Segments are only produced every 20-122+ seconds on this
# project's real cameras (same measurement CYCLE_INTERVAL_SECONDS above
# is based on), so polling much faster than ~3s would mostly just
# re-read the same still-current segment and compare a frame against
# itself — no new information, just wasted cycles. 3s is fast enough to
# catch a vehicle that passed between two of the slower 20s cycle's
# checks, without polling faster than the underlying data can change.
MOTION_DETECTION_INTERVAL_SECONDS = float(
    os.environ.get("VEHICLE_INGEST_MOTION_CHECK_INTERVAL", "3")
)
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
PLATE_READING_ENABLED = os.environ.get("VEHICLE_INGEST_PLATE_READING", "1") != "0"
WANTED_ALERTS_ENABLED = os.environ.get("VEHICLE_INGEST_WANTED_ALERTS", "1") != "0"
WANTED_LIST_REFRESH_SECONDS = float(os.environ.get("VEHICLE_INGEST_WANTED_REFRESH", "60"))

_video_stream_client: VideoStreamClient | None = None
_detector: VehicleDetector | None = None
_embedder: VehicleEmbedder | None = None
_camera_cycle_task: asyncio.Task | None = None
_motion_check_task: asyncio.Task | None = None
# Shared between BOTH loops -- real, measured problem this fixes: before
# this existed, each loop called video_stream_client.list_cameras()
# independently (the slow loop every 20s, the fast one every 3s), and
# under real concurrent load from the many ffmpeg/YOLO worker threads
# both loops spawn, GET /cameras occasionally timed out. The camera list
# itself only changes when someone adds/removes a camera in the
# registry -- far rarer than either loop's interval -- so sharing one
# cache, refreshed at the SLOW loop's own cadence, removes essentially
# all of the redundant traffic this caused.
_camera_list_cache: CameraListCache | None = None
_last_cycle_summary: dict = {}
_last_motion_check_summary: dict = {}
# Per-camera last-seen frame, kept ONLY in memory for the motion-gated
# loop's own next comparison -- never written to disk/DB (no raw-frame
# retention, same rule the pipeline itself already follows). Lost on
# restart, which is fine: the very next check for each camera just
# treats it as a fresh "no previous frame yet" baseline again.
_last_frame_by_camera: dict = {}
_plate_reader = None
_plate_reading_status = "disabled"
_wanted_watcher: WantedPlateWatcher | None = None
_wanted_alerter: WantedAlerter | None = None


def _db_connect():
    return _connect_preferring_ipv4(_load_database_url())


def _listen_connect():
    # TCP keepalives: a LISTEN connection that dies without a clean close
    # (network drop, compute suspend) is otherwise never noticed, and
    # instant wanted-list updates would silently stop.
    url = _load_database_url()
    sep = "&" if "?" in url else "?"
    return _connect_preferring_ipv4(
        f"{url}{sep}keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=3"
    )


def _load_plate_reader():
    """
    FastALPR downloads its ONNX models on first construction. If that
    fails, ingest keeps running embedding-only (plates are an additional
    signal, not a prerequisite) and /health reports why, rather than the
    whole service refusing to start.
    """
    if not PLATE_READING_ENABLED:
        return None, "disabled"
    try:
        from fast_alpr import ALPR
        return make_plate_reader(ALPR(ocr_device="cpu")), "enabled"
    except Exception as e:  # noqa: BLE001 -- model load/download failure must not take ingest down
        return None, f"unavailable: {e}"


async def _camera_cycle_loop():
    """
    run_one_cycle (ffmpeg subprocess calls, YOLO/ONNX inference, DB
    writes) is entirely synchronous, CPU/IO-bound work -- calling it
    directly inside this async loop would block the whole event loop,
    including the HTTP server, for as long as each camera's work takes.
    asyncio.to_thread runs it on a worker thread instead, so /health and
    any other request stay responsive the entire time this loop is
    doing real work. This was a latent issue even before the
    motion-check loop existed (one call every 20s was slow enough to
    mostly hide it); it's fixed here rather than left for the new,
    much-more-frequent loop below to make newly, visibly worse.
    """
    global _last_cycle_summary
    while True:
        try:
            cameras = await asyncio.to_thread(_camera_list_cache.get)
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
                store_result = await asyncio.to_thread(
                    run_one_cycle,
                    camera=camera,
                    video_stream_client=_video_stream_client,
                    hls_data_dir=HLS_DATA_DIR,
                    detector=_detector,
                    embedder=_embedder,
                    store=store,
                    plate_reader=_plate_reader,
                    wanted_alerter=_wanted_alerter,
                )
                summary[camera.camera_id] = {
                    "status": store_result.status,
                    "detail": store_result.detail,
                }
        finally:
            store.close()
        _last_cycle_summary = summary

        await asyncio.sleep(CYCLE_INTERVAL_SECONDS)


async def _motion_check_loop():
    """
    The fast, cheap-check loop (see MOTION_DETECTION_INTERVAL_SECONDS):
    only calls the real detect+embed+save pipeline when a camera's frame
    genuinely changed enough to be worth it. Runs independently of, and
    alongside, _camera_cycle_loop above -- that slower loop is left
    completely unchanged and keeps acting as a fallback net.
    """
    global _last_motion_check_summary
    while True:
        try:
            cameras = await asyncio.to_thread(_camera_list_cache.get)
        except Exception as e:  # noqa: BLE001 -- a listing failure must not kill the loop
            _last_motion_check_summary = {"error": f"list_cameras failed: {e}"}
            await asyncio.sleep(MOTION_DETECTION_INTERVAL_SECONDS)
            continue

        if CAMERA_ALLOWLIST is not None:
            cameras = [c for c in cameras if c.camera_id in CAMERA_ALLOWLIST]

        summary = {}
        store = SightingStore()
        try:
            for camera in cameras:
                # Same reasoning as _camera_cycle_loop above: cv2 image
                # ops, ffmpeg subprocess calls, and (on an actual motion
                # hit) real YOLO/ONNX inference are all blocking work --
                # run on a thread so this loop's much shorter sleep
                # interval doesn't starve the event loop the way a
                # direct call would.
                result = await asyncio.to_thread(
                    run_motion_gated_cycle,
                    camera=camera,
                    video_stream_client=_video_stream_client,
                    hls_data_dir=HLS_DATA_DIR,
                    detector=_detector,
                    embedder=_embedder,
                    store=store,
                    previous_frame=_last_frame_by_camera.get(camera.camera_id),
                    plate_reader=_plate_reader,
                    wanted_alerter=_wanted_alerter,
                )
                if result.frame is not None:
                    _last_frame_by_camera[camera.camera_id] = result.frame
                summary[camera.camera_id] = {"status": result.status, "detail": result.detail}
        finally:
            store.close()
        _last_motion_check_summary = summary

        await asyncio.sleep(MOTION_DETECTION_INTERVAL_SECONDS)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    global _video_stream_client, _detector, _embedder, _camera_cycle_task, _motion_check_task
    global _camera_list_cache, _plate_reader, _plate_reading_status, _wanted_watcher, _wanted_alerter
    _video_stream_client = VideoStreamClient(base_url=VIDEO_STREAM_BASE_URL)
    _detector = VehicleDetector()
    _embedder = VehicleEmbedder(DEFAULT_EMBEDDER_MODEL)
    _plate_reader, _plate_reading_status = _load_plate_reader()
    if WANTED_ALERTS_ENABLED:
        _wanted_watcher = WantedPlateWatcher(
            load_active=lambda conn=None: load_active_from_db(_db_connect, conn),
            listen_connect=_listen_connect,
            refresh_seconds=WANTED_LIST_REFRESH_SECONDS,
        )
        _wanted_watcher.start()
        _wanted_alerter = WantedAlerter(_wanted_watcher, connect=_db_connect)
    # TTL matches the slow loop's own cadence -- the camera list changes
    # (a camera added/removed in the registry) far less often than
    # either loop runs, so refreshing at CYCLE_INTERVAL_SECONDS is
    # already generous, not a staleness risk.
    _camera_list_cache = CameraListCache(
        fetch=_video_stream_client.list_cameras, ttl_seconds=CYCLE_INTERVAL_SECONDS
    )
    _camera_cycle_task = asyncio.create_task(_camera_cycle_loop())
    _motion_check_task = asyncio.create_task(_motion_check_loop())
    yield
    _camera_cycle_task.cancel()
    _motion_check_task.cancel()
    if _wanted_watcher is not None:
        _wanted_watcher.stop()
    _video_stream_client.close()


app = FastAPI(
    title="Vehicle Ingest",
    description="Periodically feeds frames from video-stream's live camera feeds into vehicle-detection's existing detect/embed/store pipeline.",
    version="0.1.0",
    lifespan=_lifespan,
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "plate_reading": _plate_reading_status,
        "wanted_alerts": _wanted_alerter.status() if _wanted_alerter is not None else "disabled",
        "last_cycle": _last_cycle_summary,
        "last_motion_check": _last_motion_check_summary,
    }
