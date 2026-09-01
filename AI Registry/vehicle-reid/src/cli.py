"""
Phase 0 CLI entry point: wires preprocessing -> degradation -> embedding ->
evaluation -> reporting into one full run across every clean image and
every degraded condition.

Model-level failures (missing/corrupt ONNX file) are fail-fast: VehicleEmbedder's
constructor raises immediately and this function does not catch it, since a
broken model makes every downstream result meaningless. Per-image failures
(corrupt file, wrong format, etc.) ARE caught here and recorded as skipped
files — one bad image never stops the run.
"""
import os

from src.embedder import VehicleEmbedder, EmbedderError
from src.preprocessing import load_and_validate, to_model_input, PreprocessingError
from src.degrade import apply_degradation, DEGRADATION_CONDITIONS
from src.evaluate import evaluate_embeddings
from src.report import generate_report


def _collect_image_paths(clean_data_dir: str) -> list:
    """Returns [(vehicle_id, file_path), ...] for every file under clean_data_dir."""
    items = []
    for vehicle_id in sorted(os.listdir(clean_data_dir)):
        vehicle_dir = os.path.join(clean_data_dir, vehicle_id)
        if not os.path.isdir(vehicle_dir):
            continue
        for filename in sorted(os.listdir(vehicle_dir)):
            items.append((vehicle_id, os.path.join(vehicle_dir, filename)))
    return items


def _embed_all(image_paths, embedder, condition, skipped_files):
    """
    Loads, optionally degrades, and embeds every (vehicle_id, file_path) pair.
    Any PreprocessingError or EmbedderError on a SPECIFIC image is caught,
    recorded in skipped_files, and that image is skipped — never crashes
    the whole run.
    """
    embeddings = []
    for vehicle_id, file_path in image_paths:
        try:
            image = load_and_validate(file_path)
            if condition != "clean":
                image = apply_degradation(image, condition)
            model_input = to_model_input(image, embedder.input_height, embedder.input_width)
            embedding = embedder.embed(model_input)
            embeddings.append((vehicle_id, embedding))
        except PreprocessingError as e:
            skipped_files.append((f"{file_path} [{condition}]", e.reason))
        except EmbedderError as e:
            skipped_files.append((f"{file_path} [{condition}]", e.reason))
    return embeddings


def run(clean_data_dir: str, model_path: str, output_dir: str) -> tuple:
    # Fail-fast: a broken model makes every result meaningless, so this
    # is NOT wrapped in try/except — it propagates immediately.
    embedder = VehicleEmbedder(model_path)

    image_paths = _collect_image_paths(clean_data_dir)
    skipped_files = []

    results_by_condition = {}

    clean_embeddings = _embed_all(image_paths, embedder, "clean", skipped_files)
    results_by_condition["clean"] = evaluate_embeddings(clean_embeddings)

    for condition in DEGRADATION_CONDITIONS:
        condition_embeddings = _embed_all(image_paths, embedder, condition, skipped_files)
        results_by_condition[condition] = evaluate_embeddings(condition_embeddings)

    return generate_report(results_by_condition, skipped_files, output_dir)


if __name__ == "__main__":
    import argparse
    from datetime import datetime

    parser = argparse.ArgumentParser(description="Vehicle Re-ID Phase 0 baseline runner")
    parser.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "..", "data", "clean"))
    parser.add_argument("--model", default=os.path.join(os.path.dirname(__file__), "..", "models", "vehicle_vit_clip_reid.onnx"))
    parser.add_argument("--output", default=os.path.join(os.path.dirname(__file__), "..", "reports"))
    args = parser.parse_args()

    run_output_dir = os.path.join(args.output, datetime.now().strftime("%Y%m%d_%H%M%S"))
    md_path, json_path = run(args.data, args.model, run_output_dir)
    print(f"Report written to:\n  {md_path}\n  {json_path}")
