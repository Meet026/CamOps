#!/usr/bin/env python3
"""
CLI entry point: runs the full Phase 2 pipeline (detect -> embed -> store)
over every image in a folder, attributed to one camera_id.

Usage:
    python3 scripts/run_batch.py --data data/test_images --camera-id <uuid>
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from detector import VehicleDetector
from sighting_store import SightingStore
from pipeline import run_pipeline

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vehicle-reid"))
from src.embedder import VehicleEmbedder

# The fine-tuned (Phase 1, 500-vehicle) model is the real default, not
# the untrained base model — see api.py for why this matters.
DEFAULT_EMBEDDER_MODEL = os.path.join(
    os.path.dirname(__file__), "..", "..", "vehicle-reid", "models",
    "vehicle_vit_clip_reid_finetuned.onnx",
)


def collect_image_paths(data_dir: str) -> list:
    valid_extensions = (".jpg", ".jpeg", ".png")
    paths = []
    for filename in sorted(os.listdir(data_dir)):
        if filename.lower().endswith(valid_extensions):
            paths.append(os.path.join(data_dir, filename))
    return paths


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, help="Folder of images to process")
    parser.add_argument("--camera-id", required=True, help="UUID of an existing camera (must exist in the camera table)")
    parser.add_argument("--embedder-model", default=DEFAULT_EMBEDDER_MODEL)
    parser.add_argument("--yolo-model", default="yolo11n.pt")
    parser.add_argument("--confidence", type=float, default=0.4)
    args = parser.parse_args()

    image_paths = collect_image_paths(args.data)
    print(f"Found {len(image_paths)} images in {args.data}")

    detector = VehicleDetector(model_name=args.yolo_model, confidence_threshold=args.confidence)
    embedder = VehicleEmbedder(args.embedder_model)
    store = SightingStore()

    result = run_pipeline(image_paths, args.camera_id, detector, embedder, store)

    print(f"\nSaved {len(result.saved_sighting_ids)} sightings.")
    if result.skipped:
        print(f"Skipped {len(result.skipped)} items:")
        for description, reason in result.skipped:
            print(f"  {description}: {reason}")

    store.close()
