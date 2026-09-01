#!/usr/bin/env python3
"""
Phase 0 failure diagnostic: identifies WHICH specific image pairs the
model gets wrong, not just an aggregate similarity number.

Two failure modes are surfaced:
  1. FALSE NEGATIVES — same-vehicle pairs that scored LOW (the model
     failed to recognize two photos of the same car as similar).
  2. FALSE POSITIVES — different-vehicle pairs that scored HIGH (the
     model mistakenly thinks two different cars look similar).

For each, this script prints the specific file paths involved and their
score, so a human can open those exact photos and look for a pattern
(same angle? same color? same body style? bad lighting in one?) — this
is what actually answers "where does the model fail," as opposed to a
single aggregate gap number which only answers "does it fail at all."

Usage:
    python3 scripts/diagnose_failures.py --data data/clean --model models/vehicle_vit_clip_reid.onnx
"""
import argparse
import os
import sys
from itertools import combinations

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.embedder import VehicleEmbedder
from src.preprocessing import load_and_validate, to_model_input, PreprocessingError
import numpy as np


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def collect_embeddings(clean_data_dir: str, embedder: VehicleEmbedder) -> list:
    """Returns [(vehicle_id, file_path, embedding), ...] — keeps the file
    path alongside each embedding, unlike evaluate.py's aggregate-only
    approach, since we need to name specific failing files here."""
    items = []
    for vehicle_id in sorted(os.listdir(clean_data_dir)):
        vehicle_dir = os.path.join(clean_data_dir, vehicle_id)
        if not os.path.isdir(vehicle_dir):
            continue
        for filename in sorted(os.listdir(vehicle_dir)):
            file_path = os.path.join(vehicle_dir, filename)
            try:
                image = load_and_validate(file_path)
                model_input = to_model_input(image, embedder.input_height, embedder.input_width)
                embedding = embedder.embed(model_input)
                items.append((vehicle_id, file_path, embedding))
            except PreprocessingError as e:
                print(f"SKIPPED {file_path}: {e.reason}")
    return items


def diagnose(items: list, top_n: int = 15) -> None:
    same_vehicle_pairs = []
    different_vehicle_pairs = []

    for (vid_a, path_a, emb_a), (vid_b, path_b, emb_b) in combinations(items, 2):
        score = cosine_similarity(emb_a, emb_b)
        if vid_a == vid_b:
            same_vehicle_pairs.append((score, path_a, path_b))
        else:
            different_vehicle_pairs.append((score, path_a, path_b, vid_a, vid_b))

    same_vehicle_pairs.sort(key=lambda x: x[0])  # ascending — worst (lowest) first
    different_vehicle_pairs.sort(key=lambda x: -x[0])  # descending — worst (highest) first

    same_scores = [s for s, _, _ in same_vehicle_pairs]
    diff_scores = [s for s, _, _, _, _ in different_vehicle_pairs]

    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Same-vehicle pairs:      {len(same_vehicle_pairs)}  (mean={np.mean(same_scores):.4f}, min={min(same_scores):.4f}, max={max(same_scores):.4f})")
    print(f"Different-vehicle pairs: {len(different_vehicle_pairs)}  (mean={np.mean(diff_scores):.4f}, min={min(diff_scores):.4f}, max={max(diff_scores):.4f})")
    print()

    print("=" * 80)
    print(f"FALSE NEGATIVES — {top_n} worst same-vehicle pairs (should score HIGH, scored LOW)")
    print("=" * 80)
    for score, path_a, path_b in same_vehicle_pairs[:top_n]:
        print(f"  {score:.4f}  {os.path.basename(path_a)}  <->  {os.path.basename(path_b)}")
    print()

    print("=" * 80)
    print(f"FALSE POSITIVES — {top_n} worst different-vehicle pairs (should score LOW, scored HIGH)")
    print("=" * 80)
    for score, path_a, path_b, vid_a, vid_b in different_vehicle_pairs[:top_n]:
        print(f"  {score:.4f}  [{vid_a}] {os.path.basename(path_a)}  <->  [{vid_b}] {os.path.basename(path_b)}")
    print()

    # Overlap check: how much do the two distributions overlap? If the
    # worst same-vehicle score is lower than the best different-vehicle
    # score, the model has NO threshold that would separate them perfectly
    # — a concrete, checkable measure of how confusable the two classes are.
    worst_same = min(same_scores)
    best_diff = max(diff_scores)
    print("=" * 80)
    print("SEPARABILITY CHECK")
    print("=" * 80)
    print(f"Worst same-vehicle score:      {worst_same:.4f}")
    print(f"Best (highest) different-vehicle score: {best_diff:.4f}")
    if worst_same < best_diff:
        overlap_same = sum(1 for s in same_scores if s < best_diff)
        overlap_diff = sum(1 for s in diff_scores if s > worst_same)
        print(
            f"NO threshold perfectly separates the two classes — "
            f"{overlap_same}/{len(same_scores)} same-vehicle pairs score "
            f"below the best different-vehicle pair, and "
            f"{overlap_diff}/{len(diff_scores)} different-vehicle pairs "
            f"score above the worst same-vehicle pair."
        )
    else:
        print("A perfect threshold exists between these two classes on this sample.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "..", "data", "clean"))
    parser.add_argument("--model", default=os.path.join(os.path.dirname(__file__), "..", "models", "vehicle_vit_clip_reid.onnx"))
    parser.add_argument("--top-n", type=int, default=15, help="How many worst-case pairs to show per category")
    args = parser.parse_args()

    embedder = VehicleEmbedder(args.model)
    items = collect_embeddings(args.data, embedder)
    diagnose(items, top_n=args.top_n)
