# Vehicle Re-ID Phase 0 — Architecture (As Built)

**Status:** Complete. Code verified against the real pretrained model AND
a real VeRi-776 data subset (via Kaggle:
abhyudaya12/veri-vehicle-re-identification-dataset). A real baseline
report has been generated — see "Real Baseline Result" below. This
document describes what was built and proven, not aspirational plans.

**Spec:** `../superpowers/specs/2026-08-29-vehicle-reid-phase0-design.md`
**Plan:** `../superpowers/plans/2026-08-29-vehicle-reid-phase0-implementation.md`

---

## What This Is

A standalone Python CLI at `AI Registry/vehicle-reid/` that embeds vehicle
images with a pretrained ONNX Re-ID model, and measures how well it
separates same-vehicle from different-vehicle pairs — both on clean
images and under four deliberately degraded conditions.

## Model

`occurra/vehicle_vit_clip_reid` (Hugging Face) — CLIP-ReID architecture,
VeRi-776-trained, exported to ONNX. Loaded via `onnxruntime` with
`CPUExecutionProvider` — no GPU required or used.

**Verified real input/output shape** (differs from the model card, which
didn't specify exact dimensions):
- Input: `(1, 3, 256, 256)` float32 NCHW, ImageNet-normalized
  (mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]`, RGB order).
  `256`, not the ViT-B/16-typical `224` — read directly from the ONNX
  file's declared input shape at load time (`embedder.py`'s
  `VehicleEmbedder.__init__`), never hardcoded.
- Output: `(512,)` float32 vector.

**Documented discrepancy from the model card:** the card states the
output is "L2-normalized." Empirically measured across random, all-zero,
and realistic ImageNet-normalized inputs, the actual output norm is
consistently **~6.4–7.0, not 1.0**. This does not affect Phase 0's
similarity scoring — cosine similarity divides by each vector's own norm
and is therefore scale-invariant — but any future code that assumes unit
norm without re-normalizing should not trust the model card's claim at
face value.

## File Structure (as built)

```
AI Registry/vehicle-reid/
├── pyproject.toml, .gitignore, README.md
├── src/
│   ├── embedder.py        — ONNX load + inference, typed failures
│   ├── preprocessing.py   — image load/validate/transform, typed failures
│   ├── degrade.py         — blur/low_light/heavy_crop/tiny_resolution generation
│   ├── evaluate.py        — same/different-vehicle cosine similarity scoring
│   ├── report.py          — Markdown + JSON report generation
│   └── cli.py             — wires everything into one run() call
├── scripts/
│   ├── fetch_model.py       — downloads the ONNX checkpoint (idempotent)
│   └── prepare_test_data.py — reorganizes a raw VeRi-776 folder into data/clean/
├── models/vehicle_vit_clip_reid.onnx   — downloaded, gitignored (330MB)
├── data/clean/             — EMPTY (see Known Gaps) — real VeRi-776 subset goes here
├── data/degraded/          — gitignored, generated at runtime, not persisted to disk
├── reports/                — gitignored, CLI output lands here
└── tests/                  — 33 tests, one file per src/ module + one end-to-end
```

Note: `degrade.py`'s output is generated in-memory during a `cli.py` run
and never written to `data/degraded/` on disk — the file structure section
of the original plan described it as a disk folder, but the actual `run()`
implementation degrades images in-memory per-condition inside `_embed_all`,
which is simpler and avoids managing a second on-disk image tree that
would just be regenerated every run anyway.

## Data Flow

```
data/clean/<vehicle_id>/*.jpg
        │
        ▼
cli.py's run(): for "clean" + each of 4 degraded conditions:
        │
        ├─→ preprocessing.load_and_validate()  — typed errors: CORRUPT_FILE,
        │                                          UNREADABLE_FORMAT, EMPTY_FILE
        ├─→ degrade.apply_degradation() (skipped for "clean")
        ├─→ preprocessing.to_model_input()      — resize to 256x256, normalize
        ├─→ embedder.VehicleEmbedder.embed()    — typed error: MODEL_INPUT_SHAPE_MISMATCH
        │     (model load itself is fail-fast in run()'s first line —
        │      MODEL_FILE_MISSING / MODEL_LOAD_FAILED stop the whole run)
        ▼
evaluate.evaluate_embeddings() — same-vehicle vs different-vehicle cosine
        similarity, per condition. Insufficient data (< 2 images, no
        same-vehicle pairs, no different-vehicle pairs) never raises —
        returns None fields + explanatory notes.
        ▼
report.generate_report() — report.md + report.json, listing every
        condition's results (or "cannot compute" notes), every skipped
        file with its typed reason, and a fixed "Known Limitations"
        section stating extreme camera-angle variation is untested.
```

## Error Handling (verified behavior, not just design intent)

- Model-level failure (missing/corrupt `.onnx` file) — raises immediately
  from `run()`'s first line, propagates uncaught. Verified by
  `test_run_does_not_crash_on_missing_model` and
  `test_missing_model_file_raises_typed_error`.
- Per-image failure (corrupt file, wrong format, empty file) — caught in
  `cli.py`'s `_embed_all`, recorded in `skipped_files`, that image
  skipped, run continues. Verified by
  `test_full_run_produces_report_with_all_expected_sections`, which
  includes one deliberately corrupt file in its fixture dataset and
  asserts it appears in the report rather than crashing the run.
- Every typed error carries a `.reason` string
  (`CORRUPT_FILE`/`UNREADABLE_FORMAT`/`EMPTY_FILE`/`MODEL_FILE_MISSING`/
  `MODEL_LOAD_FAILED`/`MODEL_INPUT_SHAPE_MISMATCH`) surfaced directly in
  the report — never a raw stack trace.

## Real Baseline Result

Generated from the real VeRi-776 `image_query` subset (3 vehicle
identities, 3 images each — `prepare_test_data.py`'s selection logic
picked all 3 multi-image identities available in that split, and found 0
additional single-image identities to reach the original 5-vehicle
target; see "Known Gaps" item 1 below for what this means for future
data selection):

| Condition | Same-vehicle mean | Different-vehicle mean | Separation gap |
|---|---|---|---|
| clean | 0.8542 | 0.6385 | **0.2157** |
| blur | 0.8816 | 0.7381 | 0.1435 |
| low_light | 0.8604 | 0.7186 | 0.1418 |
| heavy_crop | 0.8127 | 0.7419 | 0.0708 |
| tiny_resolution | 0.8657 | 0.7080 | 0.1577 |

**Reading this honestly:** the pretrained model (no fine-tuning at all)
does meaningfully separate same-vehicle from different-vehicle pairs on
clean images (gap of ~0.22). Every degraded condition shrinks that gap, as
expected — most severely under `heavy_crop` (gap drops to ~0.07, less
than a third of the clean baseline), meaning a partially-out-of-frame
vehicle is where this off-the-shelf model struggles most. This is exactly
the kind of honest, presentable "before fine-tuning" baseline Phase 0 was
meant to produce (see spec section 1 and section 11's success criteria).

Full report: `reports/phase0-baseline-CONTAMINATED-veri776-invalid/report.md` and `.json` (gitignored,
regeneratable via `python3 -m src.cli`).

## Known Gaps

1. **Only 3 vehicle identities, no single-image identities, in the
   current `data/clean/` subset.** `prepare_test_data.py`'s selection
   logic requested 5 total identities (3 multi-image + up to 2
   single-image), but VeRi-776's `image_query` split — chosen because
   it's the smaller, curated query/gallery split, appropriate for a
   Phase-0-scale test rather than the much larger `image_train` split —
   only contained 3 vehicles with 2+ images and apparently 0 with exactly
   1 image at the point the script scanned it. This does not block the
   test (same-vehicle and different-vehicle pairs both exist and were
   scored — see the real result above), but a larger/more varied sample
   (e.g. drawing additionally from `image_train`, which has 37,778 files)
   would give a more statistically robust Phase 1 fine-tuning baseline.
2. **Extreme camera-angle variation is untested**, by design — see spec
   section 4. Cannot be synthesized from a single existing photo without
   a 3D model or a genuinely different real photo.
3. **`degrade.py`'s in-memory approach means degraded images are never
   written to disk** for manual visual inspection — if the project owner
   wants to eyeball what a `heavy_crop` or `low_light` variant actually
   looks like, that requires a small one-off script, not something
   `cli.py` currently exposes.
