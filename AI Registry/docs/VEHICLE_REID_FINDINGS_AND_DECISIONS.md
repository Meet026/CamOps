# Vehicle Re-ID — Research Findings & Fine-Tuning Decisions

**A full record of what we found, why we chose this direction, and exactly
how we decided to fine-tune the model — written so anyone (including a
future version of ourselves) can pick this up with zero missing context.**

This document consolidates the reasoning trail across:
- `Ai Idea Research.md` — the original market/policy research
- `docs/superpowers/specs/2026-08-29-vehicle-reid-phase0-design.md` — Phase 0 design
- `docs/superpowers/specs/2026-08-31-vehicle-reid-phase1-design.md` — Phase 1 design
- `docs/architecture/vehicle-reid-phase0-architecture.md` — Phase 0 build record
- Real, hands-on findings discovered while actually building and testing (not just planned)

---

## Part 1 — Why Vehicle Re-Identification At All

### The starting instinct we rejected

Before picking an AI direction for this hackathon, real research was done
into India's government CCTV/AI-surveillance landscape rather than
building "the obvious feature" (facial recognition, generic ANPR) without
question. That research materially changed the plan:

- **Government CCTV's real bottleneck is broken hardware, not missing
  AI.** CAG audits across multiple Indian cities show 30-44%+ of
  cameras non-functional at any time. This is *why* Model 1 (the camera
  registry, health monitoring, integration scoring) was built first — it
  solves the documented #1 real-world failure mode.
- **Facial recognition in India has a severe, documented accuracy and
  legitimacy problem.** Delhi Police's own court testimony: their FRT
  system ran at 2% accuracy in 2018, under 1% in 2019. A man spent 4.5
  years in custody partly on an 80% FRT similarity score later
  overturned. Of 170 government-commissioned FRT systems nationally,
  only ~20 (~12%) are actually operational. No Indian law currently
  defines the evidentiary weight of an FRT match in court.
- **Gujarat isn't a blank slate.** Gujarat Police has run an AI
  Intelligence Fusion Centre in Ahmedabad since 2023 — our platform is
  very likely meant to feed this, not duplicate it.
- **The compliance ground shifted recently.** India's DPDP Act
  implementing rules were only notified November 2025. Model 1 was
  already designed with the required controls (encryption, RBAC,
  tamper-resistant audit logs) — a real, current differentiator.
- **The "connect any camera + AI" pitch is already commercialized.**
  Staqu and Innefu Labs already sell this across 8+ Indian states. Even
  they are moving away from pure facial recognition — Staqu holds a
  patent for non-facial person re-identification.
- **ANPR (license plate reading) in India has specific, well-documented
  failure modes:** 50+ plate formats, huge font/layout variation, and
  two-wheelers (small, dirty, bent, non-standard plates) are the
  dominant accuracy killers.

### What we decided NOT to build

- Generic "AI identifies criminals via facial recognition" — the
  riskiest option given the documented accuracy/legitimacy history.
- A generic "connect any camera via IP" pitch — not a differentiator,
  already sold commercially.
- Anything ignoring the hardware-reliability reality for flashy analytics.

### The chosen direction — Vehicle Re-Identification

Instead of relying solely on license plate reading (which fails often),
identify and track a specific vehicle across cameras using its **visual
appearance** — color, shape, model, dents, stickers — as a fingerprint
that works even when the plate is unreadable, combined with plate reading
(not replacing it) since the two signals fail in different situations.

**Why this is defensible:**
- A real, established research field (Vehicle Re-ID), validated by an
  annual NVIDIA AI City Challenge (since 2018).
- Avoids the facial-recognition legitimacy trap entirely — vehicle
  appearance is not biometric/personal-identity data.
- Directly serves the hackathon's own test case: tracing a vehicle by
  plate number, made robust by visual matching when the plate can't be
  read at some cameras.
- A genuine, confirmed research gap exists: no major public Indian
  vehicle Re-ID dataset exists.

**ANPR is explicitly deferred**, by the project owner's direct
instruction — get vehicle Re-ID working well on its own first, decide
how to combine with plate reading later. The original plate+visual fusion
design remains the intended eventual architecture, just not built yet.

---

## Part 2 — Phase 0: Establishing an Honest Baseline

### Goal

Measure how a pretrained vehicle Re-ID model performs on real images,
*before* any fine-tuning — an honest "here's where we're starting from,"
not a polished demo.

### Model selection — corrected from the original research doc

The original research doc recommended `torchreid` + PVEN pretrained
weights. **Both were verified and found non-viable before building
anything:**

- **Torchreid has no vehicle Re-ID support at all** — it's a person
  re-identification library only (Market1501, DukeMTMC, etc.). Its model
  zoo has zero VeRi-776 or vehicle checkpoints. The research doc's claim
  otherwise was simply incorrect.
- **PVEN's real vehicle weights exist** but are hosted only on Baidu Pan
  behind a password — unreliable/slow outside China, unsuitable for a
  repeatable setup.

**Chosen instead:** [`occurra/vehicle_vit_clip_reid`](https://huggingface.co/occurra/vehicle_vit_clip_reid)
on Hugging Face — a CLIP-ReID model (a real, published technique),
trained on VeRi-776, exported to ONNX, explicitly CPU-compatible (no GPU
needed for inference). Verified directly via web fetch before selection,
not assumed.

### The methodology error we caught — and why it mattered

**Phase 0's first run tested the model on VeRi-776 images — the exact
dataset the model was trained on.** This produces an inflated,
untrustworthy number: it measures memorization, not generalization. **The
project owner caught this directly**, and it became the single most
important correction of the whole project.

**Corrected test:** re-running on **VRIC** (Vehicle Re-Identification in
Context) — a completely independent dataset the model has never seen:

| Test data | Clean-image separation gap |
|---|---|
| VeRi-776 (training data — invalid test) | 0.2157 |
| VRIC (independent — valid test) | **0.1568** |

The ~27% drop confirms the first number was inflated by training-data
familiarity.

### Deep diagnostic — finding *where*, not just *that*, it fails

An aggregate gap number only says the model struggles — not why or
where. `scripts/diagnose_failures.py` was built to answer this: computes
every pairwise similarity score, ranks the worst same-vehicle pairs
(false negatives) and worst different-vehicle pairs (false positives),
and reports a **separability check**.

**Real result, 30-vehicle VRIC clean-image subset:**

```
Same-vehicle pairs:      88   (mean=0.9049, min=0.7473, max=0.9902)
Different-vehicle pairs: 3828 (mean=0.7481, min=0.5662, max=0.9514)

NO threshold perfectly separates the two classes —
77/88 same-vehicle pairs score below the best different-vehicle pair, and
1932/3828 different-vehicle pairs score above the worst same-vehicle pair.
```

**Headline finding: ~50% of all different-vehicle pairs score higher
than the worst same-vehicle pair.** There is no similarity threshold that
would correctly separate "same car" from "different car" using the
unmodified model.

### Two failure modes, confirmed by actually looking at the images

The worst-scoring pairs were opened and visually inspected, not just
inferred from filenames:

**Failure mode 1 — Motion blur.** The single worst same-vehicle pair
(0.7473) is a genuine same car: one clear photo, one severely
motion-blurred to the point of being barely recognizable as a car shape.

**Failure mode 2 — Background/context bias.** The worst false positives
(up to 0.9514) clustered heavily around a handful of shared source
videos. Visual inspection confirmed it directly: two genuinely different
sedans, but sharing the same camera angle, road surface, grassy verge,
and lighting. **The model is partly matching on scene composition, not
vehicle-specific features.**

This second finding is independently confirmed by published research —
not just our own observation: vehicle Re-ID literature explicitly
documents "failure cases... caused by similar background and shape,
which pose bias on similarity and make it easier to neglect fine-grained
information" ([Multi-query Vehicle Re-identification: Viewpoint-conditioned
Network, Unified Dataset and New Metric](https://arxiv.org/pdf/2305.15764)).

### What this means

The pretrained model, unmodified, is not reliable enough for real use —
no usable decision threshold, two specific well-understood failure
modes. This is exactly the finding Phase 0 exists to surface, and it
directly motivates Phase 1's fine-tuning to specifically target these two
failures rather than generic "train on more data and hope."

---

## Part 3 — Phase 1: The Fine-Tuning Decision

### Real technique verification — not assumed

The research doc described generic "fine-tune on labeled data." Before
committing to an approach, the actual published CLIP-ReID method was
verified via research:

**CLIP-ReID's real training recipe is two-stage:**
1. **Stage 1:** image encoder frozen; the model learns a per-vehicle
   identity text prompt via image-to-text contrastive loss.
2. **Stage 2:** image encoder unfrozen and fine-tuned, trained with
   image-to-text cross-entropy + ID classification loss + triplet loss.

**A real, official reference implementation exists and is being used**,
rather than writing a training loop from scratch:
[`Syliz517/CLIP-ReID`](https://github.com/Syliz517/CLIP-ReID) (AAAI 2023,
MIT licensed) — the paper authors' own code, with working vehicle Re-ID
training already supporting VeRi-776 and VehicleID configs. Adapting this
real, peer-reviewed repo is far lower-risk than an invented training loop.

### The mechanism we almost got wrong — and corrected before building

Initial plan: fight background bias with a **custom hard-negative batch
sampler** — deliberately forcing same-camera, different-vehicle pairs
into training batches.

**Before building it, the real repo's code was actually read** — and it
turned out CLIP-ReID already has a real, built-in mechanism for exactly
this: `MODEL.SIE_CAMERA`. Verified directly in
`model/make_model_clipreid.py`: it feeds each image's **camera ID
directly into the model** as a learned per-camera embedding vector, added
to the image features during training — letting the model treat "which
camera took this" as a known, explicit input rather than something it
has to infer (and be fooled by) from the background.

**Decision: use `SIE_CAMERA` only, drop the custom sampler.** Simpler,
uses the original authors' proven mechanism instead of an untested
addition stacked on top. This was explicitly confirmed with the project
owner after explaining the tradeoff in plain terms, not decided
unilaterally.

### Against blur fragility — built, but NOT actually wired into training (correction)

**This section originally claimed** that a portion of training images
got synthetic motion blur applied during the 500-vehicle fine-tune,
reusing Phase 0's tested `src/degrade.py` blur logic. **That claim was
false and has been corrected here** — caught later, while auditing this
project's documentation against its actual code, not while the fine-tune
was running.

**What's actually true:** `training/blur_augmentation.py`
(`RandomBlurAugmentation`) was genuinely built, and genuinely has its
own passing unit test (`tests/test_blur_augmentation.py`) — it works
correctly in isolation. But it was **never imported or spliced into**
`training/CLIP-ReID/datasets/make_dataloader_clipreid.py`'s real
`train_transforms` pipeline. Verified directly by reading that file: the
actual transform chain used for the 500-vehicle fine-tune is
`Resize → RandomHorizontalFlip → Pad → RandomCrop → ToTensor → Normalize
→ RandomErasing` — the vendored repo's stock pipeline, with no blur step
anywhere in it, and no reference to `blur_augmentation.py` anywhere in
`training/CLIP-ReID/`.

**Why this matters, not just as a documentation nitpick:** the honest
before/after results below show the blur condition was one of only two
conditions that got *worse* after fine-tuning (0.0701 → 0.0573). A
training run that never actually saw blurred images during training
would plausibly explain exactly that result — this may be the real
cause, not a mysterious regression. Worth treating as the leading
hypothesis if/when this gets revisited (e.g. for the full 10,000-vehicle
run), rather than assuming the mechanism was tried and simply didn't
help.

### A real bug found while wiring the ONNX conversion

The real CLIP-ReID model's normal forward pass (in eval mode) returns a
**1280-dimensional** feature (768-dim image feature + 512-dim projected
feature, concatenated) — not 512-dim, which is what Phase 0's tested
`embedder.py`/`evaluate.py` expect. Found by reading the actual model
code (`make_model_clipreid.py`'s `forward()`), not assumed.

**Decision (confirmed with the project owner):** export only the 512-dim
projected feature via the model's `get_image=True` code path — a real,
complete embedding CLIP-ReID's own authors designed specifically for
retrieval/similarity use cases, not a truncation. This keeps Phase 0's
tested evaluation code completely untouched, per the plan's explicit
constraint.

### Dataset decision — verified against real research, then corrected again by real data

**Original plan (spec, before real data was in hand):** train on
VeRi-Wild (verified via research as the most camera-diverse public
vehicle Re-ID dataset — 174 cameras vs. VeRi-776's 20 or VehicleID's 1
camera), evaluate on VRIC (already proven independent).

**What we found once the real 8.2GB VeRi-Wild download was actually
inspected:**
- The only accessible Kaggle mirror (`mrkdagods/veriwild-test`) contains
  **only VeRi-Wild's official TEST split's images** (~10,000 vehicles),
  **not** the 30,671-vehicle official TRAINING split.
- Confirmed by direct inspection: zero overlap between
  `train_list_start0.txt`'s vehicle IDs and the images actually present
  in the archive; full overlap with `test_10000_id.txt`'s vehicle IDs.
- The official training split is only distributed via Baidu Pan, gated
  behind a password "released when the challenge begins" — not currently
  publicly accessible. (The same dead end as Phase 0's PVEN weights —
  this is a recurring, real pattern in this research area, not a one-off.)

**Decision, made deliberately with the project owner (not silently
worked around):** use VeRi-Wild's test-designated split as our actual
training data. This is legitimate, not a compromise dressed up as one —
the train/test label is the *original authors'* convention for
benchmarking papers against each other; it doesn't matter for our actual
requirement, which is only "don't fine-tune on data the model has
already been trained on" (VeRi-776). The test split satisfies that
exactly as well as the train split would — the model has seen neither.

**What we actually have, verified end-to-end against the real
downloaded archive:**

| Scale | Vehicles | Images | Distinct cameras |
|---|---|---|---|
| Probe run (first, for timing) | 500 | 6,420 | 114 |
| Full run | 10,000 | 128,517 | 161 |

Both confirmed to build and load correctly through the real CLIP-ReID
`VeriWild` dataset class before committing to either.

### Real bugs found and fixed while actually building the data pipeline

1. **Missing-file crash:** the split file can list images not actually
   present in the archive — an unhandled `KeyError` originally. Fixed to
   skip-and-report, matching this project's established error-handling
   convention (never crash the whole run over one bad entry).
2. **Training/evaluation-stub leakage risk:** `test_3000_id.txt`'s images
   are a confirmed subset of `test_10000_id.txt`'s — a naive internal
   gallery/query stub pick could reuse an image already used for
   training. Fixed to prefer a non-training vehicle when available.
3. **Fallback-selection bug:** when every vehicle gets selected for
   training (the real 10,000-vehicle case), the stub-selection fallback
   initially picked from the *unfiltered* vehicle list, which could
   include vehicles whose images turned out to be missing from the
   archive — a second occurrence of bug #1's root cause, caught by
   actually running the full-scale extraction, not just unit tests.
4. **A silent cross-test pollution bug:** the vendored CLIP-ReID repo's
   `bases.py` sets a *global*, process-wide PIL flag
   (`ImageFile.LOAD_TRUNCATED_IMAGES = True`) as an import side effect.
   Once any test touched the vendored code, this flag stayed flipped for
   the rest of the pytest session — silently breaking Phase 0's own
   corrupt-file-detection test whenever it ran afterward. Found because a
   test passed in isolation but failed in the full suite; fixed with an
   autouse pytest fixture that resets the flag before/after every test.

Every one of these was found by actually running real code against real
data, not by reasoning about it in the abstract — which is the core
reason this document treats "we tested it" as a distinct, necessary step
from "we wrote it."

---

## Part 4 — Compute: Why Google Colab, Not This Machine

This machine has no GPU (confirmed directly — `nvidia-smi` not found).
Fine-tuning (backpropagation through a ViT-B/16 encoder) is
computationally heavier than Phase 0's inference-only baseline and isn't
practical on CPU at this scale.

**Decision:** vendor the real CLIP-ReID repo as plain `.py` files (not a
notebook) in this project, so the code stays reviewable, testable, and
consistent with this project's pytest-based conventions. Upload the
vendored folder + prepared data to Google Colab's free-tier GPU, run
training there, convert the resulting checkpoint to ONNX (still in
Colab), and download only the final model file back into this project's
`models/` folder.

---

## Part 5 — How We're Actually Measuring Success

Phase 1's success is measured by re-running the **exact same two tools**
already built and tested in Phase 0 — never a new, differently-defined
metric — pointed at the fine-tuned model instead of the original:

- `src/cli.py`'s aggregate report across all 5 conditions (clean, blur,
  low_light, heavy_crop, tiny_resolution)
- `scripts/diagnose_failures.py`'s per-pair failure analysis and
  separability check

Both against the **same VRIC evaluation subset** used for Phase 0's
diagnostic — so before/after numbers are directly, honestly comparable.

**Success criteria:**
1. The clean-image separation gap on VRIC increases from the Phase 0
   baseline (0.1568).
2. The separability check's overlap percentage (currently ~50%)
   measurably decreases.
3. The two *specific* image pairs identified as failures in Phase 0 are
   individually re-checked — did the blur case and the background-bias
   case actually improve, not just the aggregate number?

If either success criterion is **not** met, the plan explicitly commits
to reporting that honestly rather than downplaying it — that would
itself be a valuable, real finding about this approach's limits, not a
failure to hide.

---

## Part 6 — What We're Deliberately Not Solving Yet

Stated plainly, not hidden:

- **ANPR (license plate reading)** — deliberately deferred, per the
  project owner's explicit instruction. Get visual Re-ID solid first.
- **Real Indian vehicles and two-wheelers.** Neither VeRi-Wild nor VRIC
  has meaningful Indian representation, and neither includes two-wheelers
  (~78% of real Indian vehicles). This fine-tuning phase improves
  generalization and fixes two diagnosed failure modes using existing
  public data — it does **not** close the "no Indian dataset exists" gap
  identified back in the original research. That's real, future work.
- **Extreme camera-angle variation** — cannot be synthesized from a
  single existing photo without a 3D model or a genuinely different real
  photo; a documented, honest gap since Phase 0, not simulated with a
  crude approximation that would misrepresent what was actually tested.
- **A vehicle detector/cropping step** — still Phase 2 territory per the
  original roadmap; Phase 0/1 assume images are already single-vehicle
  crops.
- **Any live camera or hackathon-feed integration, persistent storage,
  or API** — none of that exists yet; this is still local tooling plus
  a Colab training run.

---

## Part 7 — The One Principle That Ran Through All of This

Every real correction in this project — the train/test contamination
catch, the torchreid/PVEN dead ends, the 512-vs-1280-dim mismatch, the
SIE_CAMERA discovery, the VeRi-Wild train/test-split confusion, the four
real bugs in the data pipeline — was found by **actually running real
code against real data and reading real source code**, not by reasoning
about what should probably work. Several of these were caught specifically
because the project owner pushed back on a plausible-sounding result or
asked "why," rather than accepting the first answer. That pattern — verify
before trusting, and say so plainly when something turns out wrong — is
the actual methodology this whole effort has followed, more than any
single technical choice documented above.

---

## Part 8 — Live Route Matching: Measured Failure and the Fixes (2026-09-05)

Once `vehicle-ingest` began writing real sightings from live cameras, the
route feature could be judged on real data for the first time. It failed,
and the failure was measured rather than estimated.

### 8.1 What was actually wrong

**Physically impossible routes.** `find_route()` ranked candidates purely
by embedding similarity, with no awareness of geography or time. Measured
on real consecutive stops it returned, implied travel speeds reached
**~1,496,278 km/h**. One reported route claimed ~1,000 km in under two
hours (≈536 km/h).

**Mass false matching.** A single query returned **88 "same vehicle"
matches out of 242 car sightings stored at one camera** — 36% of every car
matching every other car. A traffic camera does not see the same car 88
times in three hours.

**Cross-class matches.** Cars matched motorcycles and trucks.

### 8.2 Threshold, measured on 150 real stored embeddings (11,175 pairs)

Counting only pairs of *different* vehicle classes that still cleared the
bar — an unambiguous error, so a floor on the true error rate:

| threshold | cross-class false matches |
|---|---|
| 0.80 | 51 (1.6%) |
| 0.85 | 9 (0.3%) |
| 0.90 | 3 (0.1%) |
| 0.95 | 2 (0.1%) |

Same-class p95 similarity is only **0.823**, so pushing past 0.90 discards
many true matches for almost no further gain. **0.90 was chosen**, not
0.80 and not 0.95.

### 8.3 Base vs fine-tuned model, scored on identical real crops

Six real camera crops, 15 pairs, both models on the same inputs:

| | true match (same parked car, 2 frames) | worst false match | margin |
|---|---|---|---|
| fine-tuned | 0.9289 | 0.7093 | **0.22** |
| base HF | 0.9623 | 0.8068 (motorcycle vs car) | **0.16** |

Base mean similarity 0.737 vs fine-tuned 0.576 — the base model scores
everything higher, including wrong pairs. **The base model is the less
discriminating of the two**, and at a 0.80 cutoff it would call a
motorcycle and a car the same vehicle. It is in use at the project
owner's explicit request; the 0.90 threshold is what makes that safe.

### 8.4 The embedding-space trap

The **same image** embedded by the base and fine-tuned models has a cosine
similarity of only **0.4974** to itself. The two spaces are not
comparable. Because `vehicle-ingest` writes embeddings and
`vehicle-detection` reads them, a model mismatch between those services
would raise no error — every query would score ~0.5 against everything and
the feature would silently return nothing forever. Both services now
declare the model path with a comment stating they must be changed
together. Switching models requires discarding or re-embedding stored
rows; the 398 fine-tuned rows were deleted when the base model was
adopted.

### 8.5 Fixes applied

- `filter_plausible_route()` in `sighting_store.py` — drops any stop
  requiring more than 150 km/h from the last *kept* stop (greedy, so a
  rejected stop never becomes the baseline). Same-camera stops are always
  plausible regardless of time gap.
- Same-class SQL guard in `find_route()` — a car is only compared against
  stored cars. Filtered in SQL so `LIMIT` is spent on real candidates.
- Threshold raised 0.80 → 0.90.
- Whole-image fallback in `/vehicles/route` when the detector finds zero
  vehicles in an already-cropped query photo, reported honestly via
  `used_whole_image_fallback` with `detection_confidence: null`.

### 8.6 What is still NOT fixed

None of the above makes the model able to tell two similar vehicles apart.
The filters remove impossible and provably-wrong matches; they cannot
turn a weak embedding into a reliable identification. **Route results
remain "possible matches, not confirmed identifications"** — the UI says
so, and that wording is accurate, not a disclaimer of convenience.
