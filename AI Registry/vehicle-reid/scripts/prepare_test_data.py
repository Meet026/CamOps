#!/usr/bin/env python3
"""
Populates data/clean/ with a small subset of the VeRi-776 dataset, grouped
by vehicle identity, for Phase 0's same-vehicle-vs-different-vehicle test.

Source: https://www.kaggle.com/datasets/abhyudaya12/veri-vehicle-re-identification-dataset
(a mirror of the original VeRi-776 dataset: https://github.com/JDAI-CV/VeRidataset)

This script does NOT download the dataset itself — download it manually
via the Kaggle web UI or `kaggle datasets download`, extract it locally,
and pass the extracted image folder as --source.

VeRi-776 filenames encode the vehicle ID as the first 4 digits (e.g.
"0002_c002_00030600_0.jpg" -> vehicle_id "0002"), which is what this
script parses to do the grouping. If the Kaggle mirror's folder structure
differs from this (e.g. images nested under train/test/query
subdirectories rather than one flat folder), pass the specific subfolder
that directly contains the .jpg files as --source.
"""
import argparse
import os
import shutil
from collections import defaultdict

DEFAULT_NUM_MULTI_IMAGE_VEHICLES = 30
MIN_MULTI_IMAGE_VEHICLES = 3
IMAGES_PER_MULTI_VEHICLE = 3


def parse_vehicle_id(filename: str) -> str:
    # VeRi-776 filenames: "<vehicle_id>_<camera_id>_<frame>_<index>.jpg"
    return filename.split("_")[0]


def build_subset(source_dir: str, dest_dir: str, num_vehicles: int = DEFAULT_NUM_MULTI_IMAGE_VEHICLES) -> None:
    if not os.path.isdir(source_dir):
        raise FileNotFoundError(
            f"Source VeRi-776 folder not found: {source_dir}\n"
            f"Download it from "
            f"https://www.kaggle.com/datasets/abhyudaya12/veri-vehicle-re-identification-dataset "
            f"(or https://github.com/JDAI-CV/VeRidataset), extract it, and "
            f"pass the folder that directly contains the .jpg files as --source."
        )

    by_vehicle = defaultdict(list)
    for filename in os.listdir(source_dir):
        if not filename.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        vehicle_id = parse_vehicle_id(filename)
        by_vehicle[vehicle_id].append(filename)

    if not by_vehicle:
        raise ValueError(
            f"No image files found directly in {source_dir}. If the "
            f"downloaded dataset has images nested in a subfolder (e.g. "
            f"'image_train/' or 'image_test/'), pass that subfolder as "
            f"--source instead."
        )

    multi_image_ids = sorted(vid for vid, files in by_vehicle.items() if len(files) >= 2)

    if len(multi_image_ids) < MIN_MULTI_IMAGE_VEHICLES:
        raise ValueError(
            f"Source folder only has {len(multi_image_ids)} vehicles with "
            f"multiple images; need at least {MIN_MULTI_IMAGE_VEHICLES}. "
            f"Found {len(by_vehicle)} vehicle IDs total — check that "
            f"parse_vehicle_id() matches this dataset's actual filename format."
        )

    actual_count = min(num_vehicles, len(multi_image_ids))
    if actual_count < num_vehicles:
        print(
            f"Warning: requested {num_vehicles} vehicles, but the source only "
            f"has {len(multi_image_ids)} with multiple images. Using all {actual_count}."
        )
    selected = multi_image_ids[:actual_count]

    # Clear any stale identities from a previous run so the folder always
    # reflects exactly this run's selection — otherwise leftover vehicle_id
    # folders from an earlier, differently-sized run would silently mix in.
    if os.path.isdir(dest_dir):
        shutil.rmtree(dest_dir)
    os.makedirs(dest_dir, exist_ok=True)

    for vehicle_id in selected:
        vehicle_dest = os.path.join(dest_dir, vehicle_id)
        os.makedirs(vehicle_dest, exist_ok=True)
        for filename in by_vehicle[vehicle_id][:IMAGES_PER_MULTI_VEHICLE]:
            shutil.copy(
                os.path.join(source_dir, filename),
                os.path.join(vehicle_dest, filename),
            )

    print(f"Prepared {len(selected)} vehicle identities (all multi-image) at {dest_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", required=True, help="Path to an extracted VeRi-776 image folder"
    )
    parser.add_argument(
        "--dest",
        default=os.path.join(os.path.dirname(__file__), "..", "data", "clean"),
        help="Destination folder (default: data/clean/). Cleared and rebuilt on each run.",
    )
    parser.add_argument(
        "--num-vehicles",
        type=int,
        default=DEFAULT_NUM_MULTI_IMAGE_VEHICLES,
        help=f"How many multi-image vehicle identities to include (default: {DEFAULT_NUM_MULTI_IMAGE_VEHICLES})",
    )
    args = parser.parse_args()
    build_subset(args.source, args.dest, args.num_vehicles)
