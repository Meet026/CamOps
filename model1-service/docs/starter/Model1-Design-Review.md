# Model 1 – Design Review

## 1. Overview

This project is part of a larger initiative ("Sentinel") to eventually connect CCTV cameras from many different government departments across Gujarat into one unified system — so that, in the future, footage and live feeds could be searched, monitored, and analyzed together instead of each department managing its cameras in isolation.

**Model 1 is the foundation for all of that.** Before anyone can build live video streaming, AI-based analysis, or alerting on top of these cameras, someone needs to answer a much more basic question first: *what cameras even exist, where are they, who owns them, and how easy would each one be to connect to a future system?*

Model 1 is a **registry and map** — not a video system. It does not show live footage or recordings. It is closer to a very well-organized spreadsheet with a map view: every camera gets logged with its location, its owner (department), some technical details, and an estimate of how hard it would be to hook into later. Nothing about video itself lives here.

## 2. Problem We Are Trying to Solve

Right now, 26+ government departments each run their own CCTV setup — different brands, different ages, different technical capabilities — and there is no shared record of what exists. Nobody currently has a single answer to basic questions like:

- How many cameras does the state actually have, and where are they?
- Which of these cameras could realistically be integrated into a future monitoring platform, and which would need extra work (or replacement)?
- Are two departments' cameras pointed at the same intersection, duplicating effort, while some other area has no coverage at all?
- If a camera stops sending data, is anyone actually watching for that, or does it just quietly go dark?

Without this foundation, any attempt to build a bigger platform (live monitoring, automated alerts, etc.) would be guessing at scale and integration difficulty instead of knowing it. Model 1 exists to replace that guesswork with a real, trustworthy inventory.

## 3. My Current Approach

The core idea is: **make it easy for a non-technical field officer to register a camera in minutes, and let the system figure out the technical difficulty automatically wherever possible.**

A few key ideas shape the approach:

- **Low-friction onboarding.** A field officer standing in front of a camera shouldn't need to know its brand's technical specifications. They should be able to log it with a name, a location (captured automatically from their phone), and maybe a photo. Anything more technical is filled in by the system, not demanded from the person on the ground.
- **Automatic difficulty scoring, with a fallback to "I don't know yet."** The system tries to figure out how integration-ready each camera is (easy / medium / hard) based on its brand and model. If it doesn't know, it says so honestly rather than guessing wrong — "needs verification" is treated as a normal, expected outcome, not a failure state.
- **A system that gets smarter over time.** When the system isn't sure about a camera model, it can ask an AI for a best guess — but that guess is always clearly marked as unverified until a human confirms it. Once confirmed, the system remembers the answer, so it never has to guess about that same camera model again.
- **A visual, map-first way of understanding coverage.** Beyond the list of cameras, the whole point is to see them on a map — where coverage is strong, where departments are unknowingly duplicating each other, and where there are gaps.
- **Nothing gets permanently deleted.** Because this data may eventually matter for legal/evidentiary purposes, records are only ever marked inactive, never erased, and every change is tracked — who did what, and when.
- **Different people should see different things.** A field officer, a department that only cares about its own cameras, an administrator, and an auditor all have different needs and different levels of access to the same data.

## 4. Core Concepts and Data

### Department
- **What it represents:** One of the government departments that owns cameras (Police, Transport, Health, Municipal Corporation, etc.).
- **Why it's needed:** Every camera belongs to exactly one department, and a lot of the value of this system (avoiding duplicate coverage, understanding who owns what) depends on knowing that ownership clearly.
- **What it contains:** A name and a short code identifying the department.

### User (Person Using the System)
- **What it represents:** Someone who logs into the system — a field officer registering cameras, a department staff member checking their own cameras, an administrator, or an auditor reviewing the trail of changes.
- **Why it's needed:** Different people need different permissions. A field officer should be able to add cameras but not delete them. A department viewer should only see their own department's cameras, never another department's. An administrator has full control. An auditor can see the history of changes but not necessarily change anything.
- **What it contains:** Contact/login information, which role they hold, and (if relevant) which department they belong to.

### Camera
- **What it represents:** This is the heart of the system — a single physical camera, wherever it's installed.
- **Why it's needed:** It's the actual thing being inventoried.
- **What it contains, conceptually:**
  - Which department owns it, and a human-readable name for it.
  - Its physical location (so it can be shown on a map) and, optionally, a written address.
  - What kind of camera it is (an older analog camera vs. a newer network/IP camera) — this matters a lot for how "integration-ready" it is.
  - Brand and model, if known.
  - Whether it supports a standard way of being connected to other software (this is the main technical factor behind the integration difficulty score), and how confident the system is in that answer.
  - The resulting difficulty estimate: easy, medium, hard, or "needs verification."
  - How trustworthy the data itself is — was this confirmed in person, confirmed through an official/technical source, or just self-reported by whoever logged it?
  - An optional photo — either proof the camera exists and was seen, or a photo of its label/nameplate, which can help identify the brand/model later.
  - Whether it currently appears to be online, offline, or unknown.
  - When it was installed (if known).
  - Whether the record is still active (soft-deleted records are kept, never destroyed).
  - Who registered it and when, and when it was last updated.

### Vendor Reference Table (a.k.a. "things we already know about certain camera brands/models")
- **What it represents:** A growing, curated list of camera brands/models and what's already known about their technical capabilities.
- **Why it's needed:** So the system doesn't have to guess (or ask an AI) every single time the same brand/model shows up. Once one camera of a given model has been verified, every future camera of that same model gets an instant, confident answer.
- **What it contains:** Brand, model (or model pattern, to match a whole product family), whether it supports the standard connection method, whether extra vendor-specific tools are available for it, and where this knowledge came from (an official source, community knowledge, or AI-assisted verification).

### Pending Verification (a.k.a. "AI guesses awaiting a human check")
- **What it represents:** A record of every time the system had to guess a camera's technical capability using AI rather than known facts, and hasn't yet had that guess confirmed by a person.
- **Why it's needed:** Trust. An AI guess should never be treated the same as a verified fact. This keeps guesses visibly separate and gives administrators a clear queue of things to review and confirm or reject.
- **What it contains:** Which camera the guess was about, what the AI guessed and why, who reviewed it (once someone does), and the final, human-confirmed answer.

### Status History (a.k.a. "has this camera been online or offline over time")
- **What it represents:** A running log of whether a camera was reachable at different points in time.
- **Why it's needed:** A single "online/offline" snapshot doesn't tell you much. A history lets the system notice patterns — for example, a camera that keeps dropping offline repeatedly, which is a much more useful signal than one bad check.
- **What it contains:** Which camera, what its status was at that moment, and when the check happened.

### Audit Trail (a.k.a. "who did what, and when")
- **What it represents:** A permanent record of every meaningful action taken in the system — creating a camera, editing one, exporting data, etc.
- **Why it's needed:** Accountability. Since this data may eventually support law-enforcement or evidentiary uses, there needs to be a clear, tamper-evident answer to "who changed this, and when, and what did it look like before."
- **What it contains:** Who performed the action, what the action was, what it was done to, and relevant details about what changed.

## 5. How the Core Concepts Connect

In plain terms:

- A **Department** owns many **Cameras**. (Example: the Police department might own 500 cameras; the Municipal Corporation owns a different 300.)
- A **User** belongs to a Department (unless they're an administrator or auditor, who sit above the department structure) and can register or manage cameras depending on their role.
- Each **Camera** belongs to exactly one Department, and was registered by one User.
- When a Camera's brand/model is already known in the **Vendor Reference Table**, the system uses that instantly. If not, it may create a **Pending Verification** entry (an AI's best guess) attached to that Camera, waiting for a human to confirm it.
- Once a Pending Verification is confirmed by an administrator, two things happen: the Camera's own record is updated with the confirmed answer, *and* the Vendor Reference Table learns this new brand/model for next time — so the system effectively teaches itself over time.
- Every Camera accumulates a **Status History** over time — a trail of "was it reachable?" checks, which lets the system flag cameras that are trending toward failure.
- Every meaningful action on any of the above — registering a camera, editing it, an admin confirming an AI guess — creates an entry in the **Audit Trail**, tied to the User who did it.

**A simple story that ties it together:** A field officer from the Transport department stands next to a camera, opens the app, taps "use my current location," takes a photo of the camera's label, and submits it. The system doesn't recognize the brand/model yet, so it asks an AI for a best guess and marks the result as unverified. A few days later, an administrator reviews that guess, confirms it's correct, and from that point on, *every* camera of that same brand/model — from any department — gets an instant, confident answer without needing AI involvement again. Meanwhile, the camera now shows up correctly placed on the map under the Transport department's color, and the whole interaction is logged for later review.

## 6. Model 1 Scope

### Included
- Registering cameras — one at a time, or many at once via a spreadsheet-style upload.
- Location capture via phone GPS, with manual entry as a backup.
- Automatically estimating how hard each camera would be to integrate later, including a path for humans to verify uncertain guesses and for the system to learn from those confirmations.
- Viewing all cameras on an interactive map, filterable by department, status, or integration difficulty.
- Basic automated checks on whether network-connected cameras appear to be online, with a history of that over time.
- Flagging cameras that seem to be trending toward failure (repeatedly going offline).
- Identifying areas where camera coverage is missing, and areas where two departments may be redundantly covering the same spot.
- Role-based access: different people see and can do different things, and department-level users can only ever see their own department's cameras.
- A full history of who changed what, when — nothing is ever silently deleted.

### Not Included Yet
- Actually watching live video from any camera, or recording/playback.
- Any kind of automated video analysis — recognizing faces, license plates, objects, suspicious behavior, etc.
- Connecting to any other government database or watchlist system.
- A real downloadable mobile app — "mobile" here just means the same web form works fine on a phone's browser.
- Physically connecting to or controlling any camera (pan/tilt/zoom, pulling a live stream, etc.) — Model 1 only ever records *that a camera exists and what its capabilities are believed to be*, never touches the actual video feed.

### Future Possibilities
- A separate system (built later, not part of this one) that actually uses this registry to pull live video and run analysis on the cameras this system has already catalogued.
- Deeper automated coverage-gap analysis than the simple version planned for now.
- Expanding the "integration difficulty" scoring to consider more factors as they become relevant.
- Tighter, database-level guarantees around department data isolation, on top of the access-control rules already planned.

## 7. Key Assumptions and Decisions

- **"Unknown" is a valid, permanent-if-needed answer — not a bug.** A camera can sit indefinitely in a "we don't know its technical details" state without that being treated as broken or incomplete data. This was a deliberate choice to avoid blocking field staff who genuinely don't have the technical answer.
- **AI guesses are never treated as equal to verified facts.** Anywhere the system uses an AI to guess a camera's capabilities, that guess must be visibly marked as unverified until a human confirms it, and the interface must never blur that distinction.
- **The system should get smarter, not just log data.** Once a human confirms an AI's guess about a specific brand/model, that knowledge is kept and reused — future cameras of the same model shouldn't need to go through AI guessing again.
- **Nothing is ever truly deleted.** Given the possible future evidentiary use of this data, "deleting" a camera just marks it inactive; the record and its full history remain.
- **Department-level users are strictly boundaried.** Someone who only has visibility into one department's cameras should never be able to see another department's data, even by directly trying to look up a specific camera they're not supposed to see.
- **A basic "is it reachable" check is enough for now.** Model 1 does not attempt to verify that a camera's actual video stream works — only whether it appears to be online at a network level. Deeper stream validation is left for later, closer to when live video actually enters the picture.
- **The redundant-coverage and coverage-gap features start simple.** These are useful early signals, not fully polished analytical tools — the first version is intentionally basic, with room to make them smarter later.

## 8. Open Questions

- **[Open Question]** Is the four-role structure (administrator, field officer, department viewer, auditor) enough, or are there other types of users (e.g., a department-level *admin*, distinct from a department *viewer*) that should exist from day one?
- **[Open Question]** How much should Model 1 try to detect *duplicate* camera entries (e.g., the same physical camera registered twice by mistake) versus leaving that entirely to human review?
- **[Open Question]** Should there be any lightweight way for a department to flag a camera as "temporarily out of service" (e.g., under repair) versus the system inferring "offline" purely from failed automated checks?
- **[Open Question]** Is a photo of the camera enough for "proof it exists," or should there eventually be a stronger verification step (e.g., requiring the photo to be taken at the moment of registration, not uploaded from a gallery)?
- **[Needs Decision]** How much history is actually useful to keep long-term for the "is it online" checks — is there a point where very old history stops being valuable and should be summarized instead of kept in full detail?
- **[Open Question]** Should there be any process for periodically re-confirming a camera's details (location, ownership, status) even if nothing seems to have changed, to catch stale or incorrect records?

## 9. Reviewer Feedback

I'd love your honest take on a few things:

- What important concept or piece of information do you think I'm missing entirely?
- Does anything here feel unnecessarily complicated for a "just get the inventory right" first version?
- Is there anything in the "Included" list that you'd actually cut from Model 1 and push to later?
- Is there anything in "Not Included Yet" that you think actually *needs* to be in this first version?
- What assumptions above would you push back on or question?
- Are the relationships between Department, Camera, User, and the verification/history pieces intuitive, or confusing as I've explained them?
- What's a real-world scenario or edge case you think this design would handle badly?
- Looking ahead, is there anything about how this is shaped now that you think will cause pain later, once live video and analytics get added on top?
