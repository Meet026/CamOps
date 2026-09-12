# Sentinel — Project Content Brief

**Purpose of this document:** this is detailed source material about the
project, written for someone (or an AI) with no prior context. It
deliberately avoids code-level or architecture-level detail. It is not
organized as slides and does not prescribe which parts belong on which
slide — that choice belongs entirely to whoever builds the presentation
from this content.

---

## 1. One-line summary

Sentinel is a unified camera registry and vehicle-tracking platform built
for Gujarat Police, bringing every CCTV camera across 26+ government
departments into one trustworthy system — and adding the ability to trace a
vehicle's route across that camera network.

---

## 2. The problem

- Over **26 different government departments** in Gujarat each run their own
  CCTV cameras completely independently.
- There is **no shared record** of what cameras exist, where they physically
  are, who owns them, or whether they're even working.
- Independent government audits show **30-44% of government CCTV cameras are
  non-functional at any given time** — and because there's no monitoring
  system, nobody notices until it's too late.
- Departments likely have overlapping, duplicated camera coverage in some
  areas and complete blind spots in others — but no one can currently see
  that, because there's no map showing all departments' cameras together.
- Before any advanced video analytics or AI system can be built on top of
  these cameras, someone first has to answer the basic question: **what
  cameras do we actually have, and can we trust them?**

---

## 3. Why we didn't just build "the obvious AI feature"

Before choosing a direction, real research was done into how AI-driven
surveillance systems perform in India today — not just how they're pitched.
Key findings that shaped the whole project:

- **Facial recognition in India has a severe accuracy and legal problem.**
  Delhi Police's own facial-recognition system was reported at roughly 2%
  accuracy in 2018 and under 1% in 2019. Of 170 government-commissioned
  facial recognition systems nationally, only about 20 are actually
  operational. No Indian law even defines how much weight a facial-match
  should carry in court. **We made a firm decision not to build facial
  recognition.**
- **The real bottleneck is broken hardware, not missing AI** — the 30-44%
  non-functional-camera statistic above is the actual, documented, everyday
  failure mode. That's why the camera registry and health monitoring came
  first, not flashy analytics.
- **The commercial market already sells generic "connect any camera + AI"**
  — so that would add nothing new. We chose vehicle re-identification (
  tracking a vehicle by its visual appearance, not a face) instead — a real,
  internationally recognized research field (the approach mirrors what
  winning teams used in the NVIDIA AI City Challenge, a real international
  vehicle re-identification research competition running since 2018), and
  one that avoids the facial-recognition legitimacy problem entirely because
  a vehicle's appearance isn't personal biometric data.
- **License plates alone have specific, well-documented technical failure
  modes in India** — over 50 different plate formats nationally, large
  inconsistency in fonts and layouts, and two-wheelers (which make up the
  large majority of vehicles on Indian roads) routinely have small, dirty,
  bent, or non-standard plates. These aren't hypothetical concerns — they're
  the dominant, specifically-Indian reasons plate reading fails in practice.
- **Visual appearance and license plates fail in different situations, which
  is exactly why the long-term plan combines both rather than picking one.**
  Plate reading struggles when a vehicle is far away, low-resolution, or has
  a dirty/bent plate — situations where visual matching still works
  reasonably well. Conversely, plate reading works perfectly when two
  vehicles are the same model and color, a case where visual matching
  struggles. The two signals cover each other's blind spots.

---

## 4. The solution — three parts

| Part | What it does |
|---|---|
| **Camera Registry & Backend** | The system of record — every camera's identity, location, ownership, technical details, and live health status |
| **Web Application** | The interface officers, admins, and auditors actually use — register cameras, view the map, monitor health, manage users |
| **Vehicle Tracing System** | Given a vehicle's photo or plate number and where it was last seen, reconstructs its route across the real camera network |

These are three genuinely separate, independently running systems that work
together through shared data — not one monolithic app. That's a deliberate
choice, so any one part can grow or be improved without breaking the others.

---

## 5. Feature-by-feature breakdown

### 5.1 Overview Dashboard

One glance shows the health of the entire network: total cameras, how many
are online right now, how many are at risk of going dark, and how many AI
suggestions are waiting for human review. No digging through menus. A
"needs your attention" panel surfaces exactly what an admin or field officer
should look at next — pending AI reviews, at-risk cameras — rather than
making them go hunting across separate pages.

### 5.2 Camera Registry (list, add, edit, delete)

- Every camera from every department in one searchable list, with its
  status, integration difficulty, and owning department.
- Search reaches both the camera's name and its address, and it waits
  briefly after typing stops before querying — a responsive search
  experience that doesn't hammer the system with a request per keystroke.
- The list can also be filtered by department, camera type, status, and
  integration-readiness score together, and switched between a roomier
  "Comfortable" view and a denser "Compact" view for scanning many rows at
  once.
- Adding a camera is simple enough for a non-technical field officer — just
  a name, department, and location, captured with one tap of a "use my
  current location" GPS button right on the form (with a clear fallback
  message if GPS isn't available).
- As soon as brand/model are typed in, the system automatically and
  instantly (as-you-type, not just after saving) estimates how hard this
  camera would be to integrate into future video systems — easy, medium,
  hard, or an honest "needs a human to check" — without the officer needing
  any technical knowledge. A brand-name autocomplete, built from previously
  seen vendors, helps standardize entries without forcing rigid choices.
- If an officer doesn't know a camera's exact brand/model, they can instead
  upload a photo of the camera itself, and an AI vision step attempts to
  identify the hardware directly from the photo, clearly labeled
  "AI-suggested — please verify."
- Nothing is ever truly deleted — a removed camera is marked inactive, since
  this data may need to hold up as evidence.
- Every camera also has its own detailed record page, organized into three
  tabs: an overview of every recorded fact about it (department, hardware,
  install date, coordinates, address, network details, timestamps), a
  health tab (current status, a visual uptime history bar, a manual
  "check now" button), and a location tab (map pin plus address). A real
  recent-activity timeline sits alongside it, built from the camera's
  actual status-change history.
- The full (filtered) camera list can be exported as a CSV file with one
  click, for offline reporting or record-keeping outside the system.

### 5.3 Bulk Upload

For departments onboarding hundreds of existing cameras at once: drop in a
spreadsheet, and it processes in the background with a live progress bar,
reporting exactly which rows succeeded and which failed — instead of one
bad row freezing the whole batch. Behind the scenes, rows are processed in
carefully tuned batches (fast enough to handle hundreds of cameras quickly,
but throttled so it never overwhelms the system or slows down other people
using it at the same time). Re-uploading a spreadsheet later — say, a
corrected or refreshed version — intelligently updates matching existing
cameras instead of creating duplicates, so departments can maintain their
data over time, not just onboard once.

### 5.4 Interactive Map

- Every camera plotted at its real location, color-coded by live status or
  by integration readiness.
- **Coverage-gap analysis:** a live, grid-based calculation showing exactly
  which areas have zero camera coverage at all — not a static image, a real
  calculation that updates as departments add more cameras.
- **Incident heatmap:** a density overlay intended to show where incidents
  cluster, so planners can see at a glance where coverage matters most.
  *(Currently running on placeholder sample data, clearly labeled "Beta" in
  the product itself — see the Honesty Note in Section 10 for why this
  matters and how to present it accurately.)*

### 5.5 Live Stream Viewing

Any camera with a registered video stream can be watched live, directly in
the browser, on demand — no separate video management system required. A
dedicated relay service handles the real technical challenge behind this:
converting each camera's raw video feed (which uses a format browsers
cannot play directly) into something a browser can display, and only doing
this work while someone is actually watching — a stream automatically stops
converting and cleans up after about 90 seconds of nobody watching, so
running dozens of cameras doesn't waste processing power on ones nobody is
currently viewing. The first frame of video can genuinely take 50-90
seconds to appear on some cameras — an honest, expected wait tied to real
camera/network characteristics, not a bug, and the interface explains this
clearly rather than looking broken. When a stream can't play for a specific
reason (no stream configured, an unsupported video format, a browser-
specific playback issue), the viewer explains the specific reason in plain
language rather than showing one generic error.

### 5.6 Health Monitoring

Automatically checks every network-connected camera's reachability on a
schedule (every few minutes, processed safely in batches so it scales to
hundreds or thousands of cameras without becoming unstable) and flags
anything that's gone offline repeatedly — by default, three or more times
within two weeks, both adjustable — as "at risk," rather than reacting to
a single brief blip. This directly answers the 30-44%-broken-cameras
problem from Section 2: a broken camera gets noticed and fixed instead of
silently doing nothing for months or years. Older analog cameras that
can't be automatically pinged over the network aren't left out either — an
officer can manually record their status, stored in the exact same history
as automatic checks, so every camera type is covered.

### 5.7 Audit Log

Every single action anyone takes in the system — every login, every camera
created, edited, or deleted, every role change — is automatically recorded:
who did it, when, from where, and exactly what changed, before and after.
Every entry is shown in human-readable form (the actual camera name or
user's email, not a cryptic internal ID), and can be expanded to see a
precise field-by-field before/after comparison of exactly what changed on
that action — not just "an edit happened," but exactly which values changed
and to what. A technical correlation ID is also attached to every entry and
can be copied with one click, letting a specific action be cross-referenced
against server-side logs if ever needed. For a policing system, this
accountability trail is not optional.

### 5.8 User & Role Management, Settings

Admins assign each user exactly the access their job needs — field officer,
department-level viewer, or auditor — nothing more. Settings also includes
account details and a password-change option; changing a password
immediately signs the user out of every other device or browser they were
logged into, so an old, possibly-compromised session can't quietly keep
working after the password changes. A dark/light/match-system theme toggle
sits visibly in the header on every page (not buried in a menu), so the
system is comfortable to use at any hour, in any lighting — such as a
24-hour control room.

### 5.9 Vehicle Tracing (Vehicle Search)

Given either a photo of a vehicle, or its number plate plus the last camera
it was seen at, the system reconstructs a full route: which real cameras it
passed, in what order, with real distances and real timestamps. Results are
shown two ways at once — a connected timeline of stops (camera name,
timestamp, how much time passed since the previous stop) alongside a live
map with the same route drawn as a numbered, connected path — clicking a
stop on either one highlights the matching point on the other. Uploading a
photo first offers a simple crop tool (a draggable frame with a
photography-style compositional grid) so a user can isolate exactly one
vehicle in a busy photo before searching, improving match accuracy. This is
the feature that turns a passive camera registry into an active
investigative tool.

Every result is honestly labeled, not overstated: matches are grouped into
three visible confidence bands ("Strong match," "Possible match," or "Weak
match — review carefully") rather than a single yes/no, and the interface
repeatedly describes results as "possible matches, not confirmed
identifications." The system also distinguishes different kinds of "nothing
found" rather than showing one generic error — no vehicle detected in the
photo at all, a vehicle detected but nothing matched closely enough, or
multiple vehicles detected in one photo (prompting a tighter crop) — and
warns the user if they're looking at a result more than a couple of minutes
old, since results are never silently refreshed behind their back.

### 5.10 Wanted List Alerts

Departments already maintain their own wanted lists — a flagged person's
name, their vehicle's plate number, and the reason they're flagged. Sentinel
checks against that list the instant an officer types a plate number in
while searching for a vehicle: if it's an exact match, an alert fires
immediately (a pop-up, a distinct alert sound, and a clearly marked warning
banner showing the person, the plate, and why they're on the list), and the
match is also logged as a notification — visible to anyone else watching the
notification bell in the header, even on a different shift or a different
desk, not just the person who ran the search. This is a genuine, exact
plate-number match today, not a camera recognizing a wanted vehicle by sight
on its own — see the roadmap in Section 11 for that next step.

### 5.11 How the vehicle-tracing engine actually works

- **Spotting the vehicle in a photo:** we use YOLO, a well-established,
  proven object-detection model, to automatically find and crop out each
  vehicle in an uploaded photo — cars, motorcycles, buses, trucks — before
  anything else happens. This step needed no custom training at all, since
  YOLO already recognizes these vehicle types out of the box.
- **Turning a vehicle photo into a fingerprint:** each cropped vehicle is
  converted into a numeric "visual fingerprint" by a vehicle re-identification
  model — the same vehicle photographed from different angles or different
  cameras produces a similar fingerprint, while different vehicles produce
  clearly different ones.
- **Searching fingerprints fast, even as the collection grows huge:** every
  vehicle's fingerprint is stored in a database specifically built for fast
  similarity search (rather than a general-purpose data column), with a
  search index on top of it — so "find similar vehicles" stays fast even as
  the number of stored sightings grows into the thousands or millions,
  instead of slowing to a crawl. This was a verified choice, not an assumed
  one — the team specifically confirmed the underlying cloud database
  actually supports this capability before building on it.
- **Filtering out impossible matches:** a route is only ever built from
  sightings that are physically plausible — if reaching the next camera in
  a proposed route would require traveling faster than any real vehicle
  reasonably could, that sighting is automatically dropped rather than
  shown as a real step in the route. This isn't a hypothetical safeguard: an
  early, real test run — before this filter existed — produced routes
  implying travel speeds as high as 1.5 million km/h, and one single search
  falsely matched one parked car to 88 different "sightings" at one camera
  within a three-hour window. The filter was built directly in response to
  that measured, real failure, and keeps the output honest instead of
  stringing together coincidental look-alike matches into a route that
  couldn't have actually happened.
- **Processing at scale, without slowing down:** camera footage is
  processed in batches rather than one frame at a time, so the system can
  handle many cameras and many sightings without becoming a bottleneck as
  the camera network grows.

---

## 6. The scientific rigor behind the vehicle-recognition model

This section is a real story worth telling in its own right — not just what
was built, but how carefully it was measured and how honestly the results
were reported, including the parts that didn't work.

- **A mistake was caught and corrected, not hidden.** The very first
  accuracy test for the vehicle-recognition model was accidentally run using
  the same data the model had already learned from — like grading a student
  on the exact questions they'd already memorized the answers to. This
  produced an artificially good-looking score. The team caught this
  themselves, threw out the invalid result, and re-ran the test on
  completely unseen data, getting an honest score about 27% lower than the
  first, flawed one. Both the invalid and the corrected reports are still
  kept on file, clearly labeled, specifically so nobody ever accidentally
  cites the wrong one later.
- **The failure was diagnosed, not just measured.** A deeper check found
  that, using the model as-is, roughly half of all "these are different
  vehicles" photo pairs scored a higher similarity than the worst "this is
  actually the same vehicle" pair — meaning no single cutoff score could
  reliably tell vehicles apart yet. Rather than stopping there, the team
  manually inspected the worst-scoring pairs and found two concrete causes:
  motion blur in photos, and the model sometimes matching the background or
  road behind a vehicle rather than the vehicle itself — a bias also
  independently confirmed by published academic research in this field, not
  just an in-house guess.
- **The fix was measured honestly, both the wins and the losses.** After
  training the model further on 500 real vehicles (across 6,420 real
  photos, from 114 different real cameras), same-vs-different vehicle
  separation improved by the team's own target amount, and performance in
  low-light and heavily-cropped photos also improved. But two other real
  conditions — motion blur and very small/low-resolution images — actually
  got slightly worse. This wasn't glossed over; all five outcomes,
  improvements and setbacks alike, are reported plainly in the project's own
  written record.
- **A prior claim was later found to be wrong, and was openly corrected.**
  A training feature meant to make the model more resistant to blurry
  photos had been written up as "in place" — but a later internal review
  found it had actually never been connected into the real training
  process, and the team corrected their own record rather than letting the
  incorrect claim stand.
- **A second, larger training run is already underway** — scaling from 500
  vehicles up to 10,000 (across over 128,000 real photos from 161 different
  cameras) — using the same evaluation process, so the next round of
  results will be just as rigorously and honestly measured as this one was.

---

## 7. Real, measured results and numbers

- **270 automated tests, all passing** (as of the last full check): 225
  tests across 38 test groups, plus 45 broader end-to-end tests across 12
  more groups. Every feature was built "test-first" — a test defining the
  expected behavior was written before the feature itself, for every single
  piece of the system.
- **Every module was also manually verified against a real, live version of
  the system** — not just automated tests passing in isolation, actually
  clicking through real screens against a real database.
- A real vehicle-detection test run correctly found, fingerprinted, and
  stored **22 separate vehicle sightings from a 20-photo test batch**, with
  only two honest, understood misses (an unusual antique motorcycle style,
  and cars too small and distant in an aerial-angle photo) — reported
  plainly rather than hidden.
- **Four real bugs were found and fixed during development** through actual
  testing against a live system, not just assumed away — including one that
  would have crashed the entire application on startup under a specific,
  realistic configuration, and one that only a real end-to-end test (not a
  simulated one) managed to catch.
- The whole web application was verified end-to-end using an automated
  browser-testing tool against the real, running backend — a real login,
  role-based navigation, and a full camera-creation flow (fill in the form,
  place a map pin, submit, confirm it's really saved, view its detail page)
  — with zero errors in the browser console. This process itself caught and
  fixed a real bug that a codebase simply "compiling successfully" would
  never have revealed.

---

## 8. Security

- **Role-based access control** — every user can only do what their
  assigned role allows. A department-level viewer can never see another
  department's cameras, not even by guessing a camera's ID.
- **No password is ever stored in plain text** — every password is
  cryptographically hashed before it touches the database, so even in the
  unlikely event the database were exposed, actual passwords would not be.
- **Login sessions are handled with the same care.** A short-lived
  credential (valid 15 minutes) is what actually authorizes each request,
  kept only in the browser's live memory — never written to disk-based
  storage — so it can't be picked up later by anything with access to
  stored browser data. A longer-lived session token allows staying logged
  in without needing that stored anywhere sensitive either — the system
  only ever keeps a scrambled (hashed) version of it, exactly like a
  password, so there's nothing directly usable even if the database were
  ever exposed. The system also quietly renews the short-lived credential a
  couple of minutes before it expires, so an officer actively working is
  never suddenly logged out mid-task.
- **Logging out — or changing a password — immediately and completely ends
  that session everywhere,** not just on the current device. Changing a
  password specifically signs a user out of every other device or browser
  they were logged into, so an old, possibly-compromised session can't
  quietly keep working after the password changes.
- **Two-factor authentication is available for any account.** A user can
  turn it on in their own settings, scanning a QR code with a standard
  authenticator app; from then on, logging in requires a six-digit code
  that refreshes every 30 seconds, in addition to the password. Ten
  one-time backup codes are generated at setup, for the case where a phone
  is lost or unavailable — each one works exactly once. This is opt-in per
  account today, not a forced requirement for every user.
- **A deliberate decision was made not to build a traditional, email-based
  "forgot password" flow.** The team judged that an unauthenticated
  password-reset-by-email path is itself a real account-takeover risk for a
  police-department user base, and chose the safer trade-off: a locked-out
  user goes through an administrator instead. This mirrors the project's
  broader theme of choosing the safer option over the more convenient one
  when they conflict.
- **The system automatically blocks excessive/automated requests** — a
  general limit across normal use, and a much stricter limit specifically on
  the login page, directly defending against automated password-guessing
  attacks.
- **A full audit trail** (see Section 5.7) backs every security guarantee
  with accountability.

---

## 9. Built to scale

Because every department's data is already isolated from every other
department's, and every camera health check runs independently in the
background, this system is built to grow from a handful of departments to
all 26-plus without needing a redesign — it's the same system, just more
data in the same structure. A few concrete engineering choices back this
up: every list in the system (cameras, users, audit log, and more) is
capped and paginated the same way, so nothing can accidentally try to load
an unbounded amount of data at once; the automatic camera health-check job
processes cameras in safe batches with built-in protection against runs
piling up on top of each other; and vehicle fingerprints are stored using a
database technology specifically built for fast similarity search at large
scale, rather than a naive approach that gets slower the more sightings are
stored.

---

## 10. A stated engineering value: never fake it

Across the project, the same principle repeats in different forms — never
present something as working, complete, or certain when it isn't:

- Anywhere the interface depends on a capability that doesn't exist yet, it
  shows a calm, specific "this isn't built yet" message explaining exactly
  what's missing — never a silently broken button, a console error, or
  (critically) fake data pretending a feature works. This has been the
  team's consistent, ongoing practice, not a one-off decision.
- Vehicle-match results are always shown with their real confidence level
  and explicit "possible match, not a confirmed identification" language
  (see Section 5.9) — never presented as a certain result.
- The incident heatmap on the map page is clearly labeled "Beta" in the
  product itself and currently uses placeholder sample data rather than
  real incident records (unlike the coverage-gap analysis next to it, which
  is a genuine live calculation over real camera data) — see the honesty
  note below for exactly how to describe this accurately.
- When a research finding turned out to be a mistake (see Section 6, the
  contaminated first test result) or a documentation claim turned out to be
  wrong (the blur-training feature that was never actually wired in), the
  team corrected the record openly rather than letting the more flattering,
  incorrect version stand.

---

## 11. What's next — the roadmap

1. **Real license-plate recognition**, combined with the visual vehicle
   matching described in Section 5.11 (currently being scaled up from 500
   to 10,000 training examples, see Section 6) — so that even a dirty,
   damaged, or unreadable plate doesn't stop a vehicle from being traced.
   This same upgrade is also what would let the wanted-list alert in
   Section 5.10 run automatically off a live camera feed, catching a match
   the instant a flagged vehicle is seen — instead of only when an officer
   manually types a plate in. This is what turns both the vehicle-tracing
   and wanted-list features into something fully automatic end-to-end.
2. **Smart motion pre-filtering, before a frame is even sent for analysis.**
   Right now, every frame that comes in from a camera gets fully analyzed,
   whether anything meaningful happened in it or not. The plan is to add a
   lightweight first check — frame by frame — that asks "is this real
   motion, like a vehicle, or is it just wind blowing a tree, a moving
   shadow, or a lighting change?" Only frames that pass this check get sent
   on to the full vehicle-detection and matching pipeline. This is a
   well-established, proven approach used by real production camera
   systems (for example, the open-source NVR project Frigate uses exactly
   this kind of pre-filtering). The benefit is scale: as the number of
   connected cameras grows into the hundreds or thousands, this stops the
   system from wasting processing power analyzing frames that never had a
   vehicle in them in the first place, which is what actually allows the
   platform to keep up as more departments and more cameras join.
3. **Deeper analytics and trend reporting** — turning all the camera and
   incident data already being collected into actionable trend reports for
   departments, not just a live map to look at.
4. **A real incident heatmap**, replacing the current beta/sample-data
   version (see Section 10) with actual incident records once that data
   source exists.

---

## 12. Honesty note

The vehicle-tracing feature demonstrates the real camera network, real
distances, real routing logic, and a real map — all genuinely working
today. The wanted-list alert (Section 5.10) is also real and working today,
but only as an exact plate-number match, triggered when an officer types a
plate in — it does not yet watch a live camera feed and recognize a wanted
vehicle by sight on its own. That automatic, camera-side version depends on
the same license-plate-reading and further model training already listed as
item 1 in the roadmap (Section 11), and is not built yet. The smart motion
pre-filtering described in item 2 is also a planned capability, not
something already running in production. The incident heatmap on the map
page is real, working software, but it is currently running on placeholder
sample data rather than actual incident records, and is clearly labeled
"Beta" in the product itself — it should not be described as equivalent to
the coverage-gap analysis next to it, which genuinely is a live calculation
over real data. Any description of these features should make these
distinctions clear rather than implying they are already fully live — this
is a deliberate, stated project value (built with integrity, not
overstatement), not a weakness to hide.
