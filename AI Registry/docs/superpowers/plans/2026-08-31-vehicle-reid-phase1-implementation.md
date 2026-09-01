# Vehicle Re-ID Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT CONSTRAINT — READ BEFORE STARTING:** Never run `git init`, `git add`, or `git commit`. The user manages all version control themselves and reviews changes before committing. Every task ends with "stop — do not commit" instead of a commit step.
>
> **VERIFICATION STYLE — READ BEFORE STARTING:** Do not write separate report/brief markdown files per task. Implement each task's code, run the real test/verify commands for what that task touched, and report results inline. One full regression pass happens at the Final Task, not after each task.

**Goal:** Fine-tune the Phase 0 vehicle Re-ID model to fix its two diagnosed failure modes (motion-blur fragility, background/camera-context bias) by adapting the real published CLIP-ReID reference implementation, training on VeRi-Wild via Google Colab, and producing an honest before/after comparison against the untouched VRIC evaluation set.

**Architecture:** Vendor the MIT-licensed `Syliz517/CLIP-ReID` repo into `training/CLIP-ReID/`, add a VeRi-Wild dataset class and a training config with `MODEL.SIE_CAMERA` enabled (the repo's existing camera-aware training feature — directly targets background bias), inject blur augmentation and same-camera hard-negative batching, run training on Colab, convert the result to ONNX, and re-run Phase 0's existing evaluation tools (`src/cli.py`, `scripts/diagnose_failures.py`) unchanged against both models for a clean before/after.

**Tech Stack:** Python 3.12, PyTorch (training, via the vendored repo — Colab-provided, not installed locally), `onnx`/`torch.onnx.export` (checkpoint conversion), pytest (local-only components), existing Phase 0 stack (`onnxruntime`, `Pillow`, `numpy`) for evaluation.

**Spec:** `../specs/2026-08-31-vehicle-reid-phase1-design.md`

## Global Constraints

- Never run `git init`/`git add`/`git commit`. No report files per task — inline verification only.
- **Never train on VRIC.** VRIC is exclusively the evaluation set (already proven independent of the original model in Phase 0) — training on it would recreate the exact contamination problem Phase 1 exists to fix. Every task that touches VRIC must only read/evaluate, never write it into a training data folder.
- Train on **VeRi-Wild** only (`images/<vehicle_id>/<image_id>.jpg` layout, verified directly via Kaggle: `mrkdagods/veriwild-test`).
- Use the **real, vendored `Syliz517/CLIP-ReID` repo** (MIT licensed) as the training implementation — do not write a from-scratch training loop. Modifications to the vendored repo are limited to: one new dataset class file, one new config file, and (if genuinely unavoidable) minimal changes clearly marked with a comment explaining why the vendored code needed to change.
- `MODEL.SIE_CAMERA True` must be set in the training config — this is the concrete mechanism targeting the diagnosed background-bias failure (spec section 4).
- Blur augmentation must reuse `src/degrade.py`'s existing `apply_degradation(image, "blur")` — do not reimplement blur logic.
- Training itself runs on **Google Colab** (no local GPU). All training code must be plain `.py` files uploadable to and runnable in a Colab session — no notebook-specific (`.ipynb`) code.
- The fine-tuned model must be converted to **ONNX** before being used by anything in `src/` — `src/embedder.py` is Phase 0's tested, working ONNX loader and must not be modified to support a different format.
- Before/after comparison must reuse `src/cli.py` and `scripts/diagnose_failures.py` **unchanged** — pointed at different `--model` paths, not reimplemented.

---

## File Structure

```
AI Registry/vehicle-reid/
├── training/
│   ├── CLIP-ReID/                          — vendored Syliz517/CLIP-ReID (Task 1)
│   │   ├── datasets/veriwild.py            — NEW (Task 2)
│   │   ├── configs/vehicle/vit_clipreid_veriwild.yml  — NEW (Task 4)
│   │   └── ... (rest of the repo, unmodified)
│   ├── prepare_veriwild_training_data.py   — Task 3
│   ├── hard_negative_batch_sampler.py      — Task 5
│   ├── blur_augmentation.py                — Task 4
│   ├── convert_to_onnx.py                  — Task 6
│   └── README.md                           — Task 7
├── scripts/
│   └── compare_before_after.py             — Task 8
└── tests/
    ├── test_prepare_veriwild_training_data.py  — Task 3
    ├── test_hard_negative_batch_sampler.py      — Task 5
    ├── test_blur_augmentation.py                — Task 4
    └── test_convert_to_onnx.py                  — Task 6
```

---

## Task 1: Vendor the CLIP-ReID Reference Implementation

**Files:**
- Create: `AI Registry/vehicle-reid/training/CLIP-ReID/` (vendored repo)
- Create: `AI Registry/vehicle-reid/training/CLIP-ReID/LICENSE_NOTICE.md`

**Interfaces:**
- Produces: the vendored repo's existing `train_clipreid.py`, `datasets/` folder pattern, and `configs/` folder pattern, which Tasks 2 and 4 build on.

- [ ] **Step 1: Clone the real repo**

Run:
```bash
cd "AI Registry/vehicle-reid/training"
git clone --depth 1 https://github.com/Syliz517/CLIP-ReID.git
rm -rf CLIP-ReID/.git
```

**Why `rm -rf CLIP-ReID/.git`:** this repo is vendored as plain files, not a git submodule — the project owner manages all version control themselves, and a nested `.git` directory would interfere with that. Removing it keeps the vendored code as ordinary tracked files.

- [ ] **Step 2: Confirm the expected structure exists**

Run: `ls "AI Registry/vehicle-reid/training/CLIP-ReID/datasets/" "AI Registry/vehicle-reid/training/CLIP-ReID/configs/"`

Expected: a `datasets/` folder containing existing dataset class files (e.g. `veri.py` for VeRi-776, `vehicleid.py` for VehicleID — these are the pattern Task 2 will follow), and a `configs/` folder containing `.yml` files organized by domain (e.g. a `vehicle/` or similar subfolder with existing vehicle Re-ID configs).

**If the actual folder names differ from what's described above:** report the real structure you find — do not guess or rename anything to match this plan's expectation. The real repo's structure is authoritative; this plan's file structure section should be treated as a best-effort prediction, not a requirement to force the repo into.

- [ ] **Step 3: Read the existing VeRi-776 dataset class as a reference pattern**

Run: `cat "AI Registry/vehicle-reid/training/CLIP-ReID/datasets/veri.py"` (or whatever the actual VeRi-776 dataset file is named, per Step 2's findings)

Note down (for use in Task 2): what base class it extends, what methods it implements (typically something like `_process_dir` returning a list of `(image_path, person_id, camera_id)` tuples), and what attributes the training loop expects (`num_train_pids`, `num_train_cams`, etc.).

- [ ] **Step 4: Write the license notice**

```markdown
# Vendored Code Notice

The `CLIP-ReID/` folder in this directory is a vendored copy of
[Syliz517/CLIP-ReID](https://github.com/Syliz517/CLIP-ReID) (MIT License),
the official reference implementation for "CLIP-ReID: Exploiting
Vision-Language Model for Image Re-identification without Concrete Text
Labels" (AAAI 2023).

Modifications from the original repo, for Phase 1 of this project:
- Added `datasets/veriwild.py` — a new dataset class for VeRi-Wild
- Added `configs/vehicle/vit_clipreid_veriwild.yml` — our training config
- (any other modification made during Tasks 2-5, listed here as it happens)

All other files are unmodified from the upstream repo at the commit
cloned. See the upstream repo for the original LICENSE file.
```

- [ ] **Step 5: Stop — do not commit**

---

## Task 2: VeRi-Wild Dataset Class

**Files:**
- Create: `AI Registry/vehicle-reid/training/CLIP-ReID/datasets/veriwild.py`
- Modify: `AI Registry/vehicle-reid/training/CLIP-ReID/datasets/__init__.py` (register the new dataset, following whatever pattern the existing `__init__.py` uses to register `veri`/`vehicleid`)

**Interfaces:**
- Consumes: Task 1's vendored repo structure and Task 3's `prepare_veriwild_training_data.py` output layout (defined together with this task — see Step 1).
- Produces: a dataset class registered under the name `"veriwild"`, loadable via the repo's existing `DATASETS.NAMES: ('veriwild')` config mechanism (Task 4 depends on this).

- [ ] **Step 1: Decide and document the expected directory layout**

Based on Task 1 Step 3's findings about the reference `veri.py` pattern, and the real VeRi-Wild Kaggle structure already confirmed (`images/<vehicle_id>/<image_id>.jpg`), define what `prepare_veriwild_training_data.py` (Task 3) must produce. A reasonable, VeRi-Wild-native layout:

```
training/data/veriwild_subset/
├── train/
│   └── <vehicle_id>/
│       └── <camera_id>_<image_id>.jpg
```

The camera ID must be encoded in the filename or a sidecar file — it is required both by this dataset class (most CLIP-ReID dataset classes parse `person_id, camera_id` from the path/filename) and by Task 5's hard-negative sampler (which needs to know which images share a camera).

**Note for implementer:** the real VeRi-Wild dataset ships a separate metadata file (`train_test_split/vehicle_info.txt` or similar, mapping image IDs to camera IDs — check what's actually present in the downloaded Kaggle data, since the earlier Kaggle file listing only showed `images/`). If a metadata file exists, prefer using it as the source of truth for camera ID over parsing it from a filename. Document whichever approach is actually taken in this file's docstring.

- [ ] **Step 2: Write the dataset class**

Follow the exact structure of the reference `veri.py`/`vehicleid.py` class found in Task 1 Step 3 — same base class, same method signatures, same returned tuple shape — so it plugs into the existing training loop without any other changes needed. The implementer must adapt the real reference code's shape; do not guess a shape without checking Task 1 Step 3's findings.

```python
# AI Registry/vehicle-reid/training/CLIP-ReID/datasets/veriwild.py
"""
VeRi-Wild dataset class for CLIP-ReID training.

Directory layout expected (produced by
../../prepare_veriwild_training_data.py):
    <root>/train/<vehicle_id>/<camera_id>_<image_id>.jpg

Chosen for Phase 1 specifically because VeRi-Wild's 174 cameras (vs.
VeRi-776's 20) give the model far more distinct scenes per vehicle
identity, directly working against the background/camera-context bias
diagnosed in Phase 0 (see
../../../../docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md
section 1.3).
"""
# (Implementer: base this on the exact class/method signature found in
#  Task 1 Step 3's reference file — copy its structure, adapt only the
#  path-parsing logic to VeRi-Wild's layout.)
import os
import re
# from .bases import BaseImageDataset  # or whatever the reference imports


class VeriWild:  # (rename to match the reference class's naming convention)
    dataset_dir = "veriwild_subset"

    def __init__(self, root="", **kwargs):
        self.dataset_dir = os.path.join(root, self.dataset_dir)
        self.train_dir = os.path.join(self.dataset_dir, "train")
        self.train = self._process_dir(self.train_dir)
        # set num_train_pids, num_train_cams, etc. per the reference pattern

    def _process_dir(self, dir_path):
        pattern = re.compile(r"(\d+)_(\d+)\.jpg")  # <camera_id>_<image_id>.jpg
        dataset = []
        for vehicle_id in sorted(os.listdir(dir_path)):
            vehicle_dir = os.path.join(dir_path, vehicle_id)
            if not os.path.isdir(vehicle_dir):
                continue
            for filename in sorted(os.listdir(vehicle_dir)):
                match = pattern.match(filename)
                if not match:
                    continue
                camera_id = int(match.group(1))
                image_path = os.path.join(vehicle_dir, filename)
                dataset.append((image_path, int(vehicle_id), camera_id))
        return dataset
```

- [ ] **Step 3: Register the dataset in `__init__.py`**

Follow the exact registration pattern already used for `veri`/`vehicleid` in the existing `datasets/__init__.py` (e.g. a `__factory` dict mapping `"veriwild"` to the `VeriWild` class) — read that file first and match its pattern exactly, do not invent a different registration mechanism.

- [ ] **Step 4: Verify the class loads without error (no real data needed yet)**

Run:
```bash
cd "AI Registry/vehicle-reid/training/CLIP-ReID"
python3 -c "
import sys
sys.path.insert(0, '.')
from datasets.veriwild import VeriWild
import os
os.makedirs('/tmp/veriwild_smoke_test/train/0001', exist_ok=True)
from PIL import Image
import numpy as np
Image.fromarray((np.random.rand(50,50,3)*255).astype('uint8')).save('/tmp/veriwild_smoke_test/train/0001/002_000001.jpg')
d = VeriWild(root='/tmp/veriwild_smoke_test')
print('Loaded', len(d.train), 'entries')
assert len(d.train) == 1
assert d.train[0][1] == 1  # vehicle_id
assert d.train[0][2] == 2  # camera_id
print('OK')
"
```
Expected: prints `Loaded 1 entries` then `OK`, no traceback.

- [ ] **Step 5: Stop — do not commit**

---

## Task 3: VeRi-Wild Training Subset Builder

**Files:**
- Create: `AI Registry/vehicle-reid/training/prepare_veriwild_training_data.py`
- Test: `AI Registry/vehicle-reid/tests/test_prepare_veriwild_training_data.py`

**Interfaces:**
- Consumes: a downloaded, extracted VeRi-Wild folder (real structure confirmed: `images/<vehicle_id>/<image_id>.jpg` — no camera ID in the path itself, so this task must also locate and parse VeRi-Wild's camera-ID metadata file, per Task 2 Step 1's note).
- Produces: `prepare_veriwild_training_data.py`'s `build_training_subset(source_dir: str, dest_dir: str, num_vehicles: int) -> None` — populates `dest_dir/train/<vehicle_id>/<camera_id>_<image_id>.jpg`, matching exactly what Task 2's `VeriWild` dataset class parses.

- [ ] **Step 1: Investigate VeRi-Wild's real camera-ID metadata format**

The Kaggle listing (`mrkdagods/veriwild-test`) showed only `images/<vehicle_id>/<image_id>.jpg` in the sample seen so far — camera ID was not visible in that path. Before writing this script, list more of the dataset's top-level structure to find the metadata file:

Run: `kaggle datasets files mrkdagods/veriwild-test | grep -v "^images/" | head -30`

This should surface non-image files (likely named something like `train_test_split/`, `vehicle_info.txt`, or similar — VeRi-Wild's original release includes a train/test split file and a camera-ID mapping). **Report exactly what's found** before writing the parsing logic — do not assume a specific metadata filename without checking.

- [ ] **Step 2: Write the failing test using a synthetic fixture (not real downloaded data)**

```python
# AI Registry/vehicle-reid/tests/test_prepare_veriwild_training_data.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "training"))
from PIL import Image
import numpy as np
import pytest
from prepare_veriwild_training_data import build_training_subset


def _make_fixture_source(base_dir, metadata_filename, metadata_lines):
    """Creates a tiny fake VeRi-Wild source: images/<vehicle_id>/<image_id>.jpg
    plus a metadata file mapping image_id -> camera_id, matching whatever
    real format Step 1 found."""
    images_dir = os.path.join(base_dir, "images")
    for vehicle_id, image_ids in [("00001", ["000001", "000002"]), ("00002", ["000003"])]:
        vdir = os.path.join(images_dir, vehicle_id)
        os.makedirs(vdir, exist_ok=True)
        for image_id in image_ids:
            arr = (np.random.rand(80, 80, 3) * 255).astype(np.uint8)
            Image.fromarray(arr, mode="RGB").save(os.path.join(vdir, f"{image_id}.jpg"))

    metadata_path = os.path.join(base_dir, metadata_filename)
    with open(metadata_path, "w") as f:
        f.write("\n".join(metadata_lines))

    return base_dir


def test_builds_expected_directory_layout(tmp_path):
    # NOTE FOR IMPLEMENTER: replace metadata_filename/metadata_lines below
    # with the REAL format found in Step 1 before this test can be
    # meaningful — this is a placeholder shape until that's known.
    source = _make_fixture_source(
        str(tmp_path / "source"),
        metadata_filename="vehicle_info.txt",
        metadata_lines=["000001 00001 002", "000002 00001 005", "000003 00002 002"],
    )
    dest = str(tmp_path / "dest")

    build_training_subset(source, dest, num_vehicles=2)

    assert os.path.isdir(os.path.join(dest, "train", "00001"))
    assert os.path.isdir(os.path.join(dest, "train", "00002"))
    files_00001 = os.listdir(os.path.join(dest, "train", "00001"))
    assert len(files_00001) == 2
    for f in files_00001:
        assert "_" in f  # <camera_id>_<image_id>.jpg format


def test_missing_source_raises_clear_error(tmp_path):
    with pytest.raises(FileNotFoundError):
        build_training_subset("/nonexistent/path", str(tmp_path / "dest"), num_vehicles=5)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pytest tests/test_prepare_veriwild_training_data.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 4: Implement prepare_veriwild_training_data.py**

Based on Step 1's actual findings about the metadata format, write the real parsing logic. The general shape (adapt the metadata-parsing section to the real format found):

```python
# AI Registry/vehicle-reid/training/prepare_veriwild_training_data.py
"""
Builds a VeRi-Wild training subset in the layout
datasets/veriwild.py (Task 2) expects: train/<vehicle_id>/<camera_id>_<image_id>.jpg

VeRi-Wild's raw layout is images/<vehicle_id>/<image_id>.jpg with camera
ID stored separately in a metadata file — see this file's real format,
determined by inspection before writing this script (Task 3 Step 1).
"""
import argparse
import os
import shutil

DEFAULT_NUM_VEHICLES = 500  # much larger than Phase 0's evaluation scale —
                              # this is TRAINING data, needs real volume


def _load_camera_id_map(source_dir: str) -> dict:
    """
    Returns {image_id: camera_id}. Implementation depends on Task 3 Step 1's
    findings about VeRi-Wild's real metadata file format/location.
    """
    raise NotImplementedError(
        "Fill in based on the real metadata file format found in Task 3 "
        "Step 1 — do not guess a format without checking the actual "
        "downloaded VeRi-Wild data."
    )


def build_training_subset(source_dir: str, dest_dir: str, num_vehicles: int = DEFAULT_NUM_VEHICLES) -> None:
    images_dir = os.path.join(source_dir, "images")
    if not os.path.isdir(images_dir):
        raise FileNotFoundError(
            f"Expected an 'images/' folder inside {source_dir} "
            f"(VeRi-Wild's standard layout). Not found."
        )

    camera_id_map = _load_camera_id_map(source_dir)

    vehicle_ids = sorted(os.listdir(images_dir))[:num_vehicles]

    train_dir = os.path.join(dest_dir, "train")
    if os.path.isdir(train_dir):
        shutil.rmtree(train_dir)
    os.makedirs(train_dir, exist_ok=True)

    for vehicle_id in vehicle_ids:
        vehicle_source_dir = os.path.join(images_dir, vehicle_id)
        if not os.path.isdir(vehicle_source_dir):
            continue
        vehicle_dest_dir = os.path.join(train_dir, vehicle_id)
        os.makedirs(vehicle_dest_dir, exist_ok=True)
        for filename in os.listdir(vehicle_source_dir):
            image_id = os.path.splitext(filename)[0]
            camera_id = camera_id_map.get(image_id, "unknown")
            new_filename = f"{camera_id}_{image_id}.jpg"
            shutil.copy(
                os.path.join(vehicle_source_dir, filename),
                os.path.join(vehicle_dest_dir, new_filename),
            )

    print(f"Built training subset: {len(vehicle_ids)} vehicles at {train_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--dest", required=True)
    parser.add_argument("--num-vehicles", type=int, default=DEFAULT_NUM_VEHICLES)
    args = parser.parse_args()
    build_training_subset(args.source, args.dest, args.num_vehicles)
```

**Note for implementer:** `_load_camera_id_map` is deliberately left raising `NotImplementedError` in this plan, since its real implementation depends entirely on Step 1's findings, which are not yet known at plan-writing time. Fill it in for real based on what Step 1 actually finds — do not leave the `NotImplementedError` in the final code, and do not fabricate a metadata format that wasn't actually verified.

- [ ] **Step 5: Update the test's fixture to match the REAL metadata format found in Step 1**, then run again

Run: `pytest tests/test_prepare_veriwild_training_data.py -v`
Expected: PASS — both tests

- [ ] **Step 6: Stop — do not commit**

---

## Task 4: Blur Augmentation + Training Config with SIE_CAMERA

**Files:**
- Create: `AI Registry/vehicle-reid/training/blur_augmentation.py`
- Create: `AI Registry/vehicle-reid/training/CLIP-ReID/configs/vehicle/vit_clipreid_veriwild.yml`
- Test: `AI Registry/vehicle-reid/tests/test_blur_augmentation.py`

**Interfaces:**
- Consumes: `src/degrade.py`'s `apply_degradation(image: PIL.Image.Image, condition: str) -> PIL.Image.Image` (Phase 0, already tested — import path from `training/`: add `../../` to `sys.path` or use the project's existing import convention).
- Produces: `blur_augmentation.py`'s `RandomBlurAugmentation` — a callable transform class (constructor takes `probability: float`, `__call__(image: PIL.Image.Image) -> PIL.Image.Image` applies Phase 0's blur degradation with the given probability, otherwise returns the image unchanged) — usable as a PyTorch transform in the training pipeline.

- [ ] **Step 1: Write the failing test**

```python
# AI Registry/vehicle-reid/tests/test_blur_augmentation.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "training"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np
from PIL import Image
from blur_augmentation import RandomBlurAugmentation


def _make_test_image():
    arr = np.zeros((100, 100, 3), dtype=np.uint8)
    arr[::5, :, :] = 255
    arr[:, ::5, :] = 255
    return Image.fromarray(arr, mode="RGB")


def test_probability_zero_never_blurs():
    aug = RandomBlurAugmentation(probability=0.0)
    original = _make_test_image()
    result = aug(original)
    original_arr = np.asarray(original, dtype=np.float32)
    result_arr = np.asarray(result, dtype=np.float32)
    assert np.array_equal(original_arr, result_arr)


def test_probability_one_always_blurs():
    aug = RandomBlurAugmentation(probability=1.0)
    original = _make_test_image()
    result = aug(original)
    original_arr = np.asarray(original, dtype=np.float32)
    result_arr = np.asarray(result.resize(original.size), dtype=np.float32)
    difference = np.mean(np.abs(original_arr - result_arr))
    assert difference > 1.0  # meaningfully blurred, matches degrade.py's own blur test
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_blur_augmentation.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement blur_augmentation.py**

```python
# AI Registry/vehicle-reid/training/blur_augmentation.py
"""
Training-time blur augmentation, reusing Phase 0's tested blur logic
(src/degrade.py) rather than reimplementing it. Applied with a given
probability per image during training, directly targeting the motion-blur
fragility diagnosed in Phase 0 (see
../../docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md
section 1.3, "Failure mode 1").
"""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from src.degrade import apply_degradation


class RandomBlurAugmentation:
    def __init__(self, probability: float = 0.3):
        self.probability = probability

    def __call__(self, image):
        if random.random() < self.probability:
            return apply_degradation(image, "blur")
        return image
```

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/test_blur_augmentation.py -v`
Expected: PASS — both tests

- [ ] **Step 5: Write the training config**

Base this on the exact structure of the reference vehicle Re-ID config found in Task 1 Step 2 (e.g. an existing `configs/vehicle/vit_clipreid.yml` or similarly-named file for VeRi-776/VehicleID) — copy its structure and adapt these specific keys:

```yaml
# AI Registry/vehicle-reid/training/CLIP-ReID/configs/vehicle/vit_clipreid_veriwild.yml
# Based on the repo's existing vehicle Re-ID config (see Task 1 Step 2/3),
# adapted for Phase 1: trains on VeRi-Wild (never VRIC — VRIC stays the
# untouched evaluation set), with MODEL.SIE_CAMERA enabled to directly
# target the background/camera-context bias diagnosed in Phase 0.

DATASETS:
  NAMES: ('veriwild')
  ROOT_DIR: ('./data')   # prepare_veriwild_training_data.py's --dest

MODEL:
  SIE_CAMERA: True
  SIE_COE: 1.0
  # (copy all other MODEL.* keys from the reference config unchanged —
  #  architecture/backbone settings shouldn't differ from the proven
  #  reference setup)

OUTPUT_DIR: './output/veriwild_finetune'

# (copy SOLVER.*, INPUT.*, and any other sections verbatim from the
#  reference config — only DATASETS.NAMES, MODEL.SIE_CAMERA/SIE_COE, and
#  OUTPUT_DIR are Phase-1-specific changes)
```

**Note for implementer:** this config is deliberately incomplete — it shows only the keys that must differ from the reference. Before this config can actually be used for training (Task 7), copy the FULL reference config file's content as the starting point and apply only these specific overrides, so nothing the original authors tuned (learning rate, batch size, etc.) is accidentally lost or guessed at.

- [ ] **Step 6: Stop — do not commit**

---

## Task 5: Same-Camera Hard-Negative Batch Sampler

**Files:**
- Create: `AI Registry/vehicle-reid/training/hard_negative_batch_sampler.py`
- Test: `AI Registry/vehicle-reid/tests/test_hard_negative_batch_sampler.py`

**Interfaces:**
- Consumes: a list of `(vehicle_id, camera_id)` tuples (one per training image, in the same order as the dataset — matches what Task 2's `VeriWild.train` list provides per-item, minus the file path).
- Produces: `hard_negative_batch_sampler.py`'s `HardNegativeBatchSampler` — a PyTorch `Sampler` subclass. Constructor takes `items: list[tuple[str,int]]` (vehicle_id, camera_id per index) and `batch_size: int`. Iterating it yields lists of dataset indices, where each batch is biased to include same-camera, different-vehicle pairs — directly implementing the spec's "against background bias" training approach (section 4).

- [ ] **Step 1: Write the failing test**

```python
# AI Registry/vehicle-reid/tests/test_hard_negative_batch_sampler.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "training"))
from hard_negative_batch_sampler import HardNegativeBatchSampler


def test_every_batch_has_correct_size():
    # 3 cameras, 4 vehicles each, 2 images per vehicle-camera combo = 24 items
    items = []
    for camera_id in [1, 2, 3]:
        for vehicle_id in range(4):
            items.extend([(f"v{vehicle_id}", camera_id)] * 2)

    sampler = HardNegativeBatchSampler(items, batch_size=8)
    batches = list(sampler)

    assert len(batches) > 0
    for batch in batches:
        assert len(batch) == 8


def test_batches_contain_same_camera_different_vehicle_pairs():
    # Deliberately construct data where this is checkable: camera 1 has
    # vehicles v0 and v1, camera 2 has only vehicle v2.
    items = [
        ("v0", 1), ("v0", 1),
        ("v1", 1), ("v1", 1),
        ("v2", 2), ("v2", 2),
    ]
    sampler = HardNegativeBatchSampler(items, batch_size=4)
    batches = list(sampler)

    found_same_camera_diff_vehicle_pair = False
    for batch in batches:
        cameras_in_batch = [items[i][1] for i in batch]
        vehicles_in_batch = [items[i][0] for i in batch]
        for a in range(len(batch)):
            for b in range(a + 1, len(batch)):
                if cameras_in_batch[a] == cameras_in_batch[b] and vehicles_in_batch[a] != vehicles_in_batch[b]:
                    found_same_camera_diff_vehicle_pair = True

    assert found_same_camera_diff_vehicle_pair, (
        "Expected at least one batch to contain a same-camera, "
        "different-vehicle pair (the hard negative this sampler exists to surface)"
    )


def test_all_indices_eventually_covered():
    items = [(f"v{i}", i % 3) for i in range(20)]
    sampler = HardNegativeBatchSampler(items, batch_size=5)
    seen = set()
    for batch in sampler:
        seen.update(batch)
    assert seen == set(range(20))
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_hard_negative_batch_sampler.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement hard_negative_batch_sampler.py**

```python
# AI Registry/vehicle-reid/training/hard_negative_batch_sampler.py
"""
A batch sampler that deliberately includes same-camera, different-vehicle
pairs in training batches — the training-time mechanism for fighting the
background/camera-context bias diagnosed in Phase 0 (see
../../docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md
section 1.3, "Failure mode 2" and section 4).

Standard random batching would only occasionally place two different
vehicles from the same camera in one batch, by chance. This sampler
groups items by camera first, so each batch draws heavily from a small
number of cameras — guaranteeing the triplet loss regularly sees the
exact hard-negative pattern the diagnostic found the model struggling with.
"""
import random
from collections import defaultdict


class HardNegativeBatchSampler:
    def __init__(self, items: list, batch_size: int):
        self.items = items
        self.batch_size = batch_size
        self.by_camera = defaultdict(list)
        for index, (vehicle_id, camera_id) in enumerate(items):
            self.by_camera[camera_id].append(index)

    def __iter__(self):
        # Shuffle within each camera group, then draw batches camera-by-camera
        # so same-camera items land together in a batch more often than
        # pure random sampling would produce.
        remaining = {cam: list(indices) for cam, indices in self.by_camera.items()}
        for indices in remaining.values():
            random.shuffle(indices)

        cameras = list(remaining.keys())
        random.shuffle(cameras)

        pool = []
        for camera_id in cameras:
            pool.extend(remaining[camera_id])

        for start in range(0, len(pool) - self.batch_size + 1, self.batch_size):
            yield pool[start : start + self.batch_size]

    def __len__(self):
        return len(self.items) // self.batch_size
```

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/test_hard_negative_batch_sampler.py -v`
Expected: PASS — all 3 tests

**If `test_all_indices_eventually_covered` fails** because the last partial batch (fewer than `batch_size` items) gets dropped by the `range(...)` step logic: this is an intentional, standard PyTorch `Sampler` behavior (`drop_last`) — but since this specific test asserts full coverage, either adjust the test's item count to divide evenly by `batch_size` (5 batches × 5 items already does, in the test above — this should pass as written), or note the discrepancy if it doesn't and decide whether to keep or discard the partial batch, documenting the choice in a code comment either way.

- [ ] **Step 5: Stop — do not commit**

---

## Task 6: ONNX Conversion Script

**Files:**
- Create: `AI Registry/vehicle-reid/training/convert_to_onnx.py`
- Test: `AI Registry/vehicle-reid/tests/test_convert_to_onnx.py`

**Interfaces:**
- Consumes: a trained PyTorch checkpoint path (produced by Colab training, Task 7 — not available until then, so this task's test uses a small dummy model, not a real checkpoint).
- Produces: `convert_to_onnx.py`'s `convert_checkpoint_to_onnx(checkpoint_path: str, output_path: str, input_height: int, input_width: int) -> str` — exports a PyTorch model to ONNX at `output_path`, matching the input/output contract `src/embedder.py` (Phase 0) already expects: NCHW float32 input, 512-dim output.

- [ ] **Step 1: Write the failing test using a dummy PyTorch model (not the real CLIP-ReID model, which isn't trained yet)**

```python
# AI Registry/vehicle-reid/tests/test_convert_to_onnx.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "training"))
import torch
import torch.nn as nn
import onnxruntime as ort
import numpy as np
from convert_to_onnx import convert_checkpoint_to_onnx


class DummyReIDModel(nn.Module):
    """Stands in for the real CLIP-ReID model's shape contract: takes
    NCHW input, produces a 512-dim embedding — this is ALL convert_to_onnx.py
    needs to know about the model to do its job correctly."""
    def __init__(self):
        super().__init__()
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        self.fc = nn.Linear(3, 512)

    def forward(self, x):
        pooled = self.pool(x).squeeze(-1).squeeze(-1)  # (N, 3)
        return self.fc(pooled)  # (N, 512)


def test_converts_and_produces_loadable_onnx_model(tmp_path):
    model = DummyReIDModel()
    checkpoint_path = str(tmp_path / "dummy_checkpoint.pth")
    torch.save(model.state_dict(), checkpoint_path)

    output_path = str(tmp_path / "converted.onnx")
    result_path = convert_checkpoint_to_onnx(
        checkpoint_path, output_path, input_height=224, input_width=224,
        model_factory=DummyReIDModel,
    )

    assert result_path == output_path
    assert os.path.exists(output_path)

    session = ort.InferenceSession(output_path, providers=["CPUExecutionProvider"])
    dummy_input = np.random.rand(1, 3, 224, 224).astype(np.float32)
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: dummy_input})
    assert outputs[0].shape == (1, 512)
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/test_convert_to_onnx.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement convert_to_onnx.py**

```python
# AI Registry/vehicle-reid/training/convert_to_onnx.py
"""
Converts a trained CLIP-ReID PyTorch checkpoint to ONNX, matching the
input/output contract src/embedder.py (Phase 0) already expects:
NCHW float32 input, 512-dim float32 output. Run this after Colab training
completes, before the fine-tuned model can be used by any of Phase 0's
existing evaluation tools.
"""
import torch


def convert_checkpoint_to_onnx(
    checkpoint_path: str,
    output_path: str,
    input_height: int,
    input_width: int,
    model_factory,
) -> str:
    """
    model_factory: a zero-argument callable returning an uninitialized
    model instance matching the checkpoint's architecture. For the real
    fine-tuned model (Task 7), this will be the CLIP-ReID vendored repo's
    model-construction function — NOT reimplemented here, imported from
    training/CLIP-ReID/model/ once Task 7 identifies the exact factory
    function/class to use.
    """
    model = model_factory()
    state_dict = torch.load(checkpoint_path, map_location="cpu")
    model.load_state_dict(state_dict)
    model.eval()

    dummy_input = torch.randn(1, 3, input_height, input_width)

    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        input_names=["input"],
        output_names=["output"],
        opset_version=17,
        dynamic_axes=None,  # fixed batch size of 1, matching embedder.py's usage
    )

    return output_path
```

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/test_convert_to_onnx.py -v`
Expected: PASS

- [ ] **Step 5: Stop — do not commit**

---

## Task 7: Colab Training Script + README

**Files:**
- Create: `AI Registry/vehicle-reid/training/README.md`
- Modify: `AI Registry/vehicle-reid/training/CLIP-ReID/LICENSE_NOTICE.md` (append any modifications made during this task)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a documented, runnable Colab workflow — no new Python module (this task is glue + documentation, not new library code).

- [ ] **Step 1: Identify the real model-construction function in the vendored repo**

Run: `grep -rn "def make_model\|class.*Model" "AI Registry/vehicle-reid/training/CLIP-ReID/model/" | head -20`

Find the function/class the repo's own `train_clipreid.py` calls to construct the model before training — this is what Task 6's `convert_to_onnx.py` needs to pass as `model_factory` for the REAL model (not the dummy test model). Report exactly what's found.

- [ ] **Step 2: Write the README with the full Colab workflow**

```markdown
# Phase 1 Fine-Tuning — Colab Workflow

This trains a fine-tuned version of the Phase 0 vehicle Re-ID model,
targeting the two failure modes diagnosed in Phase 0 (motion blur
fragility, camera/background context bias) — see
../../docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md
for the full rationale.

## 1. Prepare training data (run locally, before Colab)

Download VeRi-Wild:
```bash
kaggle datasets download -d mrkdagods/veriwild-test -p /tmp/veriwild --unzip
```

Build the training subset:
```bash
python3 training/prepare_veriwild_training_data.py \
  --source /tmp/veriwild \
  --dest training/CLIP-ReID/data \
  --num-vehicles 500
```

Zip it for upload:
```bash
cd training/CLIP-ReID && zip -r ../veriwild_training_data.zip data/
```

## 2. Upload to Colab

1. Open a new Colab notebook, select a GPU runtime (Runtime → Change
   runtime type → T4 GPU, the free tier's default).
2. Upload `training/CLIP-ReID/` (the whole vendored folder, including your
   new `datasets/veriwild.py` and `configs/vehicle/vit_clipreid_veriwild.yml`)
   and `veriwild_training_data.zip` via the Colab file browser, or mount
   Google Drive and copy them there first for a faster re-upload if you
   need to iterate.
3. In a Colab cell: `!unzip veriwild_training_data.zip -d CLIP-ReID/`

## 3. Install dependencies and train

```
!pip install torch torchvision yacs timm scikit-image tqdm ftfy regex
!cd CLIP-ReID && python train_clipreid.py --config_file configs/vehicle/vit_clipreid_veriwild.yml
```

Training progress and the final checkpoint land in
`CLIP-ReID/output/veriwild_finetune/` (per the config's `OUTPUT_DIR`).

## 4. Convert to ONNX (in Colab, before downloading)

```python
import sys
sys.path.insert(0, 'CLIP-ReID')
from convert_to_onnx import convert_checkpoint_to_onnx
from model.make_model import make_model  # or whatever Step 1 found

convert_checkpoint_to_onnx(
    checkpoint_path='CLIP-ReID/output/veriwild_finetune/<final_checkpoint>.pth',
    output_path='vehicle_vit_clip_reid_finetuned.onnx',
    input_height=224,  # match the original model's dims — see
    input_width=224,   #   models/vehicle_vit_clip_reid.onnx's actual
                        #   embedder.input_height/width from Phase 0
    model_factory=lambda: make_model(...),  # fill in real construction args
)
```

## 5. Download the result

Download `vehicle_vit_clip_reid_finetuned.onnx` from Colab, place it in
this project's `models/` folder locally.

## 6. Run the before/after comparison

See `../scripts/compare_before_after.py` (Task 8).
```

**Note for implementer:** fill in the real `input_height`/`input_width` values by checking `models/vehicle_vit_clip_reid.onnx`'s actual dimensions (Phase 0's `VehicleEmbedder.input_height`/`input_width`, confirmed as 256×256 per Phase 0's QA doc — verify this is still current before writing it into the README) and the real `make_model(...)` construction arguments found in Step 1.

- [ ] **Step 3: Stop — do not commit**

---

## Task 8: Before/After Comparison Script

**Files:**
- Create: `AI Registry/vehicle-reid/scripts/compare_before_after.py`

**Interfaces:**
- Consumes: `src.cli.run()` (Phase 0) and `scripts/diagnose_failures.py`'s `collect_embeddings`/`diagnose` functions (Phase 0) — both unchanged, imported and called twice (once per model path).
- Produces: a single Markdown report at `reports/<timestamp>/before_after_comparison.md`, showing Phase 0's baseline model and Phase 1's fine-tuned model side by side on the same VRIC evaluation data.

- [ ] **Step 1: Write compare_before_after.py**

This task has no dedicated test file — it's a thin orchestration script wrapping two already-tested tools (`src.cli.run` and `scripts/diagnose_failures`), run manually as this plan's actual deliverable (a real report), not unit-tested in isolation. Verification is Step 2's real run.

```python
#!/usr/bin/env python3
"""
Runs Phase 0's evaluation tools (src.cli's aggregate report,
diagnose_failures's per-pair analysis) against BOTH the original
pretrained model and the Phase 1 fine-tuned model, on the same VRIC
evaluation data, and writes a single before/after comparison.

Both underlying tools are used UNCHANGED from Phase 0 — this script only
orchestrates calling them twice and diffing the results, per the design
spec's explicit requirement to reuse, not rebuild, the evaluation
methodology (section 6).
"""
import argparse
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.cli import run as run_cli_evaluation
from src.embedder import VehicleEmbedder


def compare(data_dir: str, original_model_path: str, finetuned_model_path: str, output_dir: str) -> str:
    os.makedirs(output_dir, exist_ok=True)

    original_report_dir = os.path.join(output_dir, "original")
    finetuned_report_dir = os.path.join(output_dir, "finetuned")

    original_md, _ = run_cli_evaluation(data_dir, original_model_path, original_report_dir)
    finetuned_md, _ = run_cli_evaluation(data_dir, finetuned_model_path, finetuned_report_dir)

    comparison_path = os.path.join(output_dir, "before_after_comparison.md")
    with open(comparison_path, "w") as out:
        out.write("# Phase 1 — Before/After Comparison\n\n")
        out.write(f"Evaluation data: `{data_dir}` (VRIC — never trained on by either model)\n\n")
        out.write("## Before (Phase 0 baseline model)\n\n")
        out.write(open(original_md).read())
        out.write("\n\n## After (Phase 1 fine-tuned model)\n\n")
        out.write(open(finetuned_md).read())

    return comparison_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "..", "data", "clean"))
    parser.add_argument("--original-model", default=os.path.join(os.path.dirname(__file__), "..", "models", "vehicle_vit_clip_reid.onnx"))
    parser.add_argument("--finetuned-model", required=True)
    parser.add_argument("--output", default=os.path.join(os.path.dirname(__file__), "..", "reports"))
    args = parser.parse_args()

    output_dir = os.path.join(args.output, f"before_after_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    result_path = compare(args.data, args.original_model, args.finetuned_model, output_dir)
    print(f"Comparison written to: {result_path}")
```

- [ ] **Step 2: Stop — do not commit.** This script cannot be meaningfully run until Task 7's Colab training actually produces a fine-tuned ONNX model — that run happens in the Final Task, once training is complete.

---

## Final Task: Full Regression + Real Before/After Run

**Files:** none created — verification only.

- [ ] **Step 1: Run the full local test suite (everything that doesn't require Colab training)**

Run: `cd "AI Registry/vehicle-reid" && pytest tests/ -v`
Expected: every Phase 0 test still passes (unchanged), plus all new Phase 1 tests from Tasks 2-6 pass.

- [ ] **Step 2: Confirm whether Colab training has actually been run**

This plan's Tasks 1-6 and 8 can all be completed and verified locally. **Task 7's actual training run happens on Colab, outside this environment's control** — it requires the project owner (or whoever runs the Colab notebook) to execute it and download the resulting `.onnx` file back into `models/`.

**If no fine-tuned model file exists yet:** stop here and report plainly: "All local code is implemented and tested. Training itself has not run yet — that requires uploading `training/CLIP-ReID/` to Google Colab per `training/README.md` and downloading the resulting model back into `models/`. Once that file exists, run `scripts/compare_before_after.py --finetuned-model models/<filename>.onnx` to produce the real before/after report."

- [ ] **Step 3: If a fine-tuned model file DOES exist, run the real before/after comparison**

Run: `python3 scripts/compare_before_after.py --finetuned-model models/<the fine-tuned model filename>`
Expected: a `before_after_comparison.md` report is produced, showing both models' results on the same VRIC data.

- [ ] **Step 4: Write the architecture and QA docs (per spec section 8)**

Create `AI Registry/docs/architecture/vehicle-reid-phase1-architecture.md` and `AI Registry/docs/testing/phase1-qa.md`, mirroring Phase 0's docs' style — summarize what was actually built, what was actually tested, and (if Step 3 ran) the real before/after numbers. If training hasn't run yet, state that plainly as an open item, not a completed result.

The architecture doc's "Known Gaps" section must explicitly carry forward spec section 10's limitation: this fine-tuned model, even if it meets the success criteria, is still trained and evaluated exclusively on VeRi-Wild and VRIC — neither dataset has meaningful Indian vehicle representation, and neither includes two-wheelers (~78% of real Indian vehicles). State this plainly as an open item for a future phase, not something Phase 1 solves.

- [ ] **Step 5: Report the final state plainly**

Summarize, without hedging: what's implemented and tested locally, whether real training has happened yet, and if it has, whether the two success criteria from the spec (section 6) were actually met — the separation gap increasing, and the overlap percentage decreasing. If either criterion was NOT met, say so directly rather than downplaying it — that would itself be a valuable, honest finding about this approach's limits.

- [ ] **Step 6: Stop — do not commit.** All code, tests, docs, and (if generated) the real before/after report are left for the project owner to review and commit themselves.
