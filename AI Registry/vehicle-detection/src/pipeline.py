"""
Full Phase 2 pipeline: detect vehicles in a frame -> crop -> embed (reusing
Phase 0/1's tested VehicleEmbedder/preprocessing, not duplicated here) ->
store in the vehicle_sighting table.

Reuses vehicle-reid/src/embedder.py and preprocessing.py directly via a
sys.path addition to the sibling project — a single source of truth for
the embedding step, rather than a second copy that could drift out of
sync with Phase 0/1's tested version.
"""
import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-reid")
)

from src.embedder import VehicleEmbedder, EmbedderError  # noqa: E402
from src.preprocessing import to_model_input  # noqa: E402

from detector import VehicleDetector, DetectorError  # noqa: E402
from sighting_store import SightingStore, Sighting, SightingStoreError  # noqa: E402


class PipelineResult:
    def __init__(self):
        self.saved_sighting_ids = []
        # (sighting_id, plate, confidence) for each SAVED sighting that has a
        # plate — what vehicle-ingest checks against the wanted list.
        self.saved_plate_reads = []
        self.skipped = []  # list of (description, reason) tuples

    def add_saved(self, sighting_id: str):
        self.saved_sighting_ids.append(sighting_id)

    def add_skipped(self, description: str, reason: str):
        self.skipped.append((description, reason))


def run_pipeline(
    image_paths: list,
    camera_id: str,
    detector: VehicleDetector,
    embedder: VehicleEmbedder,
    store: SightingStore,
    plate_reader=None,
) -> PipelineResult:
    """
    Runs the full detect -> crop -> embed -> read_plate -> store pipeline
    over a list of image files, all attributed to one camera_id.

    plate_reader is an optional callable: crop (PIL.Image) -> (plate_text,
    confidence) tuple, or None if no plate was found. Omitting it (the
    default) keeps today's exact behavior — every Sighting is saved with
    matched_plate=None, plate_confidence=None — so existing callers (e.g.
    vehicle-ingest's ingest_cycle.py, before it's updated to pass one) are
    unaffected. A plate_reader that returns None, or raises, is treated
    the same way an EmbedderError on just the plate signal would be:
    non-fatal — the embedding-based sighting is still saved, since visual
    re-identification doesn't depend on a legible plate.

    Every per-image and per-detection failure is caught, recorded in the
    result's skipped list with a typed reason, and processing continues —
    matching the skip-and-continue error-handling convention established
    in Phase 0 (never let one bad frame or one bad crop stop the whole
    batch).
    """
    result = PipelineResult()

    for image_path in image_paths:
        try:
            detections = detector.detect(image_path)
        except DetectorError as e:
            result.add_skipped(image_path, f"DETECTION_FAILED:{e.reason}")
            continue

        if not detections:
            result.add_skipped(image_path, "NO_VEHICLES_DETECTED")
            continue

        for i, detection in enumerate(detections):
            crop_description = f"{image_path} [detection {i}, {detection.class_name}]"
            try:
                model_input = to_model_input(
                    detection.crop, embedder.input_height, embedder.input_width
                )
                embedding = embedder.embed(model_input)
            except EmbedderError as e:
                result.add_skipped(crop_description, f"EMBEDDING_FAILED:{e.reason}")
                continue

            matched_plate = None
            plate_confidence = None
            if plate_reader is not None:
                try:
                    plate_result = plate_reader(detection.crop)
                except Exception:  # noqa: BLE001 -- a plate-reader crash must never cost the embedding-based sighting
                    plate_result = None
                if plate_result is not None:
                    matched_plate, plate_confidence = plate_result

            sighting = Sighting(
                camera_id=camera_id,
                source_image_path=image_path,
                box_xyxy=detection.box_xyxy,
                vehicle_class=detection.class_name,
                detection_confidence=detection.confidence,
                embedding=embedding,
                matched_plate=matched_plate,
                plate_confidence=plate_confidence,
            )
            try:
                sighting_id = store.save(sighting)
                result.add_saved(sighting_id)
                if matched_plate is not None:
                    result.saved_plate_reads.append((sighting_id, matched_plate, plate_confidence))
            except SightingStoreError as e:
                result.add_skipped(crop_description, f"STORE_FAILED:{e.reason}")
                continue

    return result
