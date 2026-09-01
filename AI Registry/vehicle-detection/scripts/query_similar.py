#!/usr/bin/env python3
"""
Completes the "whole flow" the project owner asked for: given a single
query photo (not necessarily pre-cropped — a raw frame is fine), detect
every vehicle in it, embed each one, and search the vehicle_sighting
table for the most similar past sightings.

Explicit scope: this tests the PIPELINE MECHANICS end-to-end
(detect -> crop -> embed -> search -> return results), on deliberately
clean/simple photos — it does NOT claim the underlying Re-ID model's
matches are accurate. Phase 1's own before/after evaluation already
found the current 500-vehicle model's matching quality is weak (see
../docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md) — this script will use
whichever model is currently in vehicle-reid/models/ without judging its
quality; that's a separate, already-tracked concern.

Usage:
    python3 scripts/query_similar.py --photo path/to/query.jpg --limit 5
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-reid"))

from detector import VehicleDetector
from sighting_store import SightingStore
from src.embedder import VehicleEmbedder
from src.preprocessing import to_model_input

# The fine-tuned (Phase 1, 500-vehicle) model is the real default, not
# the untrained base model — see api.py for why this matters.
DEFAULT_EMBEDDER_MODEL = os.path.join(
    os.path.dirname(__file__), "..", "..", "vehicle-reid", "models",
    "vehicle_vit_clip_reid_finetuned.onnx",
)


def query_photo(photo_path: str, detector: VehicleDetector, embedder: VehicleEmbedder, store: SightingStore, limit: int) -> list:
    """
    Returns a list of (detection_index, vehicle_class, confidence, results)
    — one entry per vehicle detected in the query photo, `results` being
    find_similar's own return list for that vehicle's embedding.
    """
    detections = detector.detect(photo_path)
    output = []
    for i, detection in enumerate(detections):
        model_input = to_model_input(detection.crop, embedder.input_height, embedder.input_width)
        embedding = embedder.embed(model_input)
        results = store.find_similar(embedding, limit=limit)
        output.append((i, detection.class_name, detection.confidence, results))
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--photo", required=True, help="Query photo (raw frame or pre-cropped, either works)")
    parser.add_argument("--embedder-model", default=DEFAULT_EMBEDDER_MODEL)
    parser.add_argument("--yolo-model", default="yolo11n.pt")
    parser.add_argument("--confidence", type=float, default=0.4)
    parser.add_argument("--limit", type=int, default=5, help="How many similar sightings to return per detected vehicle")
    args = parser.parse_args()

    detector = VehicleDetector(model_name=args.yolo_model, confidence_threshold=args.confidence)
    embedder = VehicleEmbedder(args.embedder_model)
    store = SightingStore()

    print(f"Querying: {args.photo}\n")
    query_results = query_photo(args.photo, detector, embedder, store, args.limit)

    if not query_results:
        print("No vehicles detected in the query photo.")
    else:
        for i, class_name, confidence, results in query_results:
            print(f"=== Detection {i}: {class_name} (confidence {confidence:.2f}) ===")
            if not results:
                print("  No sightings in the database yet.")
            else:
                for sighting_id, camera_id, detected_at, vehicle_class, similarity in results:
                    print(f"  similarity={similarity:.4f}  {vehicle_class}  camera={camera_id}  detected_at={detected_at}  id={sighting_id}")
            print()

    store.close()
