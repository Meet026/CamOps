"""
HTTP API for Phase 2's route-formation flow: upload a photo, detect every
vehicle in it, and for each detected vehicle return a chronologically
ordered "route" of past sightings considered the same vehicle (built on
top of SightingStore.find_route, added for exactly this purpose).

Scope, explicitly agreed with the project owner before building this:
- API only. No frontend integration in this task — the frontend can
  call this once it exists, but that's separate work.
- This does not claim the underlying Re-ID model's matches are accurate.
  Phase 1's own before/after evaluation found the current 500-vehicle
  model's matching quality is weak (see
  ../../docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md) — the model can be
  swapped later (ROUTE_SIMILARITY_THRESHOLD and the model file are both
  swappable without changing this API's shape) once the full
  10,000-vehicle fine-tune is ready.
- The similarity threshold that decides "is this the same vehicle" is a
  provisional, configurable value — not a validated cutoff — read from
  the ROUTE_SIMILARITY_THRESHOLD env var (default 0.80) specifically so
  it can be retuned without a code change, per explicit request.

Run locally:
    uvicorn src.api:app --reload --port 8000
Then see interactive docs at http://localhost:8000/docs
"""
import os
import sys
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-reid", "src"))

from detector import VehicleDetector, DetectorError  # noqa: E402
from sighting_store import SightingStore, SightingStoreError  # noqa: E402
from embedder import VehicleEmbedder, EmbedderError  # noqa: E402
from preprocessing import to_model_input  # noqa: E402


# The fine-tuned (Phase 1, 500-vehicle) model is the real default — not
# the untrained base model. This was a real bug: DEFAULT_EMBEDDER_MODEL
# previously pointed at the base model, and VEHICLE_REID_MODEL_PATH was
# never actually set anywhere, so every deployment silently ran the
# weaker, non-fine-tuned model despite docs claiming the fine-tuned one
# was deployed. Fetch both via vehicle-reid/scripts/fetch_model.py.
DEFAULT_EMBEDDER_MODEL = os.path.join(
    os.path.dirname(__file__), "..", "..", "vehicle-reid", "models",
    "vehicle_vit_clip_reid_finetuned.onnx",
)
EMBEDDER_MODEL_PATH = os.environ.get("VEHICLE_REID_MODEL_PATH", DEFAULT_EMBEDDER_MODEL)

# Provisional, explicitly not-yet-validated cutoff for "is this the same
# vehicle" — configurable so it can be retuned without a code change once
# a better Re-ID model exists. Set by the project owner at 80% (0.80).
ROUTE_SIMILARITY_THRESHOLD = float(os.environ.get("ROUTE_SIMILARITY_THRESHOLD", "0.80"))

YOLO_MODEL_NAME = os.environ.get("VEHICLE_DETECTION_YOLO_MODEL", "yolo11n.pt")
DETECTION_CONFIDENCE_THRESHOLD = float(os.environ.get("VEHICLE_DETECTION_CONFIDENCE", "0.4"))

# The frontend (Vite dev server, a different origin) calls this API
# directly from the browser — without CORS headers every request is
# silently blocked by the browser, not a server-side error, so this is a
# real requirement for frontend integration, not an extra. Configurable
# so a real deployed frontend origin can be added without a code change;
# defaults to common local dev ports (Vite's default 5173, plus 3001 in
# case Model 1's frontend and this one are ever run side by side).
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "VEHICLE_API_CORS_ORIGINS", "http://localhost:5173,http://localhost:3001"
    ).split(",")
    if origin.strip()
]

# Heavy models (YOLO + ONNX Re-ID) are loaded once at process startup, not
# per-request — loading them per-request would make every call take
# seconds just for model I/O, on top of actual inference time.
_detector: VehicleDetector | None = None
_embedder: VehicleEmbedder | None = None


@asynccontextmanager
async def _lifespan(app: FastAPI):
    global _detector, _embedder
    _detector = VehicleDetector(
        model_name=YOLO_MODEL_NAME, confidence_threshold=DETECTION_CONFIDENCE_THRESHOLD
    )
    _embedder = VehicleEmbedder(EMBEDDER_MODEL_PATH)
    yield


app = FastAPI(
    title="Vehicle Re-ID Route API",
    description=(
        "Upload a vehicle photo; get back, per detected vehicle, a "
        "chronologically ordered route of past sightings of the same "
        "vehicle across registered cameras."
    ),
    version="0.1.0",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "route_similarity_threshold": ROUTE_SIMILARITY_THRESHOLD,
        "embedder_model_path": EMBEDDER_MODEL_PATH,
    }


@app.post("/vehicles/route")
async def vehicles_route(photo: UploadFile = File(...)):
    """
    Accepts one photo (raw frame or pre-cropped, either works — mirrors
    scripts/query_similar.py's behavior since it reuses the same
    detect -> embed -> search building blocks). Detects every vehicle in
    it, and for each one, queries for past sightings of the same vehicle
    (similarity >= ROUTE_SIMILARITY_THRESHOLD), sorted chronologically so
    the result can be drawn as a route on a map.
    """
    if _detector is None or _embedder is None:
        raise HTTPException(status_code=503, detail="Models not yet loaded")

    suffix = os.path.splitext(photo.filename or "")[1] or ".jpg"
    try:
        contents = await photo.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read uploaded file: {e}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(contents)
        tmp.flush()

        try:
            detections = _detector.detect(tmp.name)
        except DetectorError as e:
            raise HTTPException(
                status_code=422, detail=f"Detection failed: {e.reason} - {e}"
            )

        if not detections:
            return JSONResponse({"detections": []})

        store = SightingStore()
        try:
            results = []
            for detection in detections:
                try:
                    model_input = to_model_input(
                        detection.crop, _embedder.input_height, _embedder.input_width
                    )
                    embedding = _embedder.embed(model_input)
                except EmbedderError as e:
                    results.append(
                        {
                            "vehicle_class": detection.class_name,
                            "detection_confidence": detection.confidence,
                            "error": f"EMBEDDING_FAILED:{e.reason}",
                        }
                    )
                    continue

                try:
                    route = store.find_route(
                        embedding, similarity_threshold=ROUTE_SIMILARITY_THRESHOLD
                    )
                except SightingStoreError as e:
                    results.append(
                        {
                            "vehicle_class": detection.class_name,
                            "detection_confidence": detection.confidence,
                            "error": f"ROUTE_QUERY_FAILED:{e.reason}",
                        }
                    )
                    continue

                for entry in route:
                    entry["sighting_id"] = str(entry["sighting_id"])
                    entry["camera_id"] = str(entry["camera_id"])
                    entry["detected_at"] = entry["detected_at"].isoformat()

                results.append(
                    {
                        "vehicle_class": detection.class_name,
                        "detection_confidence": detection.confidence,
                        "route": route,
                        "route_threshold_used": ROUTE_SIMILARITY_THRESHOLD,
                    }
                )
        finally:
            store.close()

    return JSONResponse({"detections": results})
