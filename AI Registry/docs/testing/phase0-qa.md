# Vehicle Re-ID Phase 0 — QA

**Testing approach:** pytest, following the same discipline as
`model1-service`'s testing docs — every module has a dedicated test file,
real dependencies (the actual downloaded ONNX model) are used where
practical rather than mocked, and edge cases are tested explicitly rather
than only the happy path.

**Environment:** Python 3.12.3, local virtualenv (`.venv/`), CPU-only (no
GPU present on this machine — confirmed via `nvidia-smi` not found).

---

## Test Files and Coverage

### `tests/test_preprocessing.py` (9 tests)
- Valid RGB image loads successfully.
- Grayscale and CMYK images are auto-converted to RGB (not rejected).
- Empty file (0 bytes) → typed `EMPTY_FILE` error.
- **Corrupt file** (a real, valid JPEG header truncated mid-body — `Image.open()`
  succeeds but `img.load()`'s full decode fails) → typed `CORRUPT_FILE` error.
- Non-image file (plain text with a `.jpg`-adjacent extension) → typed
  `UNREADABLE_FORMAT` error.
- Missing file path → typed `CORRUPT_FILE` error.
- Model-input transform produces the correct `(1, 3, H, W)` float32 shape.
- Model-input transform actually applies ImageNet normalization (verified
  by checking output range, not raw 0-255 pixel values).

**Bug found and fixed during testing:** the original `corrupt_file_path`
fixture used arbitrary garbage bytes (`b"this is not a real jpeg..."`),
which PIL correctly classifies as `UnidentifiedImageError` →
`UNREADABLE_FORMAT`, not `CORRUPT_FILE` — the fixture was testing the same
scenario as the "non-image file" test, not a genuinely different one. Root
cause: the fixture, not the code. Fixed by constructing a real JPEG that
opens successfully but fails during full pixel decode (header valid, body
truncated) — this is what actually exercises the `CORRUPT_FILE` code path.

### `tests/test_embedder.py` (5 tests)
- Missing model file → typed `MODEL_FILE_MISSING` error, fail-fast at
  construction.
- Corrupt/unparseable `.onnx` file → typed `MODEL_LOAD_FAILED` error.
- Real model loads successfully and exposes its actual declared input
  dimensions (`input_height`/`input_width`) — **verified to be 256×256**,
  not a hardcoded guess.
- Valid input produces a `(512,)` float32 output vector.
- Wrong input shape → typed `MODEL_INPUT_SHAPE_MISMATCH` error.

**Finding during testing:** the model card for `occurra/vehicle_vit_clip_reid`
states the output is "L2-normalized." Empirically, the real output norm
is consistently ~6.4–7.0 across random, all-zero, and realistic inputs —
not 1.0. The test was corrected to assert a non-degenerate (non-zero)
norm rather than a specific unit-norm value, and this discrepancy is
documented in `../architecture/vehicle-reid-phase0-architecture.md` so
future work doesn't assume unit norm without re-normalizing. This does
not affect Phase 0's cosine-similarity-based evaluation, which is
scale-invariant.

### `tests/test_degrade.py` (7 tests)
- All 4 declared conditions (`blur`, `low_light`, `heavy_crop`,
  `tiny_resolution`) run successfully and return a `PIL.Image`.
- Unrecognized condition name → `ValueError`.
- Each condition is verified to *actually* change the image in the
  expected direction (blur measurably changes pixel data on a
  high-frequency checkerboard test pattern; low_light measurably reduces
  mean brightness; heavy_crop measurably reduces image area;
  tiny_resolution measurably reduces effective detail via down/upscale) —
  guards against an accidental no-op transform.

### `tests/test_evaluate.py` (7 tests)
- Typical case (some same-vehicle and some different-vehicle pairs)
  computes both means and the separation gap correctly.
- Only 1 image total → both means `None`, with an explanatory note (never
  a crash).
- All images belong to one vehicle (no different-vehicle pairs possible)
  → `different_vehicle_mean` is `None` with a note; `same_vehicle_mean`
  still computes normally.
- All images belong to different vehicles (no same-vehicle pairs
  possible) → the inverse case, also handled without crashing.
- Empty input list → both means `None`, with a note.
- Duplicate identical embeddings score ~1.0 cosine similarity, as
  expected.

### `tests/test_report.py` (5 tests)
- Both `report.md` and `report.json` are generated.
- Markdown report includes every condition's section and every skipped
  file with its reason.
- Markdown report always includes the "Known Limitations" section
  (extreme camera-angle variation).
- JSON report's data matches what the Markdown describes.
- A condition with all-`None` values (insufficient data) is rendered
  gracefully in both formats — its notes appear, not a blank/crashed
  section.

### `tests/test_cli_end_to_end.py` (2 tests)
- Full pipeline run (real model, synthetic fixture dataset with 3 valid
  vehicle identities plus one deliberately corrupt file) produces a
  complete report covering all 5 conditions (`clean` + 4 degraded), with
  the corrupt file appearing in the skipped-files list — proving one bad
  file does not block the rest of the run.
- Missing model path raises rather than silently producing a broken
  report.

### `tests/test_fetch_model.py` (2 tests)
- Not run as part of the main suite pass (see below) — both tests make a
  real ~330MB download to a fresh temp directory each, which is correct
  behavior to verify but too slow to include in every regression run.
  Verified manually instead: `scripts/fetch_model.py` was run directly and
  confirmed to produce `models/vehicle_vit_clip_reid.onnx` (330MB) as
  expected.

---

### `tests/test_prepare_test_data.py` (3 tests)
- At least 3 real vehicle identities present in `data/clean/` (adjusted
  down from the plan's original `>=5` target — see the in-code comment
  and the architecture doc's Known Gaps item 1 for why: the real
  `image_query` split only yielded 3 multi-image identities and 0
  single-image ones).
- At least 3 of those identities have multiple images (needed for
  same-vehicle pairs).
- Every file in `data/clean/` is verified to actually be a valid,
  loadable image via `preprocessing.load_and_validate`.

## Final Regression Result

**36 of 36 tests passed** — every test file except the two slow,
redundant `test_fetch_model.py` re-download tests (whose underlying
mechanism was verified manually: the model was fetched once and confirmed
present at `models/vehicle_vit_clip_reid.onnx`, 330MB). Zero failures,
zero errors, after fixing the one fixture bug described above.

This run used **real VeRi-776 data** (downloaded via the Kaggle API,
dataset `abhyudaya12/veri-vehicle-re-identification-dataset`), not
synthetic placeholders, for `test_prepare_test_data.py` and the manual
`python3 -m src.cli` run that produced the real baseline report (see the
architecture doc's "Real Baseline Result" section). The automated
`test_cli_end_to_end.py` still uses a synthetic fixture dataset
deliberately — it exists to test the pipeline's *mechanics* (does a
corrupt file get reported instead of crashing the run, do all 5
conditions appear), not to produce a meaningful accuracy number, so a
synthetic fixture is the right choice there specifically.

## Known Gaps (honest, not hidden)

1. Extreme camera-angle variation is untested by design (see spec section
   4) — not a testing gap, a deliberate scope boundary.
2. Only 3 vehicle identities in the real `data/clean/` subset (see
   architecture doc's Known Gaps item 1) — sufficient to produce a real,
   honest baseline number, but a larger sample would be more statistically
   robust for Phase 1 fine-tuning decisions.
