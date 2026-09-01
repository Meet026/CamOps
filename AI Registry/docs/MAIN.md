# AI Registry — Vehicle Re-ID System — Master Document

## Overall Project Objective

AI Registry is Sentinel's vehicle re-identification system: given a photo of one vehicle, find where else that vehicle was seen — across which registered cameras, in what order — using visual similarity (not license-plate reading; the model matches on overall vehicle appearance). It's a separate, sibling Python project to `model1-service/` (the NestJS camera registry), sharing that project's database but not its codebase or runtime. See [`model1-service/docs/MAIN.md`](../../model1-service/docs/MAIN.md) — "The Whole Application, In One Place" — for how all three pieces of Sentinel (Model 1 backend, frontend, this project) fit together.

## Why This Project Exists — Rejected Before Anything Was Built

Before any code was written, two more obvious directions were considered and explicitly rejected — this decision is the actual starting point of the project, documented in [`Ai Idea Research.md`](../Ai%20Idea%20Research.md):

- **Facial recognition** — rejected. Delhi Police's own FRT system reports under 1% match accuracy in real deployment (2019); only about 20 of 170 government FRT systems in India are operational. Beyond the accuracy problem, this is also the direction with the most legal/legitimacy risk for a police tool.
- **Generic "connect any camera stream" analytics** — rejected. Already a solved, commercially available problem (vendors like Staqu and Innefu already sell this); building it again adds no real value to Sentinel.
- **Vehicle Re-ID — chosen.** No public Indian vehicle Re-ID dataset or tool exists; this is a genuine gap Sentinel can fill, and the failure mode (a wrong match) is far less consequential than a false face match. The long-term target architecture is plate-reading (ANPR) fused with visual Re-ID, but **ANPR was explicitly deferred** by direct project-owner instruction, to get visual Re-ID solid first before adding a second recognition system on top.

## Two Sub-Projects, One Shared Database

| Sub-project | Purpose | Language / Stack |
|---|---|---|
| [`vehicle-reid/`](../vehicle-reid/) | The Re-ID model itself — baseline evaluation, then fine-tuning | Python, PyTorch, ONNX, CLIP-ReID |
| [`vehicle-detection/`](../vehicle-detection/) | Vehicle detector (YOLO) + pgvector storage + the FastAPI HTTP service the frontend calls | Python, Ultralytics YOLO, FastAPI, psycopg2 |

Both reuse `model1-service/.env`'s `DATABASE_URL` directly — no separate database, no duplicated credentials. `vehicle-detection` imports `vehicle-reid`'s embedder/preprocessing code directly via a `sys.path` insert (a single source of truth for the embedding step, not a second copy that could drift).

## The Story, Chronologically — What Was Built, In What Order, And Why

This is the step-by-step build history: what was tried, what was rejected, what broke, and why each real decision was made — not a restatement of the design docs, but the narrative connecting them. Each phase links to its own detailed findings doc for full numbers and evidence; this section is the map, not the territory.

### Phase 0 — Establish an honest baseline (no fine-tuning yet)

**Goal:** find out how good a pretrained, off-the-shelf vehicle Re-ID model actually is, before spending any effort improving it — and refuse to trust a rosy number without checking it.

**Model selection, verified not assumed:** the original research doc's first recommendation — `torchreid` + PVEN — was checked before building anything, and both were dead ends: `torchreid` has zero actual vehicle Re-ID support, and PVEN's trained weights are only distributed via Baidu Pan (gated, not realistically accessible). Switched to `occurra/vehicle_vit_clip_reid` (CLIP-ReID architecture, ONNX export, runs on CPU) instead, confirmed viable via direct research before committing.

**The single most important correction of Phase 0 — caught by the project owner, not by me:** the first baseline run evaluated the model against VeRi-776 — which is the model's own training dataset. That's not a benchmark, it's the model recognizing its own homework, and it produced an inflated separation gap of 0.2157. **The project owner caught this directly and it was fixed** by switching to VRIC, an independent dataset the model had never seen, giving the honest number: **0.1568**. Both runs are preserved for the record — the invalid one at `vehicle-reid/reports/phase0-baseline-CONTAMINATED-veri776-invalid/`, the valid one at `vehicle-reid/reports/phase0-baseline-vric-canonical/` — named exactly that, not by timestamp, so nobody accidentally cites the wrong number again.

**Going beyond one aggregate number:** a separability check (`scripts/diagnose_failures.py`) found that ~50% of different-vehicle pairs score *higher* similarity than the worst same-vehicle pair — there's no clean threshold that separates "same vehicle" from "different vehicle." Two concrete failure modes were found by actually looking at the flagged image pairs (not inferred from statistics alone):
1. **Motion blur** — the single worst same-vehicle pair (score 0.7473) was blurred.
2. **Background/camera bias** — the worst false-positive pairs cluster around vehicles filmed by the *same source camera*, up to 0.9514 similarity for genuinely different vehicles — the model was partly matching on background, not vehicle.

Both are independently corroborated by published vehicle Re-ID literature, not a one-off local finding.

**Full detail:** [`docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md`](VEHICLE_REID_FINDINGS_AND_DECISIONS.md) (Phase 0 sections), [`docs/architecture/vehicle-reid-phase0-architecture.md`](architecture/vehicle-reid-phase0-architecture.md), [`docs/testing/phase0-qa.md`](testing/phase0-qa.md), design/plan docs in [`docs/superpowers/specs/`](superpowers/specs/) and [`docs/superpowers/plans/`](superpowers/plans/) (2026-08-29 dated files).

### Phase 1 — Fine-tune to fix the two diagnosed failure modes

**Goal:** directly address blur fragility and background bias, using a real training recipe rather than an invented one — and be honest about the result either way.

**Training recipe, verified not assumed:** rather than writing a training loop from scratch, the real, peer-reviewed [`Syliz517/CLIP-ReID`](https://github.com/Syliz517/CLIP-ReID) reference implementation (AAAI 2023, MIT licensed) was vendored and adapted. Its actual two-stage recipe was read and used as-is: Stage 1 freezes the image encoder and learns a per-vehicle identity text prompt; Stage 2 unfreezes the encoder and fine-tunes with image-to-text + ID classification + triplet loss.

**A plan that was reconsidered after reading the real code, not built on assumption:** the original plan was to fight background bias with a custom hard-negative batch sampler (deliberately forcing same-camera, different-vehicle pairs into training batches). Before building it, the vendored repo's actual model code was read — and it turned out CLIP-ReID already ships a real, working mechanism for exactly this: `MODEL.SIE_CAMERA`, which feeds each image's camera ID into the model as a learned embedding, added to the image features during training. **Decision, confirmed with the project owner after explaining the tradeoff:** use `SIE_CAMERA` only, drop the custom sampler — simpler, and uses the original authors' proven mechanism instead of stacking an untested addition on top.

**Against blur fragility — a real, documented mistake, corrected here.** A `RandomBlurAugmentation` module was built (reusing Phase 0's tested `src/degrade.py` blur logic) and has its own passing unit test. **But it was never actually wired into the real training pipeline** — verified directly by reading `training/CLIP-ReID/datasets/make_dataloader_clipreid.py`'s real `train_transforms`: `Resize → RandomHorizontalFlip → Pad → RandomCrop → ToTensor → Normalize → RandomErasing`, no blur step anywhere. This was originally documented incorrectly (as if it had been applied) and has since been corrected in [`docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md`](VEHICLE_REID_FINDINGS_AND_DECISIONS.md) — see that doc's "Against blur fragility" section for the full correction. This plausibly explains why the blur condition was one of the two metrics that got *worse*, not better, after fine-tuning — worth treating as the leading hypothesis before this gets revisited, rather than assuming the mechanism was tried and simply underperformed.

**A real bug found wiring ONNX export:** the model's real forward pass returns a 1280-dim feature (768+512 concatenated), not the 512-dim Phase 0's evaluation code expects — found by reading `make_model_clipreid.py`'s `forward()` directly, not assumed. **Decision, confirmed with the project owner:** export only the 512-dim projected feature via the model's own `get_image=True` code path (a real embedding CLIP-ReID's authors designed for retrieval, not a truncation) — keeps Phase 0's tested evaluation code completely untouched.

**Dataset decision, corrected twice against real data:** the plan called for training on VeRi-Wild (174 cameras, the most camera-diverse public vehicle Re-ID dataset — verified via research over VeRi-776's 20 or VehicleID's 1 camera). Once the real 8.2GB download was actually inspected, it turned out the only accessible mirror contains VeRi-Wild's **test** split only (~10,000 vehicles) — confirmed by direct inspection (zero overlap with the official training-split ID list; full overlap with the test-split list). The official training split is Baidu-Pan-gated, the same dead end as Phase 0's PVEN weights — a recurring pattern in this research area, not a one-off. **Decision, made deliberately with the project owner, not silently worked around:** use the test-designated split as actual training data — legitimate because the train/test label is the original authors' own benchmarking convention, and the one real requirement (never train on VeRi-776, the baseline model's own training data) is still satisfied.

**Four real data-pipeline bugs found and fixed** while preparing that training data (`training/prepare_veriwild_training_data.py`): a missing-file crash fixed to skip-and-report; a potential train/eval leakage between two VeRi-Wild subset files, fixed to prefer non-training vehicles for the gallery/query stub; a related fallback-selection bug when every vehicle ends up selected for training; and a silent cross-test pollution bug where the vendored repo's `bases.py` sets a global PIL flag as an import side effect, breaking an unrelated Phase 0 test later in the same pytest run — fixed with an autouse fixture that resets the flag.

**Real, honest result — not a clean win, not hidden:** the 500-vehicle probe fine-tune improved the clean-image gap (0.1568 → 0.1783, meeting the project's own success criterion) and improved low-light and heavy-crop conditions, but got slightly *worse* on blur and tiny-resolution. See the correction above for the leading explanation on blur specifically. Full before/after numbers: [`vehicle-reid/reports/phase1-500vehicle-finetune-before-after/before_after_comparison.md`](../vehicle-reid/reports/phase1-500vehicle-finetune-before-after/before_after_comparison.md).

**Real operational problem, not a code bug:** Colab's free-tier GPU quota ran out mid-training, with no way to guarantee the same account/device would be available to resume. This produced a real, permanent infrastructure fix — a resume-from-checkpoint mechanism (`--resume_from` in `train_clipreid.py`, checkpoints saved every 10 epochs instead of only at the end, output pointed at Google Drive so it survives disconnects) — documented in [`vehicle-reid/training/HANDOFF.md`](../vehicle-reid/training/HANDOFF.md), including why simply merging independently-trained weight files across two people does not work (independent weight divergence, mismatched embedding table sizes).

**The actual training artifact:** [`vehicle-reid/training/phase1_finetune.ipynb`](../vehicle-reid/training/phase1_finetune.ipynb) is the real Colab notebook used for the run that produced the currently-deployed model (hardcoded `NUM_CLASSES=500`, `CAMERA_NUM=114` for this specific 500-vehicle subset) — [`vehicle-reid/training/README.md`](../vehicle-reid/training/README.md) documents the general workflow it follows.

**Status:** production currently runs this 500-vehicle fine-tune. A full 10,000-vehicle training run is the next step to replace it, using the same resume/handoff mechanism — swapping it in later is a one-line config change (`VEHICLE_REID_MODEL_PATH`), not a rebuild.

**Full detail:** [`docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md`](VEHICLE_REID_FINDINGS_AND_DECISIONS.md) (Phase 1 sections), design/plan docs dated 2026-08-31 in [`docs/superpowers/specs/`](superpowers/specs/) and [`docs/superpowers/plans/`](superpowers/plans/).

### Phase 2 — Detection + storage pipeline (from a photo to a searchable fingerprint)

**Goal:** build the actual pipeline that goes from "a photo exists" to "a vehicle's fingerprint is stored, findable by future queries" — with the same "verify, don't assume" discipline as Phase 0/1, and an explicit scope boundary: prove the pipeline mechanics work, not claim the still-imperfect Phase 1 model's matches are accurate.

**Detector choice, verified not assumed:** YOLO11n was chosen over alternatives (YOLO26, RT-DETR, etc.) after a real comparison — and, unlike Re-ID, needed **no fine-tuning at all**, since its COCO pretraining already covers the exact classes needed (car, truck, bus, motorcycle).

**A real install bug, found by inspection not assumption:** `pip install ultralytics` on this GPU-less machine silently began downloading the full NVIDIA CUDA stack (2GB+) — discovered only by inspecting the actual downloaded wheel files in `/tmp`, not by watching the progress bar (which looked like normal, if slow, progress). Fixed by installing CPU-only torch explicitly first, so `ultralytics`'s dependency resolver treats torch as already satisfied.

**Storage decision, verified not assumed:** confirmed via Neon's own documentation that `pgvector` is supported before committing to the design — not every managed Postgres allows arbitrary extensions, so this was checked rather than hoped.

**Real end-to-end run, with honest misses investigated, not swept under the rug:** 22 real vehicle sightings detected, embedded, and stored from a real COCO128 test subset. Two real misses were found and investigated by actually looking at the images: a black-and-white antique motorcycle (a genuine out-of-distribution case for the detector) and tiny aerial-view cars (a genuine detector-scale limitation, not a bug).

**A real, accidental duplication bug:** the pipeline was run twice by mistake during manual testing, producing 44 rows instead of 22 — fixed with a real SQL deduplication query, confirmed back down to the correct unique count.

**Self-consistency proven, not assumed:** the same photo, embedded once during a batch run and again during a later query run, produced an identical similarity score (1.0000) — proving the detect → crop → embed → search → rank chain has no randomness or corruption anywhere in it.

**Full detail:** [`docs/VEHICLE_DETECTION_PHASE2_FINDINGS_AND_DECISIONS.md`](VEHICLE_DETECTION_PHASE2_FINDINGS_AND_DECISIONS.md) (Parts 1-8).

### Phase 2 → 3 — The HTTP API and route formation

**Goal:** let a frontend actually call this system — explicitly *just* the API in this step, no frontend work — and answer a real question first: is it responsible to build an API on top of a Re-ID model that's known to still have weaknesses?

**Decision, explicitly talked through with the project owner before building anything:** yes — because the embedder model is a swappable config value (`VEHICLE_REID_MODEL_PATH`), never baked into the API's code or response shape. Swapping in the eventual 10,000-vehicle model later changes one env var, not the API.

**Route formation, not just a flat similarity list — the actual design ask:** `POST /vehicles/route` doesn't just return "similar sightings" — for each detected vehicle it returns past sightings **sorted chronologically** (not by similarity), each enriched with the real camera name and lat/long (an inner join against Model 1's own `camera` table), so a frontend can draw it as an actual route on a map. The similarity cutoff for "is this the same vehicle" (`ROUTE_SIMILARITY_THRESHOLD`, set to 80% at the project owner's direction) is explicitly documented as **not a validated number** — kept as an environment variable specifically so it can be retuned without a code change once there's real data to tune against.

**A real, environment-specific bug, diagnosed rather than guessed at:** database connections in this dev sandbox hung indefinitely. Root cause, confirmed directly: DNS for the Neon hostname returns IPv6 addresses before IPv4, and this sandbox's IPv6 "route" is a non-functional link-local router advertisement — every connection attempt silently hung trying IPv6 first. A Python-level `socket.getaddrinfo` monkeypatch was tried and **confirmed not to work** (psycopg2/libpq does its own C-level DNS resolution, invisible to Python's `socket` module). **Real fix:** resolve the hostname to IPv4 once and pass it via libpq's `hostaddr` connection parameter, while keeping `host` for TLS certificate verification — libpq's own documented mechanism for exactly this situation. Applied once in `sighting_store.py`'s connection helper, so every caller (the API, batch scripts, query scripts) benefits, not just one script. The same underlying IPv6 problem was hit independently on Model 1's Node/Prisma side too and needed a *different* fix there (`@prisma/adapter-pg`, since Prisma's default engine does its own invisible DNS resolution) — see [`model1-service/docs/MAIN.md`](../../model1-service/docs/MAIN.md)'s AI Registry section for that side of the story.

**A real `src`-package name collision, reproduced before fixing:** both sibling Python projects have a directory literally named `src` with no `__init__.py`. Running the API via `uvicorn src.api:app` bound the name `src` to the wrong project's directory, silently shadowing the sibling project's own `src` — reproduced in an isolated snippet to confirm the exact mechanism before fixing it, rather than guessing. Fixed by adding `vehicle-reid/src` itself (not `vehicle-reid/`) to `sys.path` and importing bare module names, avoiding the shared name entirely.

**Verified three ways, not just unit-tested:** a real pytest run against the live database, a real standalone `uvicorn` server process (not just FastAPI's `TestClient`), and a real `curl` upload against that live server returning the exact approved response shape.

**Full detail:** [`docs/VEHICLE_DETECTION_PHASE2_FINDINGS_AND_DECISIONS.md`](VEHICLE_DETECTION_PHASE2_FINDINGS_AND_DECISIONS.md) Part 9.

### Phase 3 → Frontend — Vehicle Search UI

**Goal:** a real page in Sentinel's existing frontend, matching its actual design system pixel-for-pixel — not a bolted-on, differently-styled feature.

This phase's design decisions, page-by-page spec, and the real design-reference story (a Claude Design mockup export that needed tracking down before the UI could be built to match it exactly) live in Model 1's own docs, since the frontend is a Model 1-owned codebase: see [`model1-service/docs/starter/Vehicle-ReID-Frontend-PRD.md`](../../model1-service/docs/starter/Vehicle-ReID-Frontend-PRD.md) and [`model1-service/docs/MAIN.md`](../../model1-service/docs/MAIN.md)'s AI Registry section. Not duplicated here — this file's job is the AI Registry side of the system, not the frontend.

## Current Status Summary

| Phase | What | Status |
|---|---|---|
| Pre-Phase-0 | Direction research (facial recognition / generic analytics rejected, vehicle Re-ID chosen) | Complete |
| Phase 0 | Honest baseline established (VRIC, gap 0.1568) | Complete |
| Phase 1 | 500-vehicle fine-tune (mixed, honest result) | Complete — currently deployed |
| Phase 1 (full-scale) | 10,000-vehicle fine-tune | In progress |
| Phase 2 | Detector + pgvector storage pipeline | Complete |
| Phase 2 → 3 | HTTP API (`POST /vehicles/route`) | Complete — **no authentication of its own yet, a real flagged gap** |
| Frontend | Vehicle Search UI (`frontend/src/pages/vehicle-search/`) | Complete |

## Known Issues

- **The 500-vehicle model's blur augmentation was never actually applied during training**, despite being documented otherwise until this file's audit caught it — see Phase 1 above and the correction in [`docs/VEHICLE_REID_FINDINGS_AND_DECISIONS.md`](VEHICLE_REID_FINDINGS_AND_DECISIONS.md). Plausible explanation for the blur condition's post-finetune regression; not yet re-tested with the fix.
- **Real bug, found and fixed while setting up GitHub portability:** `vehicle-detection`'s API, and its `run_batch.py`/`query_similar.py` scripts, all defaulted `DEFAULT_EMBEDDER_MODEL` to the **base, untrained** model (`vehicle_vit_clip_reid.onnx`), not the fine-tuned one — and `VEHICLE_REID_MODEL_PATH` (the intended override) was never actually set anywhere. This meant every real test and demo run during this project (including the ones cited in this very doc) was silently running the weaker base model, not "the currently-deployed 500-vehicle fine-tune" as claimed elsewhere. **Fixed:** all three defaults now point at `vehicle_vit_clip_reid_finetuned.onnx`. The fine-tuned model is also now published on Hugging Face (`meet0326/vehicle-reid-500-finetuned`) and fetched automatically by `vehicle-reid/scripts/fetch_model.py`, alongside the base model — so a fresh clone gets the real, correct default without needing to train anything or manually copy a file.
- **The vehicle-detection API has no authentication of its own** — the frontend route is access-gated, but the API itself isn't. A real gap, not yet closed; most likely fix is reusing Model 1's existing JWTs since it's the same user base.
- **No dedicated Phase 1 or Phase 2 architecture/QA docs exist** in the same structured format Phase 0 has (`docs/architecture/vehicle-reid-phase0-architecture.md`, `docs/testing/phase0-qa.md`) — the two FINDINGS_AND_DECISIONS docs informally cover this ground for Phase 1/2 but don't provide the same as-built architecture view or per-test-file QA breakdown.
- **The IPv6 dev-sandbox connection bug** (see Phase 2→3 above) is a sandbox-environment issue, not a production concern — flagged so a future setup on different infrastructure doesn't waste time re-diagnosing the same symptom (a DB connection that hangs or fails with "can't reach database server") if it reappears.
- **`npm audit`-equivalent for Python dependencies has not been run** — no automated dependency vulnerability scan has been done on either sub-project yet.

## Future Improvements

- **Complete the full 10,000-vehicle Re-ID training run** and re-run the full before/after evaluation — the next concrete step, already unblocked by the resume/handoff mechanism built in Phase 1.
- **Re-test blur robustness with blur augmentation actually wired in** — a real, testable hypothesis from the Known Issues correction above.
- **Close the vehicle-detection API authentication gap.**
- **Write Phase 1 and Phase 2 architecture/QA docs**, matching Phase 0's structured format, for anyone auditing this project's build discipline end-to-end.
- **Video/frame-extraction ingestion** — this entire system is currently images-only; turning a video feed into a steady stream of frames feeding the same detect → embed → store pipeline is a tracked, not-yet-started piece of the roadmap.
- **ANPR (plate recognition) fusion** — explicitly deferred at the very start of this project (see "Why This Project Exists" above), to be revisited once visual Re-ID is solid.
- **Route export/save** for the frontend's Vehicle Search results — not built yet, an open product question tracked in [`model1-service/docs/starter/Vehicle-ReID-Frontend-PRD.md`](../../model1-service/docs/starter/Vehicle-ReID-Frontend-PRD.md).
