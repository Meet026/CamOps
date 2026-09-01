#!/usr/bin/env python3
"""
Downloads vehicle Re-ID model checkpoints from Hugging Face — both the
Phase 0 pretrained baseline and the Phase 1 fine-tuned model. `models/`
is gitignored (the files are hundreds of MB, over GitHub's 100MB limit),
so this script is how a fresh clone actually gets a working model rather
than needing to train one from scratch. Run with no arguments to fetch
both.

Base model: occurra/vehicle_vit_clip_reid (ONNX, CLIP-ReID,
VeRi-776-trained). See
AI Registry/docs/superpowers/specs/2026-08-29-vehicle-reid-phase0-design.md
section 2 for why this model was chosen over the research doc's original
torchreid/PVEN pick (both were verified non-viable: torchreid has no
vehicle Re-ID support at all, and PVEN's weights are Baidu-Pan-only).

Fine-tuned model: meet0326/vehicle-reid-500-finetuned — the actual
Phase 1 output (500-vehicle probe fine-tune, mixed/honest result, see
docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md). This is the model
currently deployed in vehicle-detection's API by default
(VEHICLE_REID_MODEL_PATH). Without this fetch, a fresh clone only has
the untrained base model — a materially different, worse system than
what's actually running in production.
"""
import os
from huggingface_hub import hf_hub_download

BASE_MODEL_REPO = "occurra/vehicle_vit_clip_reid"
BASE_MODEL_FILENAME = "vehicle_vit_clip_reid.onnx"

FINETUNED_MODEL_REPO = "meet0326/vehicle-reid-500-finetuned"
FINETUNED_MODEL_FILES = [
    "vehicle_vit_clip_reid_finetuned.onnx",       # graph, small
    "vehicle_vit_clip_reid_finetuned.onnx.data",  # external weights, ~330MB — both files required
]


def fetch_model(dest_dir: str) -> str:
    """
    Downloads the Phase 0 base ONNX checkpoint into dest_dir if not
    already present. Returns the full path to the .onnx file. Idempotent
    — re-running with the same dest_dir does not re-download.
    """
    os.makedirs(dest_dir, exist_ok=True)
    local_path = hf_hub_download(
        repo_id=BASE_MODEL_REPO,
        filename=BASE_MODEL_FILENAME,
        local_dir=dest_dir,
    )
    return local_path


def fetch_finetuned_model(dest_dir: str) -> str:
    """
    Downloads the Phase 1 fine-tuned model (both the .onnx graph and its
    .onnx.data external weights file — the model won't load without
    both) into dest_dir if not already present. Returns the path to the
    .onnx file. Idempotent, same as fetch_model.
    """
    os.makedirs(dest_dir, exist_ok=True)
    onnx_path = None
    for filename in FINETUNED_MODEL_FILES:
        local_path = hf_hub_download(
            repo_id=FINETUNED_MODEL_REPO,
            filename=filename,
            local_dir=dest_dir,
        )
        if filename.endswith(".onnx"):
            onnx_path = local_path
    return onnx_path


if __name__ == "__main__":
    default_dest = os.path.join(os.path.dirname(__file__), "..", "models")

    base_path = fetch_model(default_dest)
    print(f"Base model ready at: {base_path}")

    finetuned_path = fetch_finetuned_model(default_dest)
    print(f"Fine-tuned model ready at: {finetuned_path}")
