# AI Strategy — Research Summary & Build Roadmap

## Vehicle Re-Identification for Sentinel / CamOps (Models 2-5)

**Purpose of this document:** this is the full context trail — what we researched, why we rejected the "obvious" approach, what we decided to build instead, and the exact phased plan to build it. Written to be handed directly to an AI coding agent (or a new teammate) so they have complete background before writing any code.

---

## Part 1: Why We Didn't Just Build "The Obvious AI Feature"

The starting instinct for this hackathon was to avoid the default pattern of reading the problem statement and building exactly what's asked without questioning it. Before picking an AI direction, we did real market/policy research on India's government CCTV and AI surveillance landscape. That research materially changed our plan. Key findings:

### Finding 1: The Real Bottleneck in Indian Government CCTV Is Broken Hardware, Not Missing AI

CAG audits and multiple city reports (Delhi, Hyderabad, Bengaluru, Punjab, Himachal Pradesh) consistently show **30-44%+ of government CCTV cameras non-functional** at any given time — due to power cuts, theft, expired maintenance contracts, and no single accountable owner. This directly validates the Model 1 features already built (camera health monitoring, predictive maintenance, integration-readiness scoring) as more operationally important than they might first appear — they solve the documented #1 real-world failure mode, not a hypothetical one.

### Finding 2: Facial Recognition in India Has a Severe, Documented Accuracy and Legitimacy Problem

- Delhi Police's own court testimony: their FRT system ran at **2% accuracy in 2018**, **under 1% in 2019**.
- A man spent **4.5 years in custody** partly on an 80% FRT similarity score from a riot-scene video; over 80% of similar FRT-based cases that reached verdict ended in acquittal/discharge.
- Nationally, of **170 government-commissioned facial recognition systems**, only **~20 are actually operational** (~12%) — the rest stuck in procurement/implementation limbo, per the Internet Freedom Foundation's Project Panoptic tracker.
- No Indian law currently defines the evidentiary weight of an FRT match in court.

**Conclusion:** facial recognition should never be built as an autonomous "AI finds and flags a person" feature. If used at all, it must be a human-confirmed, confidence-scored, fully audit-logged lead-generation tool — never an automatic action trigger.

### Finding 3: Gujarat Isn't a Blank Slate

Gujarat Police has run an **AI Intelligence Fusion Centre in Ahmedabad since 2023**, integrating CCTNS, Dial 112, VAHAN, and forensics data for active crime forecasting. Our platform is very likely meant to eventually **feed this existing system**, not duplicate it — our outputs should be designed to be consumable by a downstream intelligence platform.

### Finding 4: The Compliance Ground Shifted Recently

India's DPDP Act implementing rules were only notified in **November 2025** (18-month transition to May 2027). Required controls — encryption, RBAC, tamper-resistant audit logs, breach-response readiness — are exactly what Model 1 was already designed with. Almost no existing government system has caught up to this yet; framing compliance as core architecture (not an afterthought) is a genuine, current differentiator.

### Finding 5: The Commercial Landscape Already Has "Connect Any Camera + AI" Vendors

Staqu (JARVIS) and Innefu Labs already sell exactly this pitch across 8+ Indian states. Notably, even they are moving away from pure facial recognition (Staqu holds a patent for **non-facial person re-identification**) and toward **sovereign/on-premise AI** (Innefu's "Sarvagata AI," fully air-gapped) — both signals that the market itself is validating a more cautious, appearance-based, data-sovereign approach over black-box biometric matching.

### Finding 6: ANPR in India Has Specific, Well-Documented Technical Failure Modes

Over 50 license plate formats, huge font/layout variation, and two-wheelers (small, often dirty/bent/non-standard plates) are the dominant, specifically-Indian accuracy killers — more so than the core OCR technology itself.

### What We Decided NOT to Build

- Generic, unqualified "AI identifies criminals via facial recognition" — reputationally and technically the riskiest option, given the documented history.
- A generic "connect any camera via IP" pitch — already an existing commercial claim (Staqu), not a differentiator.
- Anything that ignores the hardware-reliability reality in favor of only flashy analytics.

---

## Part 2: The Chosen Direction — Vehicle Re-Identification

### The Core Idea

Instead of relying solely on license plate reading (which fails often — see ANPR findings above), build a system that can identify and track a specific vehicle across multiple cameras using its **visual appearance** — color, shape, model, dents, stickers, modifications — functioning as a "fingerprint" that works even when the plate is unreadable. Combine this with plate reading (used when available) rather than replacing it, since the two signals fail in different situations and cover each other's blind spots.

### Why This Direction Is Defensible

- It's a real, established research field (**Vehicle Re-Identification / Re-ID**), not a made-up idea — validated by an annual NVIDIA-run competition (**AI City Challenge**, since 2018) with published, working solutions.
- It avoids the facial-recognition legitimacy trap entirely — vehicle appearance is not biometric/personal-identity data the way a face is.
- It directly serves the hackathon's own required test case: tracing a designated vehicle's movement across the camera network using a plate number — visual Re-ID makes this robust even when the plate can't be read at some camera locations, which real-world footage guarantees will happen.
- There is a **genuine, confirmed gap**: no major public Indian vehicle Re-ID dataset exists (only vehicle-type classification datasets like IDD, ITD, FGVD, BMD-45). Building even a basic working Indian-tuned version is genuinely novel, not a copy of an existing solved problem.

### How the Technology Works (Plain-Language Summary)

1. Show an AI model thousands of vehicle photos, labeled by identity (same car from different angles vs. different cars).
2. The model learns to convert any vehicle photo into a numeric "fingerprint" (an **embedding**).
3. Similar fingerprints → same vehicle. Different fingerprints → different vehicles.
4. The model learns to weight things like color/shape/damage/stickers, while ignoring irrelevant variation like lighting or camera angle.

### Public Datasets Available (Global, Not Indian)

| Dataset   | Contents                                                                          |
| --------- | --------------------------------------------------------------------------------- |
| VeRi-776  | ~50,000 images, 776 vehicles, 20 real cameras                                     |
| VehicleID | 220,000+ images, 26,000+ vehicles                                                 |
| VeRi-Wild | 400,000+ images, 40,000+ vehicles, 174 cameras                                    |
| CityFlow  | Real US traffic footage, used in NVIDIA AI City Challenge                         |
| VRIC      | ~60,000 images, deliberately includes real-world mess (blur, low-res, odd angles) |

**Confirmed gap:** all of the above are Chinese/American 4-wheeler datasets. No equivalent Indian dataset exists for this specific task (vehicle re-identification, not classification). India's two-wheeler-dominant vehicle mix (~78% of vehicles) is essentially unrepresented in any of these.

### Public Repos & Pretrained Models to Build On

- **Curated reference lists:** `knwng/awesome-vehicle-re-identification`, `layumi/Vehicle_reID-Collection`
- **Ready-to-train baseline code:** `Jakel21/vehicle-ReID-baseline` (ResNet50 backbone, VeRi/VehicleID support)
- **Downloadable pretrained weights:** `silverbulletmdc/PVEN` (pretrained on VeRi-776 and VeRi-Wild)
- **Recommended primary toolkit:** `torchreid` (Kaiyang Zhou) — actively maintained, includes the lightweight **OSNet** architecture, supports loading VeRi-776-pretrained weights and fine-tuning on custom data
- **Proven competition-winning reference code:** `zhengthomastang/2018AICity_TeamUW` — a real 1st/2nd place NVIDIA AI City Challenge solution combining detection, tracking, and plate matching end-to-end

### The Plate + Visual Fusion Logic (Core Design Decision)

Never treat plate reading and visual matching as either/or — combine both into one confidence-scored decision:

```
For every vehicle spotted by a camera:
  1. Attempt plate read (ANPR)
     → high-confidence read → trust it strongly
  2. Always generate the visual embedding regardless
  3. Combine:
     → plate match + visual match         → very high confidence
     → plate unreadable, visual match     → flagged, lower confidence label
     → plate mismatch + visual mismatch   → confidently different vehicles
  4. Always surface the confidence level to the human operator —
     never a flat yes/no (same principle as the FRT lesson in Part 1)
```

This mirrors what actual NVIDIA AI City Challenge winning teams did — plate matching and visual Re-ID were explicitly combined, not chosen between, because they fail in different, non-overlapping situations (see table):

| Situation                                | Plate Reading                     | Visual Fingerprint            |
| ---------------------------------------- | --------------------------------- | ----------------------------- |
| Vehicle far from camera / low resolution | Fails easily                      | Still works reasonably        |
| Plate dirty, bent, or obscured           | Fails                             | Unaffected                    |
| Two vehicles are same model/color        | Works perfectly (plate is unique) | Struggles                     |
| Night / poor lighting                    | Struggles                         | Also struggles, less severely |

---

## Part 3: The Build Roadmap — Phased, With Clear Prerequisites

This is the mental model for how to actually build this without getting blocked. Each phase states exactly what's newly required and what's reused from what already exists (Model 1: camera registry, GIS map, audit-log pattern, PostgreSQL).

### Phase 0 — Prove the Concept (No New Infrastructure Needed)

**Goal:** get an honest baseline of how a global pretrained model performs on Indian vehicles, before any fine-tuning.

**Needed:**

- Python + PyTorch environment
- `torchreid` installed (`pip install torchreid`)
- A pretrained checkpoint (from PVEN or torchreid's model zoo)
- ~20-30 Indian vehicle photos (self-collected — no cameras or dataset needed)
- Optional free GPU (Google Colab free tier) — a CPU works fine at this tiny scale, just slower

**Output:** a demonstrable, honest result — "here's how an off-the-shelf model performs on Indian vehicles, before fine-tuning" — a legitimate presentable artifact on its own.

**Dependency on existing system:** none. Fully standalone.

---

### Phase 1 — Fine-Tune for Indian Conditions

**Goal:** specialize the pretrained model on real Indian vehicle appearance.

**Needed:**

1. **Labeled, identity-grouped data** (harder than plain photos — needs multiple images of the SAME vehicle, grouped together):
   - Manually staged mini-dataset now (photograph 5-10 known vehicles from multiple angles) — start immediately, don't wait
   - **ANPR-bootstrapped labels**, once hackathon camera access opens: run plate-reading across the ~50 test cameras; wherever the plate reads clearly, that's a free, automatic "same vehicle" label — use these plate-confirmed groupings to train the visual model to recognize the same vehicle WITHOUT the plate. (Use the reliable signal to generate training data for the fallback signal — a standard, established pattern in this field.)
   - Supplementary public Indian dashcam/traffic footage as bonus visual variety (not primary source)
2. **Training compute:** Google Colab or Kaggle Notebooks free-tier GPU is sufficient at this scale; no paid cloud GPU needed to start
3. **Evaluation methodology:** a held-out test set, scored with the field's standard metrics — **Rank-1 accuracy** (is the top suggested match actually correct?) and **mAP** (how well-ranked are all correct matches, not just the top one)

**Dependency on existing system:** the hackathon's provided camera feeds (for the ANPR-bootstrapped labeling step) — not Model 1's registry itself.

---

### Phase 2 — Build the Live Pipeline

**Goal:** move from "tested on static photos" to "runs against live/recorded camera feeds."

**Critical missing piece to plan for:** Re-ID cannot run on a raw camera frame directly — it needs an already-cropped vehicle image. The real pipeline is two models, not one:

```
Raw camera frame
   → Vehicle Detector (e.g. YOLO) finds and crops each vehicle
   → Each crop → Re-ID model → generates embedding ("fingerprint")
   → Embedding compared against previously stored embeddings
```

**New infrastructure needed:**

- A **vehicle detector** model (e.g. YOLO) — a separate component from Re-ID itself
- **Vector similarity search capability** — storing embeddings and quickly finding "which past sightings look most similar to this new one." Recommended approach: **`pgvector`**, a PostgreSQL extension — adds this capability directly onto the Postgres instance already running for Model 1, avoiding a whole new specialized database system
- A new **`vehicle_sighting`** table:
  ```
  vehicle_sighting_id, camera_id (FK → Model 1's camera table),
  timestamp, cropped_image_url, embedding_vector,
  matched_plate (nullable), plate_confidence, visual_confidence
  ```

**Dependency on existing system:** reuses Model 1's `camera` table (via foreign key) and the same PostgreSQL instance (via the `pgvector` extension) — no duplication of camera metadata.

---

### Phase 3 — Full Integration Back Into the Platform

**Goal:** turn tracked sightings into the actual "show me this vehicle's route" feature.

**What's reused, not rebuilt:**

- **Route visualization** → Model 1's existing GIS/map component (Leaflet) — just a different data source (time-ordered vehicle sightings instead of static camera pins)
- **Camera/location context** → Model 1's existing `camera` table — no duplication
- **Audit logging** → reuse Model 1's existing audit-log pattern for "who queried which vehicle's route, when" — a governance decision worth making now (consistent with the DPDP/compliance-by-design differentiator from Part 1), not retrofitted later

**Architectural placement:** consistent with the earlier modular-monolith-vs-microservices decision for this project — this Re-ID/video pipeline is exactly the kind of component that justifies being a **separate deployed service** from Model 1 (GPU-heavy compute, different scaling triggers, different failure blast radius), communicating with Model 1 only through its existing public API.

---

## Part 4: Summary Roadmap Table

| Phase                       | New Requirement                                                                                 | Reused From Existing System                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **0 — Prove it works**      | Python, torchreid, ~20 photos, optional free GPU                                                | Nothing — fully standalone                                  |
| **1 — Fine-tune for India** | Labeled Indian data (staged + ANPR-bootstrapped), free-tier GPU, eval methodology (Rank-1, mAP) | Hackathon camera feeds (for labeling only)                  |
| **2 — Live pipeline**       | Vehicle detector (YOLO), `pgvector` extension, new `vehicle_sighting` table                     | Existing PostgreSQL instance, Model 1's `camera` table (FK) |
| **3 — Full integration**    | New, separately-deployed service                                                                | Model 1's GIS map, camera registry, audit-log pattern       |

---

## Part 5: What We're Ultimately Trying to Achieve

A vehicle-tracking capability that:

1. **Works even when license plates fail** (the documented norm for Indian ANPR conditions), by using visual appearance as a fallback identity signal — not a replacement for plate reading, but a complement to it.
2. **Is honestly benchmarked**, not black-boxed — reporting real Rank-1/mAP numbers, and being explicit about current limitations (e.g., two-wheeler Re-ID as a known gap, not a hidden weakness).
3. **Avoids the facial-recognition legitimacy trap** entirely, by never dealing in biometric identity — only vehicle appearance — while still applying the same governance lesson (confidence scores, human review, audit trails) that FRT's failures taught us.
4. **Fills a genuine, confirmed research gap** (no public Indian vehicle Re-ID dataset exists) rather than re-implementing an already-commercialized pitch (generic "connect any camera" platforms already sold by Staqu/Innefu).
5. **Is architected to plug into the bigger picture** — feeding Gujarat's existing Ahmedabad Intelligence Fusion Centre conceptually, and integrating cleanly with the already-built Model 1 camera registry, GIS map, and audit-log infrastructure, rather than duplicating any of it.

This document, together with the Model1-PRD.md and Model1-Low-Level-Design.md files already built, should give any AI coding agent or new teammate full context to start Phase 0 immediately.
