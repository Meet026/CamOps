# Vehicle Re-ID — Phase 1 Design Spec

**Status:** Approved, ready for implementation planning
**Date:** 2026-08-31
**Context:** See `AI Registry/Ai Idea Research.md` for the original research
trail, and `AI Registry/docs/superpowers/specs/2026-08-29-vehicle-reid-phase0-design.md`
for Phase 0's design. This spec covers **Phase 1 — Fine-Tune for
Generalization**, informed directly by Phase 0's real, diagnosed results.

**Explicit scope decision:** ANPR (license plate reading) is **deliberately
excluded from this phase and this document's plan**. The project owner's
stated goal is to first get vehicle re-identification (visual matching)
working well on its own, before combining it with plate reading. This is a
sequencing decision, not a rejection of ANPR — the original research doc's
plate+visual fusion design (Part 2) remains the intended eventual
architecture, just not part of Phase 1's implementation.

---

## 1. Why This Phase Exists: What Phase 0 Actually Found

Phase 0 built a CLI that measures how a pretrained vehicle Re-ID model
(`occurra/vehicle_vit_clip_reid`, CLIP-ReID architecture, trained on
VeRi-776) separates "same vehicle" from "different vehicle" photo pairs,
via cosine similarity of its embeddings.

### 1.1 The train/test contamination problem (caught by the project owner)

Phase 0's first run tested the model on **VeRi-776 images — the same
dataset the model was trained on.** This produces an inflated, untrustworthy
number: it measures memorization of the training distribution, not genuine
generalization to unseen vehicles. The project owner caught this
methodology error directly.

**Corrected test:** re-running the identical evaluation on **VRIC**
(Vehicle Re-Identification in Context), a completely separate dataset the
model has never been trained on, gave a materially different, more honest
result:

| Test data | Clean-image separation gap |
|---|---|
| VeRi-776 (training data — invalid test) | 0.2157 |
| VRIC (independent — valid test) | **0.1568** |

The ~27% drop confirms the first number was inflated by training-data
familiarity, not real generalization.

### 1.2 Deep diagnostic: where, specifically, does it fail?

An aggregate gap number only says *that* the model struggles — it doesn't
say *why* or *where*. `scripts/diagnose_failures.py` was built to answer
this: it computes every pairwise similarity score (not just the mean),
ranks the worst same-vehicle pairs (false negatives) and worst
different-vehicle pairs (false positives), and reports a **separability
check** — whether any single similarity threshold could correctly split
same-vehicle from different-vehicle pairs at all.

**Run against the 30-vehicle VRIC clean-image subset:**

```
Same-vehicle pairs:      88   (mean=0.9049, min=0.7473, max=0.9902)
Different-vehicle pairs: 3828 (mean=0.7481, min=0.5662, max=0.9514)

Worst same-vehicle score:               0.7473
Best (highest) different-vehicle score: 0.9514

NO threshold perfectly separates the two classes —
77/88 same-vehicle pairs score below the best different-vehicle pair, and
1932/3828 different-vehicle pairs score above the worst same-vehicle pair.
```

**The headline finding:** roughly **50% of all different-vehicle pairs
score higher than the worst same-vehicle pair.** There is no similarity
threshold, however chosen, that would correctly separate "same car" from
"different car" using this model as-is. This is a stronger, more concrete
statement of the problem than the aggregate 0.157 gap alone.

### 1.3 Two failure modes, confirmed visually

The worst-scoring pairs from the diagnostic were opened and inspected
directly (not just inferred from filenames):

**Failure mode 1 — Motion blur.** The single worst same-vehicle pair
(0.7473) is a genuine same car: one photo is a clear side/front view, the
other is severely motion-blurred to the point of being barely recognizable
as a car shape. The model's low score here is at least understandable —
even a human would struggle on the blurred photo alone — but it's a real
weakness for real-world CCTV footage, where motion blur is common.

**Failure mode 2 — Background/context bias.** The worst false positives
(up to 0.9514 similarity between *different* vehicles) clustered heavily
around a handful of shared source videos (e.g. multiple top false
positives all involving frames from `MVI_40201`). Visual inspection of the
top false positive confirmed it directly: both images share the same
camera angle, same road surface and color, same grassy verge, and similar
overall lighting/color grading — while being genuinely different sedan
models. The model appears to be partly matching on **scene composition**
(camera position, road, lighting) rather than **vehicle-specific
features** (body lines, badges, precise shape).

**This second finding is independently confirmed by published research**,
not just our own observation: vehicle Re-ID literature explicitly
documents that "failure cases... are caused by similar background and
shape, which pose bias on similarity and make it easier to neglect
fine-grained information" — the exact pattern found here. ([Multi-query
Vehicle Re-identification: Viewpoint-conditioned Network, Unified Dataset
and New Metric](https://arxiv.org/pdf/2305.15764))

### 1.4 What this means

The pretrained model, unmodified, is not reliable enough for real use: it
has no usable decision threshold, and it fails in two specific, well-
understood ways. This directly motivates Phase 1 — and, importantly,
motivates fine-tuning that specifically targets these two failures rather
than generic "train on more data and hope."

---

## 2. Real Technique Verification (not the original doc's assumption)

The research doc's original Phase 1 plan described generic "fine-tune on
labeled data." Before committing to an approach, the actual published
CLIP-ReID method (the technique this model is built on) was verified via
web research rather than assumed:

**CLIP-ReID's real training recipe is two-stage:**
1. **Stage 1:** the image encoder is **frozen**; the model learns a
   per-vehicle-identity text prompt (a learned embedding standing in for
   "a photo of vehicle identity X") via image-to-text contrastive loss.
2. **Stage 2:** the image encoder is **unfrozen and fine-tuned**, trained
   with a combination of image-to-text cross-entropy loss, an ID
   classification loss, and a triplet loss (pulling same-identity
   embeddings together, pushing different-identity embeddings apart).

**A real, official reference implementation exists and will be used**,
rather than writing this training loop from scratch: the paper's authors
published [`Syliz517/CLIP-ReID`](https://github.com/Syliz517/CLIP-ReID)
(AAAI 2023, MIT licensed), with working training code already supporting
vehicle Re-ID (VeRi-776, VehicleID configs included) and a YAML-config-
driven workflow (`train_clipreid.py --config_file <path>.yml`). Building
Phase 1's training script by **adapting this real, peer-reviewed repo**
(adding a VeRi-Wild dataset class, a new config file) is far lower-risk
than an invented training loop — the loss functions and stage-1/stage-2
mechanics are already correctly implemented and tested by the original
authors.

**This also directly enables the background-bias fix (section 4) without
extra invention:** the repo already exposes `MODEL.SIE_CAMERA` /
`MODEL.SIE_COE` config options — a published "camera-aware" training mode
built specifically to stop a Re-ID model from overfitting to camera-
specific scene context. This is an existing, documented feature of the
real codebase, not something Phase 1 needs to build from first principles.

Phase 1 follows this real two-stage recipe, using the real reference
implementation, rather than an invented generic fine-tuning loop.

---

## 3. Dataset Decision — Verified, Not Assumed

**Training data:** the research doc listed VeRi-776, VehicleID, VeRi-Wild,
CityFlow, and VRIC as candidate datasets, without ranking them for this
specific purpose. Before picking, real comparative research was done
(not carried forward blindly from the doc):

| Dataset | Images | Identities | Cameras | Notes |
|---|---|---|---|---|
| VeRi-776 | 49,360 | 776 | 20 | What the current model was TRAINED on — cannot be used for fine-tuning without recreating the contamination problem in section 1.1 |
| VehicleID | 221,763 | 26,267 | 1 (front/rear only) | Single-camera — doesn't help fight background/camera bias |
| **VeRi-Wild** | **416,314** | **40,671** | **174** | Explicitly noted in published comparisons as "the most challenging dataset available," with far more camera/weather/lighting diversity than any alternative |
| VRIC | ~60,000 | ~2,811 (multi-image) | many, dashcam-style | Already used and proven independent of the current model — this is what Phase 0's diagnostic used |

**Decision: train on VeRi-Wild, evaluate on VRIC.**

- **VeRi-Wild for training:** its 174 cameras (vs. VeRi-776's 20 or
  VehicleID's 1) directly work against the diagnosed background-bias
  problem — a model trained on far more distinct scenes per vehicle
  identity has a harder time shortcutting to "same camera = same vehicle."
- **VRIC stays exclusively the evaluation set.** It is never trained on.
  This preserves the train/test separation the project owner's earlier
  catch established as non-negotiable — reusing VRIC for training would
  recreate the exact contamination problem this phase exists to fix.

---

## 4. What Fine-Tuning Specifically Targets

Rather than generic fine-tuning, training is deliberately configured
around the two diagnosed failures — using real, existing mechanisms in
the vendored repo rather than inventing new ones:

**Against background bias — `MODEL.SIE_CAMERA` (verified in the real
code, not assumed):** this is a real, already-implemented feature of
`Syliz517/CLIP-ReID` (see `model/make_model_clipreid.py`), present but
commented out in the reference vehicle configs. It works by feeding each
image's **camera ID directly into the model** as a learned per-camera
embedding vector, added to the image features during training. This lets
the model treat "which camera took this photo" as a known, explicit input
rather than something it has to infer from — and potentially be fooled
by — the image's background/lighting/angle. This is a different, and
simpler, mechanism than an initial plan to build a custom same-camera
hard-negative batch sampler; that custom sampler was **deliberately
dropped** in favor of this proven, already-implemented mechanism, once
its real behavior was understood (verified by reading the actual model
code before deciding, not assumed from the option's name alone).

**Against blur fragility:** a portion of training images have synthetic
motion blur applied (reusing Phase 0's existing `src/degrade.py`
`apply_degradation(image, "blur")` function — no new blur logic needed,
directly reusing tested code) so the triplet loss learns to still pull a
blurred and clear photo of the same vehicle together.

---

## 5. Compute — Google Colab

This machine has no GPU (confirmed in Phase 0). Fine-tuning (backpropagation
through a ViT-B/16 encoder) is computationally heavier than Phase 0's
inference-only baseline and is not practical on CPU at this scale.

**Approach:** vendor the real `Syliz517/CLIP-ReID` reference implementation
(MIT licensed) into this repo as a plain Python project (not a `.ipynb`
notebook), add a VeRi-Wild dataset class and a config file matching our
hard-negative and blur-augmentation requirements, and run its existing
`train_clipreid.py` entry point on Google Colab's free-tier GPU. The
resulting fine-tuned model checkpoint is converted to ONNX (matching Phase
0's format so `src/embedder.py` needs no changes) and downloaded back into
`models/` afterward. This keeps all code versioned in this repository;
only the actual training *execution* happens externally.

---

## 6. Before/After Comparison — Reusing, Not Rebuilding

Phase 1's success is measured by re-running the **exact same** two tools
already built and tested in Phase 0, pointed at the new fine-tuned model
instead of the original pretrained one:

- `src/cli.py`'s aggregate same-vehicle-vs-different-vehicle report (all 5
  conditions: clean, blur, low_light, heavy_crop, tiny_resolution)
- `scripts/diagnose_failures.py`'s per-pair failure analysis and
  separability check

Both run against the **same VRIC evaluation subset** used for Phase 0's
diagnostic, so before/after numbers are directly comparable — not a new
methodology, the same one, pointed at a new model file.

**Success criteria for Phase 1:**
1. The clean-image separation gap on VRIC increases from the Phase 0
   baseline (0.1568).
2. The separability check's overlap percentage (currently ~50% of
   different-vehicle pairs scoring above the worst same-vehicle pair)
   measurably decreases.
3. The specific failure examples identified in section 1.3 (the exact
   image pairs) are re-scored after fine-tuning and checked individually
   — did the specific blur case and the specific background-bias case
   actually improve, not just the aggregate?

---

## 7. File Structure

```
AI Registry/vehicle-reid/
├── training/
│   ├── CLIP-ReID/                           — vendored copy of the real
│   │                                           Syliz517/CLIP-ReID repo
│   │                                           (MIT licensed), unmodified
│   │                                           except where noted below
│   │   ├── datasets/
│   │   │   └── veriwild.py                  — NEW: dataset class for
│   │   │                                       VeRi-Wild, following the
│   │   │                                       repo's existing dataset
│   │   │                                       class pattern (e.g. veri.py)
│   │   ├── configs/VehicleID/
│   │   │   └── vit_clipreid_veriwild.yml     — NEW: our training config,
│   │   │                                       based on the real
│   │   │                                       vit_clipreid.yml reference —
│   │   │                                       VeRi-Wild as DATASETS.NAMES,
│   │   │                                       MODEL.SIE_CAMERA True (the
│   │   │                                       real, built-in background-
│   │   │                                       bias fix — see section 4)
│   │   └── train_clipreid.py                — UNMODIFIED, the repo's real
│   │                                           entry point
│   ├── prepare_veriwild_training_data.py    — builds the VeRi-Wild training
│   │                                           subset in the layout
│   │                                           datasets/veriwild.py expects,
│   │                                           preserving camera-ID labels
│   │                                           (needed for SIE_CAMERA)
│   ├── blur_augmentation.py                 — thin wrapper reusing
│   │                                           src/degrade.py's blur logic,
│   │                                           registered as a transform in
│   │                                           the training config
│   ├── convert_to_onnx.py                   — converts the trained
│   │                                           PyTorch checkpoint to ONNX,
│   │                                           matching Phase 0's format
│   └── README.md                            — step-by-step Colab upload/run
│                                               instructions
├── scripts/
│   └── compare_before_after.py              — runs cli.py's evaluation AND
│                                               diagnose_failures.py against
│                                               BOTH the original and
│                                               fine-tuned model, produces a
│                                               single before/after report
└── (existing src/, tests/, data/, models/, reports/ unchanged)
```

---

## 8. Documentation — Per Project Owner's Explicit Request

This spec itself serves as the documentation of (a) why the original model
fails, (b) the fine-tuning approach, and (c) the explicit ANPR deferral —
per the project owner's direct request to document all three together.

Additionally, mirroring Phase 0's convention:
- `AI Registry/docs/architecture/vehicle-reid-phase1-architecture.md` —
  written post-implementation, documenting what was actually built (not
  aspirational), including the real before/after comparison numbers.
- `AI Registry/docs/testing/phase1-qa.md` — what was tested, following the
  same honest-about-gaps convention as Phase 0's QA doc.

---

## 9. Explicitly Out of Scope for Phase 1

- **ANPR / license plate reading.** Deliberately deferred by the project
  owner's explicit instruction — Phase 1 is visual-Re-ID-only. The
  original research doc's plate+visual fusion design (Part 2) remains the
  intended eventual architecture but is not implemented here.
- Any live camera / hackathon feed integration.
- A vehicle detector / cropping step (still Phase 2 territory per the
  original roadmap).
- Any persistent storage, database, or API.
- Manually staged/photographed Indian vehicle data — Phase 1 uses only
  existing public datasets (VeRi-Wild for training, VRIC for evaluation).

---

## 10. Explicitly Deferred Decision: Physical Indian Vehicle Data

The research doc's original Phase 1 plan emphasized staging real Indian
vehicle photos specifically to address the confirmed gap that **no public
vehicle Re-ID dataset has meaningful Indian representation**, and that
**two-wheelers (~78% of Indian vehicles) are essentially absent from every
available dataset** (VeRi-Wild and VRIC included — both are car-focused,
non-Indian datasets).

This means Phase 1, as scoped here, **does not close that gap** — it
improves generalization and fixes the two diagnosed failure modes using
existing public data, but the resulting model is still not validated on
real Indian vehicles or two-wheelers. This is a known, explicit limitation
of this phase, not an oversight, and should be revisited in a later phase.
