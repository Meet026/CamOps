#!/usr/bin/env python3
"""
Populates data/clean/ with a subset of the VRIC dataset, grouped by
vehicle identity, for Phase 0's same-vehicle-vs-different-vehicle test.

WHY VRIC INSTEAD OF VERI-776: the Phase 0 model (occurra/vehicle_vit_clip_reid)
was TRAINED on VeRi-776. Testing it on VeRi-776 images — even the dataset's
own held-out query/test split — measures how well the model performs on
data from the same distribution it was trained on, not genuine real-world
generalization. This is a data leakage / train-test contamination concern,
correctly raised by the project owner after reviewing Phase 0's first
result. VRIC is a completely separate, independent dataset the model has
never been trained on, making it a much more honest test of whether the
model's learned "vehicle similarity" concept actually generalizes.

Source: https://www.kaggle.com/datasets/starkking07/vehicle-reidentification-in-context
(a mirror of the original VRIC dataset, referenced in the research doc's
list of public vehicle Re-ID datasets)

This script does NOT download the dataset itself — download it manually
via `kaggle datasets download -d starkking07/vehicle-reidentification-in-context`,
extract it, and pass the folder containing the per-identity subfolders
(e.g. ".../vric/") as --source.

Structure (verified directly, unlike VeRi-776's filename-encoded IDs):
one subfolder per vehicle identity, named by numeric ID, e.g.
"vric/1050/MVI_20033_002_img00120.jpg" -> vehicle_id "1050". This is
SIMPLER and less error-prone than VeRi-776's filename-prefix parsing —
no ambiguity about where the ID boundary is.
"""
import argparse
import os
import shutil

DEFAULT_NUM_VEHICLES = 30
MIN_VEHICLES = 3
IMAGES_PER_VEHICLE = 3


def build_subset(source_dir: str, dest_dir: str, num_vehicles: int = DEFAULT_NUM_VEHICLES) -> None:
    if not os.path.isdir(source_dir):
        raise FileNotFoundError(
            f"Source VRIC folder not found: {source_dir}\n"
            f"Download it via: kaggle datasets download -d "
            f"starkking07/vehicle-reidentification-in-context, extract it, "
            f"and pass the folder containing per-identity subfolders (e.g. "
            f".../vric/) as --source."
        )

    identity_dirs = sorted(
        d for d in os.listdir(source_dir)
        if os.path.isdir(os.path.join(source_dir, d))
    )
    if not identity_dirs:
        raise ValueError(
            f"No identity subfolders found directly in {source_dir}. "
            f"Check that you passed the folder containing per-vehicle "
            f"subfolders (e.g. the 'vric/' folder), not its parent."
        )

    multi_image_ids = []
    for identity in identity_dirs:
        identity_path = os.path.join(source_dir, identity)
        images = [
            f for f in os.listdir(identity_path)
            if f.lower().endswith((".jpg", ".jpeg", ".png"))
        ]
        if len(images) >= 2:
            multi_image_ids.append((identity, images))

    if len(multi_image_ids) < MIN_VEHICLES:
        raise ValueError(
            f"Source folder only has {len(multi_image_ids)} identities with "
            f"multiple images; need at least {MIN_VEHICLES}."
        )

    actual_count = min(num_vehicles, len(multi_image_ids))
    if actual_count < num_vehicles:
        print(
            f"Warning: requested {num_vehicles} vehicles, but the source only "
            f"has {len(multi_image_ids)} with multiple images. Using all {actual_count}."
        )
    selected = multi_image_ids[:actual_count]

    # Clear any stale identities from a previous run (e.g. the earlier
    # VeRi-776-based subset) so data/clean/ always reflects exactly this
    # run's selection, never a mix of two different sources.
    if os.path.isdir(dest_dir):
        shutil.rmtree(dest_dir)
    os.makedirs(dest_dir, exist_ok=True)

    for identity, images in selected:
        vehicle_dest = os.path.join(dest_dir, identity)
        os.makedirs(vehicle_dest, exist_ok=True)
        for filename in images[:IMAGES_PER_VEHICLE]:
            shutil.copy(
                os.path.join(source_dir, identity, filename),
                os.path.join(vehicle_dest, filename),
            )

    print(f"Prepared {len(selected)} vehicle identities (all multi-image) at {dest_dir}")
    print("Source: VRIC (independent of VeRi-776, which the model was trained on)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", required=True, help="Path to the extracted VRIC folder (containing per-identity subfolders)"
    )
    parser.add_argument(
        "--dest",
        default=os.path.join(os.path.dirname(__file__), "..", "data", "clean"),
        help="Destination folder (default: data/clean/). Cleared and rebuilt on each run.",
    )
    parser.add_argument(
        "--num-vehicles",
        type=int,
        default=DEFAULT_NUM_VEHICLES,
        help=f"How many multi-image vehicle identities to include (default: {DEFAULT_NUM_VEHICLES})",
    )
    args = parser.parse_args()
    build_subset(args.source, args.dest, args.num_vehicles)
