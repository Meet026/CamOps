# Sentinel — What We've Built, and Why

**Project:** Sentinel, built for the Gujarat Police Innovation Hackathon 2026.

This document explains the entire system end to end: the problem it solves, the three services that make it up, what was implemented in each one, and — most importantly — the reasoning behind the major decisions. It's written to be understood on its own, without needing access to the underlying codebase.

**Current status:** The camera-registry backend is complete (one map feature deliberately postponed). The web app is built and working against that backend. The vehicle-tracking AI system has completed its first two development phases and is functional end-to-end, with a larger-scale model upgrade in progress.

---

## 1. The Problem, and the Three Systems We Built to Solve It

**The problem:** more than 26 different Gujarat government departments each run their own CCTV cameras independently. Nobody has a single, trustworthy answer to basic questions like: how many cameras actually exist, where are they, who owns them, are they even switched on and working, and how hard would it be to plug any of them into a future video-analytics platform. Before any "smart" video or AI system can be built on top of this, someone has to answer those foundational questions first.

We built three separate systems, in this order, because each one depends on the last:

1. **A camera registry backend** — the system of record. It tracks every camera's identity, location, ownership, technical details, and live health status. Nothing about video streaming or AI analytics lives here — it is purely an inventory and mapping system.
2. **A web application** — the interface that officers, department staff, administrators, and auditors actually use to register cameras, view the map, verify data, and monitor health. It's the human-facing layer on top of the registry.
3. **A vehicle re-identification system** — a separate AI system that can look at a photo of a vehicle and tell you which of the registered cameras have also seen that same vehicle, and when — reconstructing a route of sightings across the camera network.

These three run as genuinely separate services (different programming languages and runtimes for each), talking to each other only through a shared database or a stable, well-defined API — never by directly reaching into each other's internals. This was a deliberate choice: it means each piece can be worked on, scaled, or even replaced independently without the others breaking.

**Deliberately left out, by design:** actual live video streaming, recording, or playback; AI video analytics such as facial recognition, license-plate reading, or object detection; integration with other government databases (vehicle registration, criminal records, etc.); a dedicated mobile app. These are all much harder, more sensitive problems that depend on the registry existing first — building them prematurely would have meant guessing at requirements before the foundation was proven, and in the case of facial recognition specifically, would have meant building something with real documented legal and accuracy risk (explained in the next section).

---

## 2. Why We Didn't Just Build "The Obvious AI Feature" — The Research Behind Our Direction

Before writing a single line of AI code, real research was done into how AI-driven CCTV and surveillance systems actually perform in India today — not just how they're pitched. That research changed the plan substantially, and it's worth explaining because it justifies several choices described later in this document.

**What the research found:**

1. **The real bottleneck in Indian government CCTV is broken hardware, not missing AI.** Government audit reports and city-level studies (covering Delhi, Hyderabad, Bengaluru, Punjab, and Himachal Pradesh) consistently found that **30–44% or more of government CCTV cameras are non-functional at any given time** — due to power outages, theft, lapsed maintenance contracts, and nobody being clearly accountable for any single camera. This is a huge, well-documented, mostly invisible failure mode. It's the direct reason we prioritized building **camera health monitoring and an "is this camera actually usable" scoring system** as core, first-priority features — rather than jumping straight into flashy analytics that would sit on top of an inventory nobody could trust.

2. **Facial recognition in India has a severe, well-documented accuracy and legal-legitimacy problem.** Delhi Police's own facial-recognition system was reported, in their own court testimony, to run at roughly 2% accuracy in 2018 and under 1% in 2019. In one documented case, a man spent four and a half years in custody partly because of an 80%-similarity facial-recognition match from a riot scene — and the large majority of similar facial-recognition-based cases that reached a verdict ended in acquittal. Of 170 government-commissioned facial recognition systems tracked nationally, only around 20 (about 12%) are actually operational. No Indian law currently even defines how much evidentiary weight a facial-recognition match should carry in court. **Given this, we made a firm decision: never build facial recognition as a feature that autonomously "finds and flags a person."** If anything biometric-adjacent is ever built, it must always require human confirmation, always show a confidence score, and always be fully logged — never trigger an automatic action on its own. In practice, we chose not to build facial recognition at all.

3. **Gujarat already has its own intelligence-fusion system.** Gujarat Police has run an AI Intelligence Fusion Centre in Ahmedabad since 2023, which already pulls together crime records, emergency-call data, vehicle registration data, and forensics data for active crime forecasting. Whatever we build is far more likely to eventually feed into that existing system than to replace or duplicate it — so our outputs are designed to be usable downstream, not siloed off on their own.

4. **India's new data-protection law changed the compliance landscape very recently.** The rules under India's Digital Personal Data Protection Act were only formally issued in November 2025, with an 18-month transition period. The controls it requires — encryption, role-based access control, tamper-resistant audit logs, and breach-response readiness — are exactly what we built into the registry system from the very beginning, not added on afterward. Almost no existing government system has caught up to this yet, so treating compliance as core architecture rather than an afterthought is a genuine, current advantage.

5. **The commercial market already sells generic "connect any camera plus AI" platforms.** Companies like Staqu and Innefu Labs already sell exactly this pitch across eight or more Indian states, so building the same thing would add nothing new. Tellingly, even those companies are moving away from pure facial recognition — one holds a patent specifically for *non-facial* person re-identification — and toward fully on-premise, data-sovereign AI. That's a market signal validating a more cautious, appearance-based approach over black-box biometric matching.

6. **License-plate reading in India has specific, well-known failure modes.** There are more than 50 different plate formats in use, huge variation in fonts and layouts, and two-wheelers — which make up roughly 78% of vehicles in India — routinely have small, dirty, bent, or non-standard plates. These are the dominant reasons plate-reading fails in practice, more so than any limitation of the underlying text-recognition technology itself.

**What we decided to build instead: vehicle re-identification by visual appearance.** Rather than relying solely on reading license plates, we built a system that can recognize and track a specific vehicle across different cameras using its visual appearance — color, shape, model, dents, stickers, modifications — as a kind of visual fingerprint. This is designed to work alongside plate reading, not replace it, since the two approaches fail in different situations and cover each other's blind spots. We chose this direction because:

- It's a real, established field of research (there's been an annual international competition specifically for this, the AI City Challenge, since 2018) — not something we invented.
- It completely avoids the facial-recognition legitimacy problem described above, because a vehicle's appearance isn't personal biometric data the way a face is.
- It directly serves the most realistic real-world use case: tracing where a specific vehicle has been seen, even in the very likely situation where its license plate can't be clearly read at every single camera.
- It fills a genuine, confirmed gap — no public dataset for this exact task exists for Indian vehicles (only datasets for classifying vehicle *types*, not identifying specific individual vehicles), so even a basic working version tuned for Indian conditions is a real, novel contribution rather than a copy of something already solved.

---

## 3. The Camera Registry Backend

**What it's built with:** a modern Node.js backend framework (NestJS) with TypeScript, a PostgreSQL database with geographic/mapping extensions (PostGIS), and a database toolkit (Prisma) for talking to it safely. Access is controlled with industry-standard token-based authentication (JWT).

### 3.1 What it is and why it's built this way

This system is strictly an inventory and mapping tool — it stores information *about* cameras, never video *from* them. It answers: what cameras exist, who owns each one, exactly where is it located, how difficult would it be to integrate into a future video system, and is it currently reachable on the network?

Internally, it's built as a single deployed application organized into strictly separated internal modules — each responsible for one concern (cameras, health checks, mapping, scoring, authentication, etc.) — where one module is never allowed to directly access another module's data. It can only ask that module to do something on its behalf through a defined interface. This discipline was chosen deliberately for two reasons: it keeps the codebase from becoming tangled as it grows, and it means any one piece could later be pulled out into its own independently-scaled service without a rewrite, if that ever becomes necessary — without paying the real operational cost (network calls, coordination complexity, partial-failure handling) of splitting things apart before there's an actual need to.

### 3.2 What was built, and why each piece had to come in this order

| Stage | What it delivers | Why it needed to exist, and why at this point |
|---|---|---|
| **Foundational setup** | Consistent error handling, request tracing, rate limiting (to prevent abuse), and pagination rules applied across the whole system | Every feature built afterward depends on these being solid from day one — retrofitting consistent error formats or abuse protection after the fact is far more expensive than building it in from the start |
| **Database wiring** | Safe, validated connection to the actual production-style database, with a strict rule that all future schema changes go through tracked migrations, never manual edits | The database already existed from an earlier setup step; this stage made the application talk to it safely and established the ground rules for how it would ever change going forward |
| **Basic health/uptime check** | A simple "is the service itself alive and able to reach its database" check, for use by load balancers and monitoring tools | This is a different, simpler question than "is a specific *camera* online" (that comes later) — operations tooling needs this most basic signal before anything else matters |
| **Login and permissions** | Secure login with short-lived access tokens and longer-lived, revocable session tokens; four distinct user roles (administrator, field officer, department-level viewer, auditor); and strict enforcement that a department-level viewer can only ever see their own department's cameras | With 26+ departments' worth of sensitive data, real access control had to exist before any camera data could safely be entered into the system at all |
| **Automatic activity logging** | Every meaningful action (creating, editing, deleting, or exporting camera records) is automatically and permanently logged, including who did it and when | This registry's data may need to hold up as evidence in an investigative or legal context — there needs to be a permanent, trustworthy record of every change |
| **Core camera management** | Full ability to create, list, search, view, edit, and (soft-)delete camera records, storing a real GPS location for each one on an interactive map layer | This is the actual core purpose of the system — nothing else matters if cameras can't be reliably registered with an accurate location |
| **Bulk import and export** | The ability to upload a spreadsheet of up to roughly 10,000 cameras at once, processed in the background without freezing the system, plus the ability to export the current camera list back out as a spreadsheet | Onboarding 26 departments' worth of existing cameras one at a time through a form isn't realistic — departments need to be able to hand over an existing spreadsheet and have it imported in bulk |
| **Automatic integration-difficulty scoring** | Given a camera's brand and model, the system automatically determines (via a lookup table first, then an AI fallback if unknown) how easy or hard it would be to integrate that camera into a future video system — and routes uncertain AI guesses to a human reviewer for confirmation | A field officer registering a camera has no way to know technical details like whether it supports standard integration protocols. The system needs to figure this out on its own wherever possible, and honestly say "needs a human to check" wherever it genuinely can't — rather than forcing a technical question onto non-technical field staff |
| **Automated health monitoring** | A scheduled background job that periodically checks whether each network-connected camera is actually reachable, keeps a history of that, and flags cameras that have gone offline repeatedly as "at risk" | This feature exists specifically because of the "30-44% of government cameras are broken" finding described earlier — automatically detecting and flagging cameras that have gone dark, rather than relying on someone to notice, is arguably the single most operationally valuable feature in the whole system |
| **Interactive map features** | A live map showing all cameras within the current viewport, a simple grid-based analysis showing which geographic areas have no camera coverage at all, and an experimental incident-density overlay (clearly marked as a beta/placeholder feature) | A spreadsheet of coordinates doesn't show you *where the gaps in coverage actually are* — visualizing this on a map is what makes the information actually useful for planning purposes |

**One planned map feature — automatically detecting when two different departments have redundantly installed cameras covering the same physical spot — was deliberately postponed**, not forgotten. It was fully designed but set aside so that higher-value features could ship first. The same is true of automatically clustering map pins together at low zoom levels for readability.

### 3.3 Key design decisions, and the reasoning behind them

- **"We don't know" is treated as a valid, permanent answer — not a bug to be fixed.** If the system genuinely can't determine whether a camera supports a given integration standard, or can't currently reach it, that's recorded honestly as "unknown" rather than the system forcing a guess or blocking the user. This principle runs through the entire design.
- **Anything an AI determines is always visibly marked as unverified until a human confirms it.** This is a direct, deliberate application of the facial-recognition lesson from the research above: an automated guess must never be allowed to masquerade as a confirmed fact. Every AI-derived answer in the system is tagged as such in the data, and stays tagged that way until a person explicitly reviews and confirms it.
- **The system is designed to get smarter over time, automatically.** Once a human confirms an AI's guess about a particular camera brand and model, that confirmed answer is permanently saved to a reference table — so every future camera of that same brand and model resolves instantly from then on, with no AI call needed at all. This closes a self-improving loop instead of asking the AI to re-guess the same thing indefinitely.
- **Nothing is ever permanently deleted.** Removing a camera marks it inactive rather than erasing it, and every action is logged permanently — because this data may need to be defensible as evidence later.
- **Department-level access boundaries are enforced in exactly one place in the code**, rather than being re-implemented separately in every feature that touches camera data. This dramatically reduces the risk that some future feature accidentally forgets to apply the restriction. On top of that, if a department-level viewer tries to look up a camera belonging to a different department — even by guessing its ID directly — they get the exact same "not found" response as if it genuinely didn't exist. There is no way to even confirm that a camera exists in another department.
- **The AI vendor used for automatic scoring was chosen for practicality, not novelty.** The system needs to both interpret text (for the ONVIF-support guess) and read text out of photos (for the OCR-based brand-identification feature). A single AI model that natively handles both was chosen specifically so only one AI vendor integration was needed, rather than maintaining two separate ones for no real benefit.
- **Camera reachability checks are intentionally simple — a basic network connectivity check, not a full video-stream handshake.** Actually opening and validating a video stream is a much heavier, different problem that belongs to a future video-analytics system, not this registry. A simple "can we open a network connection to this device" check is enough to answer the actual question this feature needs to answer: is the camera there and responding.

### 3.4 How we verified it actually works

Every feature was built test-first — writing an automated test that fails, then writing the code to make it pass, rather than writing code first and testing after. As of the last full check, there were 38 automated unit-test groups covering 225 individual test cases, plus 12 broader end-to-end test groups covering 45 more test cases, all passing, and the full codebase compiles without a single type error. Beyond the automated tests, every feature was also manually walked through against a real running instance of the system with real data — because a passing automated test suite and an actually-working feature in practice are two different claims, especially for login/session flows and geographic map queries. Real bugs were found and fixed along the way through this process rather than assumed away.

---

## 4. The Web Application

**What it's built with:** a modern JavaScript framework (React) with TypeScript, a fast build tool (Vite), client-side routing, a data-fetching/caching library, a utility-first styling system (Tailwind CSS), interactive maps (Leaflet), and charts (Recharts).

### 4.1 What it is and why

The web application exists to make everything the registry backend can do actually usable by real people — field officers, department-level viewers, administrators, and auditors — none of whom should ever need to think about the underlying technical API. It was deliberately designed to feel like a focused, fast "command center" rather than a typical bureaucratic government portal, with the map treated as a central, first-class part of the experience rather than an afterthought bolted onto a form-heavy interface.

It was built directly against the real, already-working backend described in the previous section, with an explicit practice of tracking every case where the frontend needed something the backend didn't yet provide, rather than quietly faking that data. As of the most recent check, the large majority of those tracked gaps have been closed by adding the missing backend feature; the one that remains open is a deliberate, documented security-related tradeoff around how login sessions are kept alive, not an oversight.

### 4.2 What was built, feature by feature, and why each one exists

| Feature area | What it does | Why it exists |
|---|---|---|
| **Login** | A clean login screen with a live, ambient map in the background | The entry point and identity gate for a system holding department-sensitive data |
| **Overview dashboard** | A single-glance summary: total cameras, how many are online, how many are flagged "at risk," how many AI guesses are waiting for human review | So nobody has to click through five different pages just to see whether something needs attention |
| **Camera list, search, add/edit form, and detail view** | The full day-to-day camera-management experience, including a "use my current location" GPS button and a live preview of the automatic integration-difficulty score as the officer types in a brand and model | This is the core, everyday task the whole system exists to support — registering and maintaining accurate camera records |
| **Bulk upload page** | Drag-and-drop spreadsheet upload with a live progress bar while it processes in the background, and a downloadable template showing the required format | Matches the backend's background-processing bulk-import feature described earlier, with real-time visible progress rather than a black-box "please wait" |
| **Interactive map** | The full live map experience: color-coded camera pins (by online status or by integration difficulty), a coverage-gap overlay, and the experimental incident-density overlay (clearly labeled as a beta feature, matching the backend's own labeling, so nobody mistakes a placeholder for real data) | The visual "where are our coverage gaps" tool that a spreadsheet alone can't provide |
| **Scoring verification queue** | A simple card-based review screen where an administrator sees the AI's reasoning for an integration-difficulty guess and can confirm or reject it with one click | This is the human half of the "AI guesses, human confirms, system remembers" loop described above |
| **Health monitoring dashboard** | A dashboard of currently "at-risk" cameras (ones that have gone offline repeatedly), broken down by department | Directly surfaces the automated reachability-checking feature — the single most operationally important backend feature, made visible and actionable |
| **Audit log viewer** | A searchable, filterable log of every meaningful action taken in the system, including a detailed view of exactly what changed | The compliance and accountability feature — who changed what, and when, for a user base that may need this as evidence |
| **Settings** | Account details, a password-change form, a light/dark theme toggle, and (for administrators) a user-management screen | Basic self-service account management plus administrative control over who has access |
| **Vehicle search** | Upload a photo of a vehicle, crop it down to just that vehicle, and see a timeline of where else it's likely been seen across the camera network | The user-facing entry point into the separate vehicle re-identification system described in the next section |

### 4.3 Notable engineering decisions and the reasoning behind them

- **The short-lived login token is kept only in the browser's temporary memory, never written to persistent storage; only the longer-lived session-renewal token is saved to disk.** This was a deliberate security tradeoff to reduce how much damage a malicious script on the page could do, at the cost of the short-lived token needing to be silently refreshed periodically — a small, well-understood cost accepted in exchange for meaningfully better security.
- **If several parts of the page need to refresh the login session at the same moment, only one actual refresh request is made and everything else waits on it**, rather than firing off several redundant requests at once.
- **Heavier parts of the app (the map library and the charting library) are only downloaded by the browser when a user actually navigates to a page that needs them**, not on initial page load — so someone who only ever checks the login screen or dashboard isn't forced to download map and chart code they'll never use.
- **Menu items a user isn't allowed to access don't just appear disabled or greyed out — they don't render at all.** This mirrors the same principle used in the backend: don't even reveal that a restricted feature exists to someone who isn't permitted to use it.
- **The vehicle-search feature deliberately talks to its backend through a completely separate, independent connection setup from the rest of the app** — a different web address, no automatic login-token attachment (because, as explained below, that separate AI system doesn't have its own login system yet), and a different way of reading error messages back from it. This was done specifically so the interface accurately reflects the underlying reality — these genuinely are two separate systems — rather than papering over that difference and creating a false impression of one unified backend.
- **Nowhere in the app does a screen quietly show fake or placeholder data.** Any feature the backend didn't yet fully support was shown honestly as "not available yet," so nobody looking at the interface could ever mistake a stand-in value for a real one.
- **A traditional "forgot my password" email-reset flow was deliberately not built.** Building that safely requires email-verification infrastructure that didn't exist yet, and building it without that verification step would create a real account-takeover risk for a user base handling sensitive department data. Instead, a secure "change your password while logged in" flow was built, with full self-service password recovery intentionally left for a later phase once proper email verification is in place.

---

## 5. The Vehicle Re-Identification System

**What it's built with:** Python, a deep-learning framework used for training (PyTorch) and a lightweight, fast format for actually running the trained model (ONNX Runtime), an off-the-shelf object-detection model (YOLO) for finding vehicles in a photo, a lightweight Python web-service framework (FastAPI), and a vector-search extension added to the same PostgreSQL database the registry backend uses (pgvector).

This system is the direct, practical outcome of the research and reasoning explained in Section 2: track vehicles by how they look, not by faces, and not solely by license plates.

### 5.1 What it is, and why it's a separate system

This system shares the same underlying database as the registry backend — it looks up camera details (name, exact location) directly from the registry's own camera records — but otherwise runs as a fully independent system, in a different programming language, with different hardware needs (it benefits heavily from a graphics processing unit for the more intensive parts, unlike the lightweight registry backend). This follows the same reasoning given earlier for why the registry backend and the web app are kept as separate services: a component with meaningfully different resource needs and a different rate of change is a good candidate to stand on its own, connected only through shared data — not through shared code.

It's made up of two parts working together: the actual vehicle-recognition model itself, and everything around it — a component that finds and crops out vehicles from a raw photo, a place to store and search vehicle "fingerprints," and the web service that the vehicle-search page in the app actually talks to.

### 5.2 How it was built, phase by phase, and why each phase came before the next

| Phase | What it aimed to do | Why it had to happen at that point, not sooner or skipped |
|---|---|---|
| **Phase 0 — Establish an honest baseline** | Measure how well an existing, publicly available, pre-trained vehicle-recognition model performs on real vehicle photos, with zero customization | You can't know whether any later customization actually helped unless you first measure how good (or bad) the un-customized starting point really is. This phase required no new infrastructure at all — just the existing model and a small set of test photos |
| **Phase 1 — Specialize the model for real-world conditions** | Retrain (fine-tune) the model using a very large dataset of vehicle photos grouped by individual vehicle identity | The baseline measurement from Phase 0 showed the off-the-shelf model could not reliably tell "the same vehicle" apart from "a different vehicle" — this phase exists as a direct, measured response to that specific problem, not as an assumed next step |
| **Phase 2 — Build the working pipeline** | Add a real vehicle-detection step (to find and crop vehicles out of a full photo) and a way to store and quickly search vehicle "fingerprints" against past sightings | The recognition model on its own can only compare two already-cropped photos of individual vehicles — it can't do anything useful with a full, raw photo containing a whole scene. This phase is what turns "a model that can compare two photos" into an actual working system that takes in one photo and returns real results |
| **The web service** (delivered as part of Phase 2) | Expose the whole pipeline as a simple web endpoint the main application can call | This is the actual connection point the vehicle-search page in the web app uses — none of the above is useful to an actual officer until there's a working endpoint to send a photo to |

### 5.3 The results, reported honestly — including what didn't work

- **Before any customization, the off-the-shelf model struggled to reliably tell vehicles apart.** A careful check found that, at baseline, roughly half of all *different*-vehicle photo pairs scored higher on visual similarity than the single worst-scoring *same*-vehicle pair — meaning there was no single similarity threshold that could cleanly separate genuine matches from non-matches.
- **A real mistake was caught and corrected rather than hidden.** An early baseline measurement looked significantly better than it should have — but on review, it turned out that measurement had been taken using a test set that the model had actually already been trained on, which is an invalid way to measure real-world performance. The measurement was redone using a completely independent test set the model had never seen, and the corrected (lower, more honest) number was the one kept and reported going forward. Both the flawed and the corrected results were deliberately kept on record, clearly labeled, specifically so nobody would accidentally cite the wrong one later. Catching and documenting a mistake like this, rather than quietly keeping the better-looking number, was treated as more important than the headline result itself.
- **After the first round of customization (trained on 500 individual vehicles), measurable improvement was achieved** on the model's ability to separate matches from non-matches, and its performance in low-light and heavily-cropped conditions improved — but its performance on blurry images got slightly *worse*. The likely cause was identified: a blur-resistance training technique had been built and separately tested, but was never actually connected into the real training process used for this round. This is documented as a known, still-open issue rather than glossed over.
- **A second, much larger round of customization (using roughly 10,000 individual vehicles instead of 500) is currently in progress**, expected to improve results further.

### 5.4 What the working system actually does today

- Given a photo, an off-the-shelf vehicle detector automatically finds and crops out every vehicle (cars, motorcycles, buses, trucks) in the image — this part needed no customization at all, since general-purpose object detectors already handle these common vehicle categories well.
- Each cropped vehicle image is converted into a numeric "fingerprint" by the recognition model and compared against every previously stored fingerprint using a fast similarity search.
- The system returns, for each vehicle found in the uploaded photo, a chronologically ordered list of past sightings — which camera, its real name and location, and when — rather than just an unordered list of visually similar photos, because the actual goal is reconstructing "where has this vehicle been," not just "what looks similar."
- In a real end-to-end test run, the system correctly detected, fingerprinted, and stored 22 separate vehicle sightings out of a 20-photo test batch, with only two honest misses — an old motorcycle style the detector wasn't trained to recognize well, and a couple of cars too small and distant in an aerial-style photo for the detector to pick up. These limitations are documented plainly rather than hidden.

### 5.5 Decisions made along the way, and why

- **License-plate reading was deliberately left out of this phase**, even though the original plan envisioned eventually combining it with visual matching. The database was already designed with a place to store plate information later, but the decision was made to get the visual-matching half working solidly first, rather than building both halves at once and risking neither working well.
- **The web service was built and shipped even though the underlying model is known to be imperfect**, because the specific model file being used and the similarity-strictness threshold are both easily swappable configuration values, never hardcoded into how the web service behaves — so upgrading to a better model later (like the larger one currently being trained) won't require changing the service or the app at all.
- **The vehicle-search feature in the app deliberately requires the user to upload a photo already cropped down to a single vehicle**, rather than uploading a full scene and having the system guess which vehicle the user means. A full scene can easily contain several vehicles with no way for the system to know which one the officer actually cares about — requiring a focused photo matches how evidence photos are typically already handled in practice, and a more elaborate "detect everything, then let the user pick one" flow was deliberately left as a possible future improvement rather than built prematurely.
- **The interface is required to never overstate how confident a match is** — it always shows the actual numeric similarity score, always uses careful language like "possible match" rather than "confirmed match," and never claims that a reconstructed route of sightings is complete. This is a direct, deliberate application of the facial-recognition lesson described in Section 2: an imperfect matching system must always show its uncertainty to the human using it, never present a guess as settled fact.
- **The web service does not yet have its own login/authentication system** — this is a known, openly documented gap, not something quietly overlooked. The planned fix is to have it accept the same login credentials as the main registry system, rather than building an entirely separate account system just for this one feature.

---

## 6. What Was Deliberately Left Out, and Why That's a Choice, Not an Oversight

A few things are worth stating plainly, because they represent conscious decisions about what to build later, not things that were simply forgotten:

- **Connecting to the hackathon's live video feed.** The event separately provides a way to connect to a live grid of camera video streams for real-time processing. Nothing in the systems described above connects to that live video feed — and that's intentional. The camera registry was built specifically to manage camera *information*, never to open or process actual video streams; doing so is a substantially different and more complex problem that would belong to a future phase, not something quietly missing from what's already built.
- **Automatically detecting when two different departments have installed redundant, overlapping camera coverage.** This map feature was fully designed but deliberately set aside so other, higher-priority features could be finished first.
- **Further hardening of the login/session system** (such as issuing a brand-new session-renewal token every time one is used, and adding a second, database-level layer of department-access enforcement as extra insurance on top of the existing application-level enforcement). The current system is already secure and working well; these are additional layers of defense-in-depth planned for later, not fixes for something broken now.
- **License-plate reading**, as explained above — the database already has a place reserved for it, but building it wasn't prioritized yet in favor of getting visual vehicle-matching solid first.
- **A login/authentication system for the vehicle-recognition web service** — a known, openly tracked gap, with a clear plan (reuse the main system's existing login) not yet implemented.
- **Full self-service password recovery via email.** A secure "change your password while already logged in" flow was built instead, since a traditional email-based reset flow would need verification infrastructure that doesn't exist yet, and skipping that verification step would create a real security risk for this kind of user base.

---

*This document reflects the complete system as built and understood as of the time of writing.*
