"""
Tests for the VeriWild dataset class (training/CLIP-ReID/datasets/veriwild.py).

Requires torch (from the 'training' optional dependency group) since the
vendored CLIP-ReID repo's bases.py imports torch.utils.data.Dataset.
"""
import os
import shutil
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "..", "training", "CLIP-ReID")
)

torch = pytest.importorskip("torch")
from datasets.veriwild import VeriWild  # noqa: E402


def _make_fixture_dataset(root):
    os.makedirs(os.path.join(root, "images", "00001"), exist_ok=True)
    os.makedirs(os.path.join(root, "images", "00002"), exist_ok=True)

    for vehicle_id, image_ids in [("00001", ["000001", "000002"]), ("00002", ["000003"])]:
        for image_id in image_ids:
            arr = (np.random.rand(60, 60, 3) * 255).astype(np.uint8)
            Image.fromarray(arr, mode="RGB").save(
                os.path.join(root, "images", vehicle_id, f"{image_id}.jpg")
            )

    with open(os.path.join(root, "train_list_start0.txt"), "w") as f:
        f.write("00001/000001.jpg 0 23\n")
        f.write("00001/000002.jpg 0 41\n")
        f.write("00002/000003.jpg 1 23\n")

    with open(os.path.join(root, "test_3000_id.txt"), "w") as f:
        f.write("00001/000001.jpg 0 23\n")

    with open(os.path.join(root, "test_3000_id_query.txt"), "w") as f:
        f.write("00001/000002.jpg 0 41\n")

    return root


def test_loads_train_split_with_correct_pid_and_camid(tmp_path):
    root = _make_fixture_dataset(str(tmp_path))
    dataset = VeriWild(root=root, verbose=False)

    assert len(dataset.train) == 3
    paths = {os.path.basename(p) for p, _, _, _ in dataset.train}
    assert paths == {"000001.jpg", "000002.jpg", "000003.jpg"}

    entry = next(e for e in dataset.train if os.path.basename(e[0]) == "000001.jpg")
    _, pid, camid, viewid = entry
    assert pid == 0
    assert camid == 23
    assert viewid == 1  # constant placeholder — no real viewpoint data exists


def test_loads_query_and_gallery_splits(tmp_path):
    root = _make_fixture_dataset(str(tmp_path))
    dataset = VeriWild(root=root, verbose=False)

    assert len(dataset.gallery) == 1
    assert len(dataset.query) == 1


def test_missing_train_list_raises_clear_error(tmp_path):
    root = str(tmp_path)
    os.makedirs(os.path.join(root, "images"), exist_ok=True)
    # deliberately omit train_list_start0.txt
    with open(os.path.join(root, "test_3000_id.txt"), "w") as f:
        f.write("")
    with open(os.path.join(root, "test_3000_id_query.txt"), "w") as f:
        f.write("")

    with pytest.raises(RuntimeError):
        VeriWild(root=root, verbose=False)


def test_missing_images_dir_raises_clear_error(tmp_path):
    root = str(tmp_path)
    # no images/ dir at all
    with open(os.path.join(root, "train_list_start0.txt"), "w") as f:
        f.write("")
    with open(os.path.join(root, "test_3000_id.txt"), "w") as f:
        f.write("")
    with open(os.path.join(root, "test_3000_id_query.txt"), "w") as f:
        f.write("")

    with pytest.raises(RuntimeError):
        VeriWild(root=root, verbose=False)
