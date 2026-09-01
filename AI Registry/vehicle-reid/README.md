# Vehicle Re-ID — Phase 0

Proof-of-concept: measures how a pretrained vehicle re-identification
model (CLIP-ReID, VeRi-776-trained, ONNX) performs on a small set of
real vehicle photos, under both clean and deliberately degraded
conditions (blur, low light, heavy crop, tiny resolution).

See `../docs/superpowers/specs/2026-08-29-vehicle-reid-phase0-design.md`
for the full design rationale, and `../Ai Idea Research.md` for why this
direction was chosen over facial recognition or generic ANPR.

## Setup

```bash
python3 -m pip install -e ".[dev]"
python3 scripts/fetch_model.py
```

`fetch_model.py` downloads both the Phase 0 pretrained baseline
(`occurra/vehicle_vit_clip_reid`) and the actual Phase 1 fine-tuned
model currently used in production
(`meet0326/vehicle-reid-500-finetuned`) into `models/` — `models/` is
gitignored (the files are hundreds of MB each), so this script, not a
fresh `git clone`, is how you get a working model. No local training
needed to get the same model that's already deployed; see
`training/README.md` and `docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md`
only if you actually want to reproduce or extend the fine-tuning itself.

Then obtain a VeRi-776 image folder and run:

```bash
python3 scripts/prepare_test_data.py --source /path/to/veri776/images
```

## Running

```bash
python3 -m src.cli
```

Report lands in `reports/<timestamp>/report.md` and `report.json`.

## Testing

```bash
pytest tests/ -v
```

Tests that need the real model or real VeRi-776 data are automatically
skipped if those aren't present yet — this is expected on a fresh clone
before running the setup steps above.
