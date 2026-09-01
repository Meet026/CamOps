# Vehicle Re-ID — Phase 0 Design Spec

**Status:** Approved, ready for implementation planning
**Date:** 2026-08-29
**Context:** See `AI Registry/Ai Idea Research.md` for the full research trail
and rationale behind choosing vehicle re-identification over facial
recognition or generic ANPR. This spec covers only **Phase 0 — Prove the
Concept**, the first of four planned phases.

---

## 1. Goal

Get an honest baseline of how a pretrained vehicle re-identification model
performs on a small, controlled set of test images — **before** any
fine-tuning — and produce a structured report showing exactly how it behaves
across normal and degraded real-world conditions (blur, low light, heavy
crop, tiny resolution).

This is a proof-of-concept CLI tool, not a service. It has no dependency on
Model 1 (`model1-service`) and needs no camera access — later phases will
add those.

---

## 2. Model Decision (supersedes the research doc)

The research doc's original pick (torchreid + PVEN) was **verified and found
not viable** during design:

- **Torchreid has no vehicle Re-ID support at all** — it is a person
  re-identification library only (Market1501, DukeMTMC, etc.). Its model zoo
  does not include VeRi-776 or any vehicle checkpoint. The research doc's
  claim otherwise was incorrect and is corrected here.
- **PVEN's real vehicle weights exist** (VeRi-776 and VeRi-Wild trained,
  reported mAP 66-80 depending on split) but are hosted only on Baidu Pan
  behind a password, which is unreliable/slow to access outside China and
  unsuitable as a dependency for a repeatable setup.

**Chosen model:** [`occurra/vehicle_vit_clip_reid`](https://huggingface.co/occurra/vehicle_vit_clip_reid)
on Hugging Face — verified directly before selection.

- Architecture: CLIP-ReID (a published, established technique — CLIP's
  visual encoder with a projection head fine-tuned for re-identification).
- Trained on: **VeRi-776** (matches the research doc's originally intended
  dataset).
- Format: **ONNX**, explicitly supports `CPUExecutionProvider` — runs
  without a GPU, matching this machine's actual hardware (no NVIDIA GPU
  present).
- Output: 512-dimensional, L2-normalized embedding per image.
- No official Rank-1/mAP is published on the model card — this is expected
  and acceptable, since Phase 0's entire purpose is to measure this
  ourselves on our own test data, not trust a vendor's number.

**Why this doesn't block future phases:** the model is loaded via ONNX
Runtime, a framework-agnostic format — nothing here creates lock-in to
CLIP-ReID specifically. Phase 1 (fine-tuning) may swap to a different
architecture entirely if this baseline proves inadequate; that decision is
explicitly deferred, not made here.

---

## 3. Compute Target

**Local CPU**, in this repo, not Google Colab. Rationale (per project
owner): this code must grow into the future `AI Registry` module (Phases
1-3), so it should live as real project structure from day one rather than
disposable notebook code that would need re-porting later.

At Phase 0's scale (~20-30 images, one-off batch inference), CPU-only
PyTorch/ONNX Runtime inference completes in seconds, not hours. This is not
a permanent architectural decision — Phase 1's fine-tuning step will very
likely need a free-tier GPU (Colab/Kaggle), which is a separate, later
decision already anticipated in the research doc.

---

## 4. Test Data

**Source:** a small subset (~20-30 images) pulled directly from the
**VeRi-776** dataset — the same dataset referenced throughout the research
doc, properly licensed for research use, and — critically — containing
genuine multiple photos of the *same* vehicle from different angles/cameras,
which a same-vehicle-vs-different-vehicle test requires. General stock photo
sites were explicitly rejected for this reason: they can't provide multiple
angles of one specific real vehicle.

**Structure:** images grouped by vehicle identity under
`data/clean/<vehicle_id>/*.jpg`, mirroring VeRi-776's own identity grouping.

**Degraded variants:** generated programmatically from the clean set (not
sourced from elsewhere), so degradation severity is controlled and
reproducible:

| Condition | Simulates |
|---|---|
| `blur` | Gaussian blur — motion blur / out-of-focus camera |
| `low_light` | Brightness/contrast reduction — night or poor lighting |
| `heavy_crop` | Aggressive crop toward image edge — partial vehicle in frame |
| `tiny_resolution` | Downscale then upscale — vehicle far from camera |

**Explicitly out of scope for Phase 0:** true extreme-angle variation
cannot be synthesized from a single existing photo (that would require a 3D
model or a genuinely different real photo). This is documented as a known,
honest gap in the final report — not faked with a crude transform that
would misrepresent what was actually tested.

---

## 5. Evaluation Methodology

**Same-vehicle vs. different-vehicle similarity test:**

1. Compute an embedding for every valid image (clean + all degraded
   variants).
2. Compute cosine similarity for every image pair.
3. Split pairs into two groups: **same-vehicle** (same `vehicle_id`) and
   **different-vehicle**.
4. A good baseline should show same-vehicle pairs scoring *noticeably
   higher* than different-vehicle pairs — this is a lightweight, Phase-0-
   scale version of the Rank-1 concept, and sets up Phase 1's real
   Rank-1/mAP evaluation directly (same underlying comparison, just at
   larger scale with proper train/test splits later).
5. Metrics reported: mean same-vehicle similarity, mean different-vehicle
   similarity, the gap between them (the actual "baseline" headline
   number), and the same breakdown **per degradation condition** —
   e.g. "on blurred images, the same/different gap shrinks from X to Y."

This directly satisfies the project owner's requirement to "run this model
in every condition and get a report" — every condition produces its own
row in the results, not just one aggregate pass/fail.

---

## 6. Architecture

```
AI Registry/vehicle-reid/
├── src/
│   ├── embedder.py       — loads ONNX model, runs inference, handles all
│   │                        model/input failures
│   ├── preprocessing.py  — image loading + validation + the CHW/normalize
│   │                        transform the model requires
│   ├── degrade.py        — deliberately generates degraded variants
│   │                        (blur/low_light/heavy_crop/tiny_resolution)
│   │                        from clean source images
│   ├── evaluate.py       — same-vehicle vs different-vehicle similarity
│   │                        scoring
│   ├── report.py         — builds the structured report (Markdown + JSON)
│   └── cli.py            — entry point, wires the above together
├── models/               — downloaded ONNX checkpoint (gitignored, fetched
│                            by a setup script, not committed)
├── data/
│   ├── clean/            — source images grouped by vehicle_id
│   │                        (VeRi-776 subset)
│   └── degraded/         — auto-generated from clean/ by degrade.py
│                            (gitignored — regeneratable, not source)
├── reports/              — output reports land here, timestamped
│                            (gitignored — output, not source)
├── tests/                — pytest suite, one file per src/ module, covering
│                            every edge case category below
├── pyproject.toml        — dependencies + project metadata (modern Python
│                            packaging standard, not a bare requirements.txt)
├── .gitignore
└── README.md             — setup/usage instructions
```

**Data flow:**

```
data/clean/<vehicle_id>/*.jpg  (VeRi-776 subset)
        │
        ├─→ degrade.py generates data/degraded/<condition>/<vehicle_id>/*.jpg
        │
        ▼
preprocessing.py validates + transforms every image (clean AND degraded)
        │  - corrupt/unreadable/0-byte/non-image file → recorded as
        │    failure, skipped (never crashes the run)
        │  - wrong color mode (CMYK/grayscale) → auto-converted to RGB,
        │    logged as a note (not a failure)
        ▼
embedder.py runs ONNX inference per valid image → 512-dim embedding
        │  - missing/corrupt model file → fails FAST at startup, once,
        │    with a clear message (not per-image — a broken model makes
        │    every subsequent result meaningless)
        │  - wrong input shape on a specific image → caught, recorded as
        │    failure, image skipped, run continues
        ▼
evaluate.py computes cosine similarity for every valid image pair
        │  - groups by vehicle_id: same-vehicle vs different-vehicle pairs
        │  - only 1 image total / all-same-vehicle (no negative pairs
        │    available) / duplicate images → clear "cannot compute X"
        │    note in the report, never a crash or fabricated number
        ▼
report.py emits reports/<timestamp>/report.md + report.json
        │  - overall same-vs-different separation score (the headline
        │    baseline result)
        │  - full breakdown PER CONDITION (clean, blur, low_light,
        │    heavy_crop, tiny_resolution)
        │  - complete list of skipped files + typed reason for each
        │  - explicit "known limitations" section (e.g. extreme-angle
        │    not tested — see §4), honestly labeled, never hidden
```

---

## 7. Error Handling Philosophy

- **Every failure gets a typed reason** (e.g. `CORRUPT_FILE`,
  `UNREADABLE_FORMAT`, `EMPTY_FILE`, `MODEL_INPUT_SHAPE_MISMATCH`,
  `MODEL_FILE_MISSING`), never a raw stack trace surfacing in the report.
  Full stack traces still go to a separate log file for debugging.
- **Model-level failures are fail-fast**, checked once at startup (does the
  ONNX file exist, does it load, does a dummy inference pass) — a broken
  model makes every downstream result meaningless, so this stops the run
  immediately with a clear message, per the project owner's explicit
  decision.
- **Per-image failures are skip-and-continue** (also an explicit decision)
  — one corrupt file in a batch of 30 never blocks seeing results for the
  other 29. The report lists every skip with its reason.
- **Low confidence is a result, not an error.** A degraded image that
  embeds successfully but produces a low similarity score is exactly the
  kind of data Phase 0 exists to surface — it goes into the report as a
  real data point, never silently dropped or treated as a failure.

---

## 8. Testing Approach

TDD (test-first), matching Model 1's existing convention in this
repository:

- `tests/test_preprocessing.py` — every bad-input case (corrupt file, wrong
  format, 0-byte file, non-image file, wrong color mode) written before the
  handling code
- `tests/test_embedder.py` — model load failure, input shape mismatch,
  correct embedding shape/dtype on valid input
- `tests/test_evaluate.py` — single-image-only, all-same-vehicle (no
  negative pairs), duplicate-image scenarios
- `tests/test_degrade.py` — confirms each degraded variant is measurably
  different from its source (not an accidental no-op transform)
- One end-to-end test running the full CLI against a tiny fixture dataset,
  asserting a report is produced with every expected section present

---

## 9. Documentation Structure

Mirrors `model1-service/docs/`'s existing convention:

```
AI Registry/docs/
├── architecture/
│   └── vehicle-reid-phase0-architecture.md   — finalized architecture
│                                                notes, written post-build
├── superpowers/
│   ├── specs/2026-08-29-vehicle-reid-phase0-design.md   — this file
│   └── plans/2026-08-29-vehicle-reid-phase0-implementation.md
│                                                — the implementation plan
│                                                  (next step after this spec)
└── testing/
    └── phase0-qa.md   — filled in after implementation, same convention as
                          model1-service's `docs/testing/*-qa.md` files
```

---

## 10. Explicitly Out of Scope for Phase 0

- Fine-tuning the model on Indian vehicle data (Phase 1).
- Any live camera / hackathon feed integration (Phase 1's ANPR-bootstrapped
  labeling step and beyond).
- A vehicle detector / cropping step (Phase 2) — Phase 0 assumes images are
  already single-vehicle crops, since VeRi-776 images are pre-cropped.
- Any persistent storage, database, or API — Phase 0 is a one-shot CLI run
  producing a report file, nothing more.
- True extreme camera-angle variation (see §4) — documented as a known gap,
  not simulated.

---

## 11. Success Criteria

Phase 0 is complete when:

1. Running the CLI against the VeRi-776 test subset produces a report
   showing a measurable same-vehicle vs different-vehicle similarity gap
   on clean images.
2. The same report shows how that gap changes under each degraded
   condition (blur, low_light, heavy_crop, tiny_resolution).
3. Every edge case category (bad input images, model/runtime failures,
   degraded conditions, dataset/comparison edge cases) has a passing test
   demonstrating correct handling — no crashes, no silent data loss, no
   fabricated results.
4. The report is a legitimate, presentable artifact on its own — honest
   about what was and wasn't tested, per the research doc's own stated
   principle (Part 5: "honestly benchmarked, not black-boxed").
