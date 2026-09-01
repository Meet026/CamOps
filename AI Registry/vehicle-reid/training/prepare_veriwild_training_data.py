#!/usr/bin/env python3
"""
Builds a VeRi-Wild training subset in the layout
datasets/veriwild.py (CLIP-ReID) expects, extracted directly from the
downloaded archive.zip (no need to fully extract all 138,525 files).

IMPORTANT — real data source, confirmed by direct inspection, not
assumed: the Kaggle mirror we have access to (mrkdagods/veriwild-test)
contains ONLY the images for VeRi-Wild's official TEST split (the
3000/5000/10000-identity evaluation sets the original authors held out),
NOT the 30,671-vehicle official TRAINING split. Verified: zero overlap
between train_list_start0.txt's vehicle IDs and the images actually
present in this archive; full overlap with test_10000_id.txt's vehicle
IDs. The official training split is only distributed via Baidu Pan,
gated behind a password "released when the challenge begins" — not
currently publicly accessible (same dead end as Phase 0's PVEN weights).

This is a DELIBERATE, informed choice, not an oversight: the train/test
label is the original authors' own convention for benchmarking against
each other's papers — it does not matter for OUR goal, which is only
"don't fine-tune on data the model has already been trained on" (VeRi-776).
VeRi-Wild's test split satisfies that just as well as its train split
would — the model has seen neither. So this script uses
test_10000_id.txt (10,000 vehicles, 128,517 images, 174 cameras) as our
actual training source, honestly named as such below rather than
pretending it's the official "train" split.

Real file format, verified directly against the downloaded archive:

    archive.zip contains, at its top level:
      images/<vehicle_id>/<image_id>.jpg      (sparse — only the ~10,000
                                                 test-split vehicle IDs are
                                                 actually present, despite
                                                 train_list_start0.txt also
                                                 being included in the zip)
      test_10000_id.txt / test_10000_id_query.txt   "<vid>/<img>.jpg <pid> <camid>"
      test_3000_id.txt / test_3000_id_query.txt     same format, smaller subset
      train_list_start0.txt                    present in the zip, but its
                                                 listed images are NOT in
                                                 this archive — unused here
      vehicle_info.txt                         per-image brand/type/color
                                                 metadata (not needed —
                                                 camera ID is already in
                                                 the split files directly)

This script selects a subset of vehicle identities from test_10000_id.txt
and extracts ONLY those specific image files from the zip — not the whole
8.2GB archive — into training/CLIP-ReID/data/{train_list_start0.txt,
test_3000_id.txt, test_3000_id_query.txt, images/}, matching exactly what
datasets/veriwild.py's VeriWild class reads. (Output is still written to
a file literally named train_list_start0.txt, since that's the filename
datasets/veriwild.py's VeriWild class expects for its TRAIN split — the
source data came from test_10000_id.txt, but its role in OUR pipeline is
"the data we train on".)
"""
import argparse
import os
import zipfile
from collections import defaultdict

DEFAULT_NUM_VEHICLES = 500  # much larger than Phase 0's evaluation scale —
                              # this is TRAINING data, needs real volume


def _parse_split_file(zf: zipfile.ZipFile, filename: str) -> list:
    """Returns [(relative_path, pid, camid), ...] parsed from a VeRi-Wild
    split file inside the zip (train_list_start0.txt / test_*_id*.txt)."""
    with zf.open(filename) as f:
        lines = f.read().decode("utf-8").splitlines()
    entries = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        relative_path, pid_str, camid_str = line.split(" ")
        entries.append((relative_path, int(pid_str), int(camid_str)))
    return entries


def build_training_subset(source_zip: str, dest_dir: str, num_vehicles: int = DEFAULT_NUM_VEHICLES) -> None:
    if not os.path.exists(source_zip):
        raise FileNotFoundError(
            f"Source VeRi-Wild archive not found: {source_zip}\n"
            f"Download it from "
            f"https://www.kaggle.com/datasets/mrkdagods/veriwild-test "
            f"and pass its path (the .zip file) as --source."
        )

    os.makedirs(dest_dir, exist_ok=True)
    dest_images_dir = os.path.join(dest_dir, "images")
    os.makedirs(dest_images_dir, exist_ok=True)

    with zipfile.ZipFile(source_zip, "r") as zf:
        # Defensive: even though test_10000_id.txt has confirmed full
        # overlap with this archive's images/ (unlike train_list_start0.txt,
        # which does not — see this file's module docstring), still guard
        # against any individual missing file rather than assume perfect
        # consistency. Skip-and-report, per this project's established
        # error-handling convention (Phase 0's spec section 7) — never
        # crash the whole extraction over one missing file.
        archive_names = set(zf.namelist())

        # Source: test_10000_id.txt (VeRi-Wild's "test" split) — this
        # archive does not contain the official training split's images
        # at all. See this file's module docstring for why using the test
        # split is a deliberate, correct choice for our purposes.
        train_entries = _parse_split_file(zf, "test_10000_id.txt")

        by_vehicle = defaultdict(list)
        for relative_path, pid, camid in train_entries:
            vehicle_id = relative_path.split("/")[0]
            by_vehicle[vehicle_id].append((relative_path, pid, camid))

        # Only consider a vehicle "available" if at least one of its listed
        # images actually exists in this archive.
        available_vehicle_ids = sorted(
            vid
            for vid, entries in by_vehicle.items()
            if any(f"images/{p}" in archive_names for p, _, _ in entries)
        )
        selected_vehicle_ids = available_vehicle_ids[:num_vehicles]
        if len(selected_vehicle_ids) < num_vehicles:
            print(
                f"Warning: requested {num_vehicles} vehicles, but only "
                f"{len(available_vehicle_ids)} have at least one image "
                f"actually present in this archive (of {len(by_vehicle)} "
                f"listed in test_10000_id.txt). Using all "
                f"{len(selected_vehicle_ids)}."
            )

        # RELABEL PIDs to a contiguous 0..N-1 range for THIS subset.
        #
        # Real bug found and fixed here (2026-09-01, from an actual Colab
        # training crash): VeRi-Wild's original PIDs are vehicle IDs from
        # the FULL 10,000-vehicle test split (e.g. 5, 1969, ...) — sparse,
        # not contiguous, and not bounded by however many vehicles WE
        # select for a subset. CLIP-ReID's PromptLearner builds a learned
        # embedding table sized exactly `num_classes` (= our subset's
        # vehicle count), and indexes into it directly using the raw PID
        # as a label. A PID like 1969 in a 500-vehicle subset is a
        # massively out-of-bounds embedding lookup on GPU — this is
        # exactly what caused "CUDA error: device-side assert triggered"
        # in model/make_model_clipreid.py's PromptLearner during Stage 1.
        # The reference VeRi/VehicleID dataset classes already do this
        # relabeling themselves (their own pid2label dicts) — VeRi-Wild's
        # split files come pre-relabeled for the FULL dataset, but not
        # for an arbitrary subset of it, which is what we need here.
        selected_pids_in_order = sorted(
            {by_vehicle[vid][0][1] for vid in selected_vehicle_ids}
        )
        pid_to_new_label = {
            original_pid: new_label
            for new_label, original_pid in enumerate(selected_pids_in_order)
        }

        # SAME relabeling requirement applies to camera IDs, for the exact
        # same reason — found from a SECOND real Colab crash (2026-09-01),
        # after the PID fix above resolved the first one. CLIP-ReID's
        # SIE_CAMERA feature (model/make_model_clipreid.py) builds a
        # learned per-camera embedding table sized exactly `camera_num`
        # (= however many UNIQUE cameras appear in our subset — read from
        # dataset.num_train_cams at training time) and indexes it directly
        # with the raw camera ID (`self.cv_embed[cam_label]`). VeRi-Wild's
        # real camera IDs in a given subset are sparse (e.g. this exact
        # 500-vehicle subset has camera IDs from 2 to 173, but only 114
        # UNIQUE values among them) — a raw camid of 173 against a
        # 114-slot table is the same class of out-of-bounds GPU index
        # crash as the PID bug, just in SIE_CAMERA's embedding instead of
        # PromptLearner's.
        selected_camids_in_order = sorted(
            {
                camid
                for vehicle_id in selected_vehicle_ids
                for _, _, camid in by_vehicle[vehicle_id]
            }
        )
        camid_to_new_label = {
            original_camid: new_label
            for new_label, original_camid in enumerate(selected_camids_in_order)
        }

        selected_train_lines = []
        skipped_missing_files = []
        for vehicle_id in selected_vehicle_ids:
            for relative_path, pid, camid in by_vehicle[vehicle_id]:
                archive_path = f"images/{relative_path}"
                if archive_path not in archive_names:
                    skipped_missing_files.append(relative_path)
                    continue
                zf.extract(archive_path, dest_dir)
                new_pid = pid_to_new_label[pid]
                new_camid = camid_to_new_label[camid]
                selected_train_lines.append(f"{relative_path} {new_pid} {new_camid}")

        if skipped_missing_files:
            print(
                f"Skipped {len(skipped_missing_files)} listed images not "
                f"actually present in the archive (first 5: "
                f"{skipped_missing_files[:5]})"
            )

        with open(os.path.join(dest_dir, "train_list_start0.txt"), "w") as f:
            f.write("\n".join(selected_train_lines) + "\n")

        # test_3000_id / test_3000_id_query are needed by VeriWild's
        # constructor (query/gallery), but Phase 1 never evaluates on
        # VeRi-Wild's own test split — VRIC is the real evaluation set
        # (see spec section 3). Only a tiny valid stub is needed here to
        # satisfy the dataset class's file-existence checks; nothing reads
        # its actual accuracy numbers.
        #
        # PREFERRED: draw the stub from a vehicle NOT selected for
        # training (test_3000_id.txt's images are a confirmed subset of
        # test_10000_id.txt's, so this is usually possible) — avoids any
        # training image doubling as the stub, on principle.
        #
        # FALLBACK: if num_vehicles is large enough that every candidate
        # vehicle ends up selected for training (e.g. num_vehicles=10000,
        # using the whole dataset), no non-training vehicle exists to draw
        # a stub from. Since this stub's accuracy is never actually
        # evaluated or reported by Phase 1, reusing one already-selected
        # training image here is a deliberate, safe choice — NOT a
        # regression of the leakage protection above, which still applies
        # whenever a non-training vehicle is available.
        gallery_entries = _parse_split_file(zf, "test_3000_id.txt")
        query_entries = _parse_split_file(zf, "test_3000_id_query.txt")

        selected_vehicle_id_set = set(selected_vehicle_ids)
        non_training_gallery = [
            e
            for e in gallery_entries
            if f"images/{e[0]}" in archive_names
            and e[0].split("/")[0] not in selected_vehicle_id_set
        ]
        non_training_query = [
            e
            for e in query_entries
            if f"images/{e[0]}" in archive_names
            and e[0].split("/")[0] not in selected_vehicle_id_set
        ]

        if non_training_gallery and non_training_query:
            stub_gallery = non_training_gallery[:1]
            stub_query = non_training_query[:1]
        elif selected_train_lines:
            print(
                "Note: every candidate vehicle was selected for training "
                "(num_vehicles is large enough to exhaust available "
                "vehicles) — reusing one training image as the internal "
                "gallery/query stub. This stub is never actually "
                "evaluated by Phase 1 (VRIC is the real evaluation set), "
                "so this is safe."
            )
            # Pick from selected_train_lines — the CONFIRMED-extracted,
            # actually-present training entries (already-extracted to
            # disk above) — never from by_vehicle directly, which still
            # contains vehicles whose images turned out to be missing
            # from the archive (see the skip-missing-files handling
            # above). Picking from by_vehicle here was a real bug: it
            # could select an entry with no real image file.
            relative_path, pid_str, camid_str = selected_train_lines[0].split(" ")
            fallback_entry = (relative_path, int(pid_str), int(camid_str))
            stub_gallery = [fallback_entry]
            stub_query = [fallback_entry]
        else:
            raise RuntimeError(
                "No vehicles with any actual image in the archive were "
                "found at all — cannot build any dataset, training or stub."
            )

        for relative_path, _, _ in stub_gallery + stub_query:
            archive_path = f"images/{relative_path}"
            dest_path = os.path.join(dest_dir, archive_path)
            if not os.path.exists(dest_path):  # may already be extracted as a training image
                zf.extract(archive_path, dest_dir)

        with open(os.path.join(dest_dir, "test_3000_id.txt"), "w") as f:
            f.write("\n".join(f"{p} {pid} {c}" for p, pid, c in stub_gallery) + "\n")
        with open(os.path.join(dest_dir, "test_3000_id_query.txt"), "w") as f:
            f.write("\n".join(f"{p} {pid} {c}" for p, pid, c in stub_query) + "\n")

    print(
        f"Built training subset: {len(selected_vehicle_ids)} vehicles, "
        f"{len(selected_train_lines)} images at {dest_dir}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Path to the downloaded archive.zip")
    parser.add_argument("--dest", required=True, help="Destination folder (e.g. training/CLIP-ReID/data)")
    parser.add_argument("--num-vehicles", type=int, default=DEFAULT_NUM_VEHICLES)
    args = parser.parse_args()
    build_training_subset(args.source, args.dest, args.num_vehicles)
