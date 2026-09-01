# Vendored Code Notice

The `CLIP-ReID/` folder in this directory is a vendored copy of
[Syliz517/CLIP-ReID](https://github.com/Syliz517/CLIP-ReID) (MIT License),
the official reference implementation for "CLIP-ReID: Exploiting
Vision-Language Model for Image Re-identification without Concrete Text
Labels" (AAAI 2023).

Modifications from the original repo, for Phase 1 of this project:

- **Added** `datasets/veriwild.py` — a new dataset class for VeRi-Wild,
  following the existing `datasets/vehicleid.py` reference pattern
  (train/query/gallery split files rather than VeRi-776's
  filename-encoded/keypoint-file approach). Written against the real
  file format, verified directly against the downloaded dataset — see
  `../../docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md` for the full
  rationale.
- **Modified** `datasets/make_dataloader_clipreid.py` — added an import
  and a `'veriwild': VeriWild` entry to the existing `__factory` dict,
  following the exact registration pattern already used for `veri` and
  `VehicleID`.
- **Added** `configs/VehicleID/vit_clipreid_veriwild.yml` — our training
  config, copied verbatim from the real reference
  `configs/VehicleID/vit_clipreid.yml` and modified ONLY in three places:
  `MODEL.SIE_CAMERA`/`SIE_COE` (enabled — the real, already-implemented
  camera-aware training mechanism used to fight the background/context
  bias diagnosed in Phase 0) and `DATASETS.NAMES`/`ROOT_DIR`/`OUTPUT_DIR`
  (pointed at our VeRi-Wild data). Every hyperparameter (learning rate,
  batch size, loss weights, epoch counts) is the original authors' tuned
  default — nothing here was guessed.

No other files in this vendored copy were modified. See the upstream
repo for the original LICENSE file.
