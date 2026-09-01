import io
import os
import sys
import zipfile

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "training"))
from prepare_veriwild_training_data import build_training_subset


def _make_image_bytes():
    arr = (np.random.rand(40, 40, 3) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="JPEG")
    return buf.getvalue()


def _make_fixture_zip(zip_path):
    """
    Builds a tiny fake VeRi-Wild archive.zip matching the REAL confirmed
    layout of the downloaded Kaggle mirror (mrkdagods/veriwild-test):
    images/<vid>/<img>.jpg + test_10000_id.txt/test_3000_id*.txt in the
    "<path> <pid> <camid>" format. train_list_start0.txt is included in
    the real archive too, but its listed images are NOT present — this
    script uses test_10000_id.txt as the actual training source (see the
    module docstring in prepare_veriwild_training_data.py for why).
    """
    with zipfile.ZipFile(zip_path, "w") as zf:
        for vehicle_id, images in [
            ("00001", ["000001", "000002"]),
            ("00002", ["000003"]),
            ("00003", ["000004"]),  # reserved for the gallery/query stub —
                                     # never selected for training in these
                                     # tests, so it's always available
        ]:
            for image_id in images:
                zf.writestr(f"images/{vehicle_id}/{image_id}.jpg", _make_image_bytes())

        # Present in the real archive but unused by this script (its
        # listed images aren't actually in images/) — included here too,
        # to mirror the real archive's structure faithfully.
        zf.writestr("train_list_start0.txt", "09999/999999.jpg 5 12\n")

        zf.writestr(
            "test_10000_id.txt",
            "00001/000001.jpg 0 23\n00001/000002.jpg 0 41\n00002/000003.jpg 1 23\n"
            "00003/000004.jpg 2 88\n",
        )
        zf.writestr("test_3000_id.txt", "00003/000004.jpg 2 88\n")
        zf.writestr("test_3000_id_query.txt", "00003/000004.jpg 2 88\n")

    return zip_path


def test_extracts_only_selected_vehicles(tmp_path):
    zip_path = _make_fixture_zip(str(tmp_path / "archive.zip"))
    dest = str(tmp_path / "dest")

    build_training_subset(zip_path, dest, num_vehicles=1)

    with open(os.path.join(dest, "train_list_start0.txt")) as f:
        lines = [l for l in f.read().splitlines() if l]
    assert len(lines) == 2  # only vehicle 00001's 2 images, not vehicle 00002's
    assert all(line.startswith("00001/") for line in lines)
    assert os.path.exists(os.path.join(dest, "images", "00001", "000001.jpg"))
    assert not os.path.exists(os.path.join(dest, "images", "00002"))


def test_output_pids_and_camids_are_relabeled_to_contiguous_ranges(tmp_path):
    """
    REGRESSION TEST for TWO REAL bugs that each crashed an actual Colab
    training run with "CUDA error: device-side assert triggered", one
    right after the other:

    1. PID bug (found first): CLIP-ReID's PromptLearner
       (model/make_model_clipreid.py) builds a learned embedding table
       sized exactly num_classes (our subset's vehicle count) and indexes
       into it using the raw PID as a label. VeRi-Wild's original PIDs
       are sparse, arbitrary vehicle-ID numbers (e.g. 1969 in a 500-vehicle
       subset) — a massively out-of-bounds embedding lookup.

    2. Camera ID bug (found second, immediately after fixing #1 alone
       wasn't enough): CLIP-ReID's SIE_CAMERA feature builds a SEPARATE
       learned embedding table sized exactly camera_num (however many
       UNIQUE cameras appear in our subset) and indexes it directly with
       the raw camera ID (`self.cv_embed[cam_label]`). The REAL 500-vehicle
       subset had camera IDs ranging 2-173 but only 114 unique values
       among them — camid=173 against a 114-slot table is the same class
       of out-of-bounds crash, just in a different embedding table.

    Both fields need the exact same fix: relabel to a contiguous 0..N-1
    range for whatever subset was actually selected, regardless of the
    source values' original range or sparsity.
    """
    zip_path = str(tmp_path / "archive.zip")
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("images/00001/000001.jpg", _make_image_bytes())
        zf.writestr("images/00002/000002.jpg", _make_image_bytes())
        zf.writestr("images/00003/000003.jpg", _make_image_bytes())
        zf.writestr("images/00004/000004.jpg", _make_image_bytes())  # stub reserve

        # Deliberately sparse, non-contiguous, out-of-order PIDs AND
        # camera IDs — the real-world shape of both bugs, not
        # coincidentally-safe 0,1,2 values.
        zf.writestr(
            "test_10000_id.txt",
            "00001/000001.jpg 5 173\n"
            "00002/000002.jpg 1969 41\n"
            "00003/000003.jpg 823 173\n"  # shares camera 173 with vehicle 1 —
                                            # only 2 UNIQUE camids among the 3
                                            # training entries (173, 41), but
                                            # the raw values go up to 173
            "00004/000004.jpg 42 88\n",
        )
        zf.writestr("test_3000_id.txt", "00004/000004.jpg 42 88\n")
        zf.writestr("test_3000_id_query.txt", "00004/000004.jpg 42 88\n")

    dest = str(tmp_path / "dest")

    # Select all 3 real training vehicles (00001, 00002, 00003) —
    # num_vehicles=3 leaves 00004 available for the stub.
    build_training_subset(zip_path, dest, num_vehicles=3)

    with open(os.path.join(dest, "train_list_start0.txt")) as f:
        lines = [l for l in f.read().splitlines() if l]

    output_pids = sorted(int(line.split(" ")[1]) for line in lines)
    output_camids = sorted(set(int(line.split(" ")[2]) for line in lines))

    # Bug #1: this would previously be [5, 823, 1969] instead of [0, 1, 2].
    assert output_pids == [0, 1, 2], (
        f"Expected relabeled PIDs to be a contiguous [0, 1, 2], got "
        f"{output_pids} — PIDs are not being relabeled, which would crash "
        f"real training with an out-of-bounds embedding lookup in "
        f"PromptLearner."
    )

    # Bug #2: this would previously be [41, 173] (2 unique values, but with
    # a max of 173) instead of a clean, contiguous [0, 1] (2 unique values,
    # max 1 — safely indexable into a camera_num=2 embedding table).
    assert output_camids == [0, 1], (
        f"Expected relabeled camera IDs to be a contiguous [0, 1] (2 "
        f"unique cameras among the 3 training entries), got "
        f"{output_camids} — camera IDs are not being relabeled, which "
        f"would crash real training with an out-of-bounds embedding "
        f"lookup in SIE_CAMERA's cv_embed."
    )


def test_extracts_all_available_when_num_vehicles_exceeds_supply(tmp_path):
    """
    When num_vehicles is large enough to select every candidate vehicle
    for training (leaving none available for a non-overlapping
    gallery/query stub — e.g. the real num_vehicles=10000 case, using the
    entire archive), this must NOT crash — it falls back to reusing one
    training image as the stub, which is safe since that stub is never
    actually evaluated by Phase 1 (VRIC is the real evaluation set).
    """
    zip_path = _make_fixture_zip(str(tmp_path / "archive.zip"))
    dest = str(tmp_path / "dest")

    # Must not raise — should build a valid dataset using the fallback path.
    build_training_subset(zip_path, dest, num_vehicles=100)

    with open(os.path.join(dest, "train_list_start0.txt")) as f:
        lines = [l for l in f.read().splitlines() if l]
    assert len(lines) == 4  # all 3 vehicles' images (2 + 1 + 1)
    assert os.path.exists(os.path.join(dest, "test_3000_id.txt"))
    assert os.path.exists(os.path.join(dest, "test_3000_id_query.txt"))


def test_produces_valid_gallery_and_query_stub_files(tmp_path):
    zip_path = _make_fixture_zip(str(tmp_path / "archive.zip"))
    dest = str(tmp_path / "dest")

    # Select only vehicle 00001 for training, leaving 00002/00003
    # available for the gallery/query stub.
    build_training_subset(zip_path, dest, num_vehicles=1)

    assert os.path.exists(os.path.join(dest, "test_3000_id.txt"))
    assert os.path.exists(os.path.join(dest, "test_3000_id_query.txt"))


def test_missing_source_raises_clear_error(tmp_path):
    with pytest.raises(FileNotFoundError):
        build_training_subset("/nonexistent/archive.zip", str(tmp_path / "dest"), num_vehicles=5)


def test_skips_split_entries_missing_from_archive_without_crashing(tmp_path):
    """
    Regression test for a REAL bug found against the actual downloaded
    VeRi-Wild mirror: test_10000_id.txt CAN list images not actually
    present in images/ (defensive handling, even though full overlap was
    confirmed for the real archive) — must be skipped and reported, never
    crash the whole extraction (the original bug was an unhandled KeyError).
    """
    zip_path = str(tmp_path / "archive.zip")
    with zipfile.ZipFile(zip_path, "w") as zf:
        # Only vehicle 00002's image actually exists in the archive...
        zf.writestr("images/00002/000003.jpg", _make_image_bytes())

        # ...but the split file also lists vehicle 00001, which has NO
        # corresponding image file in this archive at all.
        zf.writestr(
            "test_10000_id.txt",
            "00001/000001.jpg 0 23\n00001/000002.jpg 0 41\n00002/000003.jpg 1 23\n",
        )
        zf.writestr("test_3000_id.txt", "00002/000003.jpg 1 23\n")
        zf.writestr("test_3000_id_query.txt", "00002/000003.jpg 1 23\n")

    dest = str(tmp_path / "dest")

    # Must not raise KeyError (the original bug). Vehicle 00002 is the
    # only one with a real image, gets selected for training, and (since
    # it's the only vehicle available at all) also becomes the fallback
    # gallery/query stub — expected, not an error.
    build_training_subset(zip_path, dest, num_vehicles=5)

    with open(os.path.join(dest, "train_list_start0.txt")) as f:
        lines = [l for l in f.read().splitlines() if l]
    assert len(lines) == 1
    assert lines[0].startswith("00002/")
    assert not os.path.exists(os.path.join(dest, "images", "00001"))


def test_gallery_query_stub_prefers_non_training_vehicle_when_available(tmp_path):
    """
    Regression test for a REAL leakage risk found by inspection:
    test_3000_id.txt's images are a confirmed SUBSET of test_10000_id.txt's
    images (the same source used for training) — a naive stub pick could
    select a vehicle already used in training. When a non-training vehicle
    IS available, the stub must prefer it over reusing a training image.
    """
    zip_path = str(tmp_path / "archive.zip")
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("images/00001/000001.jpg", _make_image_bytes())
        zf.writestr("images/00002/000002.jpg", _make_image_bytes())

        zf.writestr(
            "test_10000_id.txt",
            "00001/000001.jpg 0 23\n00002/000002.jpg 1 41\n",
        )
        # test_3000_id.txt lists BOTH vehicles as gallery candidates —
        # vehicle 00001 (which WILL be selected for training below) and
        # vehicle 00002 (which will NOT be) — the stub must prefer 00002.
        zf.writestr(
            "test_3000_id.txt", "00001/000001.jpg 0 23\n00002/000002.jpg 1 41\n"
        )
        zf.writestr(
            "test_3000_id_query.txt",
            "00001/000001.jpg 0 23\n00002/000002.jpg 1 41\n",
        )

    dest = str(tmp_path / "dest")

    # num_vehicles=1 selects only vehicle 00001 for training, leaving
    # vehicle 00002 available and preferred for the stub.
    build_training_subset(zip_path, dest, num_vehicles=1)

    with open(os.path.join(dest, "test_3000_id.txt")) as f:
        stub_line = f.read().strip()
    assert stub_line.startswith("00002/"), (
        f"Expected the stub to prefer non-training vehicle 00002, got: {stub_line!r}"
    )


def test_gallery_query_stub_falls_back_to_training_reuse_when_exhausted(tmp_path):
    """
    When num_vehicles selects every available vehicle for training (no
    non-training vehicle left at all — the real num_vehicles=10000 case),
    the stub must fall back to reusing a training image rather than crash.
    This is safe because Phase 1 never actually evaluates this internal
    stub (VRIC is the real evaluation set).
    """
    zip_path = str(tmp_path / "archive.zip")
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("images/00001/000001.jpg", _make_image_bytes())

        zf.writestr("test_10000_id.txt", "00001/000001.jpg 0 23\n")
        zf.writestr("test_3000_id.txt", "00001/000001.jpg 0 23\n")
        zf.writestr("test_3000_id_query.txt", "00001/000001.jpg 0 23\n")

    dest = str(tmp_path / "dest")

    # The only vehicle gets selected for training AND reused as the stub.
    build_training_subset(zip_path, dest, num_vehicles=1)

    with open(os.path.join(dest, "test_3000_id.txt")) as f:
        assert f.read().strip().startswith("00001/")


def test_output_loadable_by_veriwild_dataset_class(tmp_path):
    """End-to-end: prepare_veriwild_training_data's output must be directly
    loadable by datasets/veriwild.py's VeriWild class — this is the real
    contract between the two, verified here rather than assumed."""
    torch = pytest.importorskip("torch")
    sys.path.insert(
        0, os.path.join(os.path.dirname(__file__), "..", "training", "CLIP-ReID")
    )
    from datasets.veriwild import VeriWild

    zip_path = _make_fixture_zip(str(tmp_path / "archive.zip"))
    dest = str(tmp_path / "dest")
    # Select only vehicle 00001 for training so vehicle 00002 remains
    # available for a valid, non-overlapping gallery/query stub.
    build_training_subset(zip_path, dest, num_vehicles=1)

    dataset = VeriWild(root=dest, verbose=False)
    assert len(dataset.train) == 2
