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
from PIL import Image, UnidentifiedImageError

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-reid", "src"))

from detector import VehicleDetector, VehicleDetection, DetectorError  # noqa: E402
from sighting_store import SightingStore, SightingStoreError  # noqa: E402
from embedder import VehicleEmbedder, EmbedderError  # noqa: E402
from preprocessing import to_model_input  # noqa: E402


# Set back to the base HuggingFace model (occurra/vehicle_vit_clip_reid)
# at the project owner's explicit request, reverting the Phase 1
# fine-tuned default.
#
# Measured trade-off on this project's own real camera crops (6 crops,
# 15 pairs, both models scored on identical inputs) — recorded here so
# this choice isn't re-litigated from memory:
#   - Both models rank the SAME true pair (one parked car seen in two
#     frames ~60s apart) as their top match: base 0.9623, fine-tuned
#     0.9289. Both get the easy case right.
#   - Base scores everything higher (mean 0.737 vs 0.576). Its highest
#     FALSE pair — a motorcycle vs a car — is 0.8068; the fine-tuned
#     model rates that same pair 0.4863.
#   - Margin between the true match and the worst false match:
#     fine-tuned 0.22, base 0.16.
# So the base model is the LESS discriminating of the two, and at a
# 0.80 cutoff it would call a motorcycle and a car the same vehicle.
# That is precisely why ROUTE_SIMILARITY_THRESHOLD below is no longer
# 0.80 — using this model at that cutoff is not safe.
DEFAULT_EMBEDDER_MODEL = os.path.join(
    os.path.dirname(__file__), "..", "..", "vehicle-reid", "models",
    "vehicle_vit_clip_reid.onnx",
)
EMBEDDER_MODEL_PATH = os.environ.get("VEHICLE_REID_MODEL_PATH", DEFAULT_EMBEDDER_MODEL)

# Raised from 0.80 to 0.90, measured — not guessed.
#
# The real failure this fixes: at 0.80, a single query returned 88 "same
# vehicle" matches out of 242 car sightings stored at ONE camera (36% of
# every car matching every other). A traffic camera does not see the
# same car 88 times in three hours; that route was mostly false matches.
#
# Measured on 150 real stored embeddings from that camera (11,175 pairs),
# counting pairs of DIFFERENT vehicle classes that still cleared the bar
# (a car matching a truck is unambiguously wrong, so this is a floor on
# the true error rate, not the whole of it):
#     0.80 -> 51 cross-class false matches (1.6%)
#     0.85 ->  9 (0.3%)
#     0.90 ->  3 (0.1%)
#     0.95 ->  2 (0.1%)
# 0.90 removes ~94% of the measurable false matches; going to 0.95 buys
# almost nothing further while discarding many true matches, since the
# same-class p95 similarity is only 0.823. The base model's higher
# score inflation (see above) is a second, independent reason 0.80 is
# too low for it specifically.
#
# Still configurable via env, and still NOT a validated forensic cutoff —
# it is a defensible operating point, not proof two vehicles are the same.
ROUTE_SIMILARITY_THRESHOLD = float(os.environ.get("ROUTE_SIMILARITY_THRESHOLD", "0.90"))

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
    Accepts one photo. If it's a normal scene, YOLO detects every vehicle
    in it and each one is treated separately, as before. If YOLO finds
    ZERO vehicles, this now falls back to treating the WHOLE uploaded
    image as one already-cropped vehicle and embeds it directly, instead
    of immediately reporting "no vehicle detected."

    Real bug this fixes: the previous docstring here claimed "raw frame
    or pre-cropped, either works" — that was false, confirmed directly
    by testing real, already-cropped vehicle images (down to ~80x52px)
    through this exact code path: YOLO frequently finds 0 detections on
    a tight crop (it relies on scene context — road, surrounding
    vehicles for scale — that a crop strips away), or misclassifies what
    little it can see. This is also the documented, standard shape for
    vehicle Re-ID: a pre-cropped patch is the model's *expected* query
    input, not an edge case — detection is a separate, optional upstream
    step, not something the Re-ID query path should force on every
    input. The fallback only triggers on a genuine 0-detection result —
    a photo with a real vehicle that YOLO DID detect (even weakly) still
    goes through the normal per-detection path unchanged, and a photo
    with truly no vehicle in it still correctly returns no results (the
    embedding + similarity search naturally won't find real matches for
    an embedding of, say, an empty street or a person).
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

        used_whole_image_fallback = False
        if not detections:
            try:
                whole_image = Image.open(tmp.name).convert("RGB")
            except (UnidentifiedImageError, OSError) as e:
                raise HTTPException(
                    status_code=400, detail=f"Could not read uploaded file as an image: {e}"
                )
            # A real VehicleDetection standing in for the whole image, not
            # an ad-hoc object — box_xyxy is the image's own real full
            # bounds (a genuine, meaningful value, not a placeholder).
            # confidence is deliberately None (not a real YOLO score) so
            # the frontend can tell this path apart from a real detection
            # rather than showing a fabricated number as if it were one.
            detections = [
                VehicleDetection(
                    crop=whole_image,
                    class_name="unknown",
                    confidence=None,
                    box_xyxy=(0, 0, whole_image.width, whole_image.height),
                )
            ]
            used_whole_image_fallback = True

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
                            "used_whole_image_fallback": used_whole_image_fallback,
                            "error": f"EMBEDDING_FAILED:{e.reason}",
                        }
                    )
                    continue

                try:
                    # Only compare against sightings of the SAME vehicle
                    # class — a car match against a stored truck is a
                    # guaranteed false positive (51 such cross-class
                    # matches were measured clearing the old threshold).
                    # The whole-image fallback path has class "unknown",
                    # which matches nothing stored, so it passes None and
                    # keeps its previous unrestricted behaviour.
                    route = store.find_route(
                        embedding,
                        similarity_threshold=ROUTE_SIMILARITY_THRESHOLD,
                        vehicle_class=(
                            detection.class_name
                            if detection.class_name != "unknown"
                            else None
                        ),
                    )
                except SightingStoreError as e:
                    results.append(
                        {
                            "vehicle_class": detection.class_name,
                            "detection_confidence": detection.confidence,
                            "used_whole_image_fallback": used_whole_image_fallback,
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
                        "used_whole_image_fallback": used_whole_image_fallback,
                        "route": route,
                        "route_threshold_used": ROUTE_SIMILARITY_THRESHOLD,
                    }
                )
        finally:
            store.close()

    return JSONResponse({"detections": results})
