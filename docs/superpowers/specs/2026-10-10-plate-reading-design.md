# License plate reading (ALPR) — design spec

## Problem

Vehicle search today only works by photo (visual re-identification).
License plate reading was never implemented: the `vehicle_sighting`
table already has `matched_plate`/`plate_confidence` columns, and
`vehicle-search` already reads them, but nothing in the ingest pipeline
ever writes them — every sighting's plate is `NULL` in practice. Any
plate value seen in a demo result is not genuinely OCR'd.

## Goal

1. At ingest time, read the plate text from each detected vehicle crop
   (when legible) and store it alongside the existing embedding.
2. At search time, accept a photo and/or a plate number as input — at
   least one required — and find the vehicle's route using whichever
   signal(s) are available.

This is additive to the existing visual re-ID pipeline, not a
replacement.

## Library choice

**FastALPR + fast-plate-ocr** (MIT license, ONNX-based: a YOLO plate
detector feeding a CCT/ViT OCR recognizer). Chosen over PaddleOCR/EasyOCR
because it is a combined detect+recognize pipeline (less integration
work) and fits this project's existing ONNX/pip stack. OpenALPR was
ruled out — AGPL core with a required commercial license for closed
deployment.

Known, accepted limitation: FastALPR's default models are trained as
general/global plate models with no documented Indian-specific training
data or two-line-plate handling. Accuracy on real Indian plates is
unproven out of the box. This spec ships the integration; a fine-tuning
pass on an Indian plate dataset is explicitly out of scope and tracked
as follow-up work, not a blocker — consistent with this project's
practice of shipping a known-limited capability with the limitation
stated, rather than waiting for a perfect model.

## Architecture

### Ingest-time (vehicle-ingest + vehicle-detection's pipeline.py)

Current flow per detected crop: `detect → crop → embed → store`.
New flow: `detect → crop → embed → read_plate → store`.

- Plate reading runs on the same crop the embedder already uses — no
  extra detection pass. FastALPR's own plate-detector finds the plate
  region within that crop.
- A plate-read failure (no plate found, OCR low-confidence rejection,
  model error) is non-fatal: the sighting is still saved with
  `matched_plate=None`. Mirrors the existing `EmbedderError`/
  `SightingStoreError` skip-and-continue convention in `pipeline.py` —
  one weak signal doesn't block the other.
- New dependency (`fast-alpr[onnx]`) added to `vehicle-ingest`'s
  `pyproject.toml`, not `vehicle-detection`'s — matching the existing
  pattern where vehicle-ingest imports vehicle-detection's classes
  directly rather than the reverse.
- New module `vehicle-ingest/src/plate_reader.py`: wraps FastALPR,
  exposes a single function `read_plate(crop: np.ndarray) -> PlateReadResult
  | None`, returning `(plate_text, confidence)` or `None`. Keeps FastALPR
  itself out of `pipeline.py`/`Sighting`, matching how `detector.py` and
  `embedder.py` are already thin wrappers around their respective models.
- `Sighting` dataclass (`sighting_store.py`) gains two optional fields:
  `matched_plate: str | None`, `plate_confidence: float | None`. `save()`'s
  INSERT includes these two columns — they already exist in the live
  table (added previously, unused), so this is an application-level
  change only, no migration needed.

### Search-time (vehicle-detection's `/vehicles/route`)

Current contract: `photo: UploadFile = File(...)` (required).
New contract:

```
POST /vehicles/route
  photo: UploadFile | None           (was required, now optional)
  license_plate: str | None          (new)
  last_seen_camera_id: str | None    (unchanged)
  last_seen_at: str | None           (unchanged)
```

Validation: both `photo` and `license_plate` omitted → 400 ("must
provide a photo, a license plate, or both"). Mirrors the existing
both-or-neither check already in this endpoint for the anchor pair.

Resolution logic:
- **Plate only**: skip detection/embedding entirely. Look up by
  `matched_plate` directly via a new `SightingStore.find_by_plate(plate,
  limit)` method — exact match on the normalized plate string (uppercase,
  strip hyphens/spaces, matching the normalization `vehicle-search`'s
  `ranker.py` already applies).
- **Photo only**: today's existing behavior, unchanged.
- **Both**: run the existing visual search AND the plate lookup. A
  sighting with an exact plate match is ranked first regardless of visual
  similarity score — an exact plate match is stronger ground truth than
  visual similarity. Sightings that match only visually still appear,
  ranked below exact plate matches.

Once candidate sightings are identified (by whichever signal), the
existing `find_route`/`find_route_from_anchor` logic builds the route
unchanged — route-building doesn't care how its input sightings were
found. Response shape is unchanged.

## Testing

TDD throughout, consistent with the existing test suites' style
(`test_motion_detector.py`, `test_pipeline.py`, `test_api.py`):

- `plate_reader.py`: unit tests with FastALPR mocked — given a crop,
  verify the wrapper returns `(text, confidence)` or `None` on failure.
  No real model loaded in unit tests.
- `pipeline.py`: extend `test_pipeline.py` with a case proving a
  plate-read failure doesn't block `saved_sighting_ids` (mirrors
  `test_embedder_failure_on_one_detection_does_not_stop_others`).
- `api.py`: new cases for photo-only (must stay green, regression
  check), plate-only, both, and neither (400) — mirrors the existing
  anchor-pair validation tests.
- Full before/after regression pass via live, running APIs (not just
  the test suite) across every endpoint this change touches:
  `/vehicles/route` (vehicle-detection), the ingest cycle's health
  reporting (vehicle-ingest), and vehicle-search's read path (since it
  already reads `matched_plate`/`plate_confidence` and will start
  seeing real, non-null values for the first time).
- One real integration check: run actual FastALPR against a handful of
  real Indian plate photos (not synthetic) to get a first honest read on
  accuracy before trusting it in a demo — no Indian-plate accuracy
  numbers exist publicly for this library.

## Explicitly out of scope

- Fine-tuning FastALPR on an Indian plate dataset.
- Any UI/frontend changes (the vehicle-search frontend already renders
  `license_plate`/`plate_confidence` from its API response — no new
  field to wire up there).
- Historical backfill of plates for sightings already in the database.
