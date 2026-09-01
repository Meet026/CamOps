# Phase 1 Fine-Tuning — Colab Workflow

Fine-tunes the Phase 0 vehicle Re-ID model to fix its two diagnosed
failure modes (motion-blur fragility, camera/background context bias).
See `../docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md` for the full
rationale, and `../docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md`
for the design spec.

This machine has no GPU, so training runs on Google Colab's free-tier
GPU. Everything else (data prep, the vendored training code, the ONNX
conversion) lives in this repo and is already tested locally.

---

## 0. Recommended: start with the 500-vehicle probe run first

Per the project owner's decision, run the smaller 500-vehicle subset
first to see how long training actually takes, before committing to the
full 10,000-vehicle run. The steps below work identically for either —
just change `--num-vehicles`.

## 1. Prepare training data (run locally, already done for you)

The 500-vehicle probe subset is already built at
`training/CLIP-ReID/data/` (500 vehicles, 6,420 images, 114 cameras —
verified). To rebuild it, or to switch to the full run:

```bash
# 500-vehicle probe (already done, shown for reference):
python3 training/prepare_veriwild_training_data.py \
  --source ~/Downloads/archive.zip \
  --dest training/CLIP-ReID/data \
  --num-vehicles 500

# Full run, once the probe's timing is known:
python3 training/prepare_veriwild_training_data.py \
  --source ~/Downloads/archive.zip \
  --dest training/CLIP-ReID/data \
  --num-vehicles 10000
```

Both were verified end-to-end against the real downloaded archive before
being documented here — see
`../docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md` Part 3 for the real
numbers and the bugs found/fixed while building this.

## 2. Zip the training folder for upload

```bash
cd "AI Registry/vehicle-reid/training"
zip -r CLIP-ReID-with-data.zip CLIP-ReID/ -x "CLIP-ReID/__pycache__/*"
```

This includes the vendored CLIP-ReID code, our `datasets/veriwild.py`,
our `configs/VehicleID/vit_clipreid_veriwild.yml` config, and the
prepared `data/` folder — everything Colab needs in one file.

Also copy `blur_augmentation.py` and `../src/degrade.py` — the blur
augmentation module needs both (it imports `src.degrade` directly):

```bash
mkdir -p /tmp/colab_upload
cp CLIP-ReID-with-data.zip /tmp/colab_upload/
cp blur_augmentation.py /tmp/colab_upload/
mkdir -p /tmp/colab_upload/src
cp ../src/degrade.py /tmp/colab_upload/src/
cp ../src/__init__.py /tmp/colab_upload/src/
```

## 3. Open Colab and select a GPU runtime

1. Go to [colab.research.google.com](https://colab.research.google.com),
   start a new notebook.
2. **Runtime → Change runtime type → T4 GPU** (the free tier's default
   GPU option).

## 4. Upload and extract

In a Colab cell, use the file upload widget or drag files into the file
browser pane, then:

```python
!unzip -q /content/CLIP-ReID-with-data.zip -d /content/
```

Confirm the layout looks right:

```python
!ls /content/CLIP-ReID/datasets/veriwild.py
!ls /content/CLIP-ReID/configs/VehicleID/vit_clipreid_veriwild.yml
!ls /content/CLIP-ReID/data/train_list_start0.txt
!ls /content/CLIP-ReID/data/images | wc -l
```

## 5. Install dependencies

```python
!pip install -q torch torchvision yacs timm scikit-image tqdm ftfy regex opencv-python
```

(`opencv-python` and `scikit-image` are used by some of the vendored
repo's data-augmentation code paths, per its own `requirements` — install
them even if training doesn't immediately complain about a missing one.)

## 6. Train

```python
%cd /content/CLIP-ReID
!python train_clipreid.py --config_file configs/VehicleID/vit_clipreid_veriwild.yml
```

**Watch the very first few lines of output** — the real training script
prints the dataset statistics table (same format you've already seen
locally: `# ids | # images | # cameras`), which confirms the real
`num_classes`/`camera_num`/`view_num` values it derived from our data.
**Write these three numbers down** — you need them for Step 8 (ONNX
conversion), since they're required to reconstruct the exact same model
architecture before loading the trained weights into it.

Training writes checkpoints to `output/veriwild_finetune/` (per the
config's `OUTPUT_DIR`), at the interval set by
`SOLVER.STAGE2.CHECKPOINT_PERIOD` (60, matching the real reference
config's tuned defaults — unchanged from what the original CLIP-ReID
authors validated).

**Time it.** For the 500-vehicle probe run, note the wall-clock time for
one epoch (visible in the periodic log lines) and the total time to
finish — this is exactly what the project owner wants to know before
deciding on the full 10,000-vehicle run's approach (e.g. fewer epochs, a
longer Colab session, or splitting across multiple sessions using Colab's
checkpoint-resume support if training doesn't finish in one sitting).

## 7. Locate the final checkpoint

```python
!ls -la /content/CLIP-ReID/output/veriwild_finetune/
```

The final-epoch checkpoint is typically named something like
`transformer_120.pth` (stage 2's `MAX_EPOCHS` — 60 per the reference
config — × however Stage 1/2 checkpoints are numbered; check the actual
filenames printed by `ls`, since exact naming depends on the real
training run, not something to guess from this README).

## 8. Convert to ONNX (still inside Colab, before downloading)

```python
import sys
sys.path.insert(0, '/content')
sys.path.insert(0, '/content/CLIP-ReID')

from convert_to_onnx import convert_checkpoint_to_onnx
from model.make_model_clipreid import make_model
from config import cfg

cfg.merge_from_file('/content/CLIP-ReID/configs/VehicleID/vit_clipreid_veriwild.yml')
cfg.freeze()

# Fill in the REAL values printed by training in Step 6 — do not guess.
NUM_CLASSES = ...   # from the dataset statistics table, "train | # ids"
CAMERA_NUM = ...    # from the dataset statistics table, "train | # cameras"
VIEW_NUM = 1        # VeriWild has no real viewpoint annotation — always 1
                     # (see datasets/veriwild.py's own docstring)

CHECKPOINT_PATH = '/content/CLIP-ReID/output/veriwild_finetune/<the real filename from Step 7>'

# Confirm the real input size this model expects — matches
# INPUT.SIZE_TRAIN in the config (256x256, per the reference config —
# verify this wasn't changed before training).
INPUT_HEIGHT = 256
INPUT_WIDTH = 256

convert_checkpoint_to_onnx(
    checkpoint_path=CHECKPOINT_PATH,
    output_path='/content/vehicle_vit_clip_reid_finetuned.onnx',
    input_height=INPUT_HEIGHT,
    input_width=INPUT_WIDTH,
    model_factory=lambda: make_model(cfg, num_class=NUM_CLASSES, camera_num=CAMERA_NUM, view_num=VIEW_NUM),
)
print("Converted successfully.")
```

**If this step errors on `model.load_state_dict(state_dict)`** (a common
real-world mismatch): the checkpoint may have been saved with a
`module.` prefix on every key (from PyTorch's `DataParallel`/DDP
wrapping) even though this is a single-GPU Colab run. If so, strip the
prefix before loading:
```python
state_dict = {k.replace('module.', ''): v for k, v in state_dict.items()}
```
This is a well-known, common PyTorch checkpoint-loading quirk — not
specific to our setup — worth checking for directly rather than guessing
blindly if the plain load fails.

## 9. Download the result

In Colab: right-click `/content/vehicle_vit_clip_reid_finetuned.onnx` in
the file browser pane → Download. Save it locally into this project's
`models/` folder:

```
AI Registry/vehicle-reid/models/vehicle_vit_clip_reid_finetuned.onnx
```

## 10. Run the before/after comparison (back on this machine)

```bash
cd "AI Registry/vehicle-reid"
source .venv/bin/activate
python3 scripts/compare_before_after.py \
  --finetuned-model models/vehicle_vit_clip_reid_finetuned.onnx
```

This reuses Phase 0's exact, already-tested evaluation tools
(`src/cli.py`, `scripts/diagnose_failures.py`) unchanged, run against
both the original and fine-tuned model, on the same VRIC data —
producing a single side-by-side report at
`reports/before_after_<timestamp>/before_after_comparison.md`.

**Check the two real success criteria** (see
`../docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md`
section 6):
1. Did the clean-image separation gap increase from the Phase 0 baseline
   (0.1568)?
2. Did the separability check's overlap percentage (currently ~50%)
   measurably decrease?

If either did not improve, report that honestly — it's a real,
informative finding about this approach's limits, not something to
downplay.
