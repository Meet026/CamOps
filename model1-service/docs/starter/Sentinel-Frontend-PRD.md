# Sentinel — Frontend Product Requirements Document

**Product:** Sentinel — Unified CCTV Camera Registry & GIS Command Center
**Scope:** Frontend experience for Model 1 (registry, scoring, health monitoring, GIS — no live video)
**Backend status:** Complete and verified. This document is written against the real, currently-shipped API — every endpoint, role, and field referenced below exists in the running backend today, not a proposed one. Where something the frontend needs does *not* yet exist on the backend, it is called out explicitly in **[Backend Gap]** callouts rather than silently assumed.
**Audience:** Product designer + frontend engineering team
**Author context:** This PRD picks up after the backend (NestJS, PostgreSQL+PostGIS) was built module-by-module with full TDD coverage. See `model1-service/docs/MAIN.md` for backend status.

---

## 0. Why This Document Exists

The backend answers "does the data exist and is it correct." This document answers a harder question: **when a police officer, a department admin, or an auditor opens this tool at 7am after a long night shift, does it feel like the most trustworthy, fastest, least-annoying piece of software they use that day?**

Government software has a reputation — cluttered, slow, built for compliance rather than use. Sentinel's frontend is the chance to prove that assumption wrong. Every department official who logs in and thinks *"this feels like a real product, not a government portal"* is doing more for adoption across 26 departments than any mandate could.

This is not a dashboard wrapped around a database. It's a **command center** — a tool whose UI communicates the physical reality of two things: a growing statewide surveillance network, and a group of trusted people managing it. The design should have the confidence of a modern SaaS product (think Linear, Vercel, Stripe Dashboard, or a well-run mapping tool) and the clarity of a mission-critical operations console (think an airline ops board or an infrastructure monitoring tool), because it is genuinely both.

---

## 1. Design Philosophy

### 1.1 The Feeling We're Building Toward

Someone logs in for the first time. Before they've clicked anything, the first three seconds should register:

1. **This is fast.** No skeleton-loading spinners lasting seconds, no janky layout shifts, no waiting for a giant JS bundle. Perceived speed is a design decision, not just an engineering one.
2. **This is precise.** Every number, every pin on the map, every status badge is exactly where it should be, sized correctly, colored with intention. Nothing feels approximate.
3. **This is calm.** Despite handling a serious subject (surveillance infrastructure, police departments, incident data), the interface never shouts. No red alert banners screaming for attention unless something is genuinely broken. Confidence is quiet.

### 1.2 Design Principles (Non-Negotiable)

- **Restraint over decoration.** Every visual flourish must earn its place by improving comprehension or reducing friction. If a gradient, shadow, or animation doesn't do one of those two things, cut it.
- **Data density with breathing room.** This is an operational tool with real data volume (potentially thousands of cameras). The design must handle density gracefully — tight enough to show meaningful amounts of information, generous enough that it never feels like a spreadsheet.
- **One primary action per screen.** Every page has a clear "main thing you're here to do." Secondary actions are visually secondary — smaller, quieter, further from the primary flow.
- **The map is not a feature, it's a character.** GIS is central to this product's identity (it's in the name of Model 1). The map should feel alive, responsive, and beautiful — not a bolted-on Leaflet embed with default markers.
- **Status is always legible at a glance.** Color-coding for camera status, integration score, and health must be consistent everywhere in the product — the same green never means two different things on two different pages.
- **Progressive disclosure.** Show the essential information first. Let power users drill into detail. Never force everyone through the same dense form/table just because 10% of users need every field.

### 1.3 What We Are Explicitly Avoiding

- Generic admin-dashboard template aesthetics (boxed cards with drop shadows everywhere, default Bootstrap-blue buttons, cramped sidebar + topbar + breadcrumb stacking that eats vertical space before content even starts).
- Loud "government portal" visual language — no navy-and-gold official seals, no Times New Roman anywhere, no dense unstyled HTML tables as the primary UI metaphor.
- Over-animation. Motion should clarify state changes (this list re-sorted, this modal opened from this button), not perform for its own sake.
- Fake urgency. No blinking red dots, no gamified streaks, no notification badges inflating unimportant counts.

---

## 2. Visual Design System

### 2.1 Color

A **dark-first, high-contrast operational palette** — this is a command-center tool used for extended sessions, often in control rooms; a dark UI reduces eye strain and lets status colors do real work by standing out against a quiet background. A light theme is offered as a first-class alternative (not an afterthought), because daytime desk use in bright offices is equally real. Both themes share the same semantic color logic.

**Base (Dark theme, default):**
- Background layers: a near-black canvas (`#0A0B0D`), with two lighter surface elevations for cards/panels (`#111318`, `#181B21`) — enough separation to convey depth via elevation, not heavy shadows.
- Border/divider: a low-contrast slate line (`#242832`), used sparingly — prefer spacing over borders to separate content where possible.
- Primary text: near-white (`#F4F5F7`); secondary/muted text: a mid-gray (`#8B93A1`) for metadata, timestamps, helper text.

**Base (Light theme):**
- Background: warm off-white (`#FAFAF9`), surfaces at `#FFFFFF` with a barely-there shadow for elevation.
- Border: `#E5E7EB`. Primary text: `#0F1115`. Secondary text: `#6B7280`.

**Brand accent — a single, confident signature color.** Not police-blue-and-gold cliché. A deep, electric indigo-violet (`#5B5FEF` dark-theme accent / `#4338CA` light-theme accent) — modern, trustworthy, distinct from the semantic status colors below so it's never confused with "warning" or "error." Used for: primary buttons, active nav states, focus rings, links, the logo mark, selected map pins, chart accents on non-status data.

**Semantic status colors — used consistently everywhere, no exceptions:**
| Meaning | Color (dark theme) | Used for |
|---|---|---|
| Online / Active / Success | `#22C55E` (emerald) | camera online, active toggle, success toasts, "easy" integration score |
| Offline / Critical | `#EF4444` (red) | camera offline, at-risk flag, destructive action confirmation, error states |
| Unknown / Needs Attention | `#F59E0B` (amber) | unknown status, `needs_verification` score, pending review items |
| Neutral / Informational | `#64748B` (slate) | inactive/soft-deleted, disabled states, secondary metadata |
| AI-Assisted / Beta | `#A855F7` (violet, distinct from brand indigo) | `ai_guess` badges, the heatmap "Beta" label — visually signals "assisted, not verified" everywhere it appears |

Integration score gets its own 4-step scale that borrows from the semantic set but is legible as a distinct spectrum at a glance (easy=emerald, medium=amber-green blend, hard=amber-red blend, needs_verification=slate-violet dashed outline instead of a fill, signaling "we don't know yet" rather than "this is bad").

### 2.2 Typography

Two-typeface system:
- **Display/UI face:** **Inter** (or **Geist Sans** if available in the build pipeline) — a modern, geometric-but-warm grotesk that's become the de facto voice of well-designed software products. Used for all UI chrome, headings, body copy, buttons, forms.
- **Monospace face:** **JetBrains Mono** or **Geist Mono** — used deliberately and sparingly for: camera IDs, IP addresses, coordinates (lat/long), timestamps in data tables, and audit log diffs. Monospace signals "this is precise, machine-readable data" and visually differentiates factual values from prose — a small detail that materially increases perceived precision.

**Type scale** (dark and light themes share the scale, only color/weight tokens shift):
- Display (page hero numbers, e.g. dashboard stat tiles): 40–56px, weight 600, tight tracking.
- H1 (page title): 28px, weight 600.
- H2 (section header): 20px, weight 600.
- H3 (card/subsection header): 16px, weight 600.
- Body: 14px, weight 400, 1.55 line-height — dense enough for data-heavy UI, still readable.
- Small/meta: 12.5px, weight 400/500, used for timestamps, helper text, table secondary rows.
- Monospace data: 13px, tabular figures enabled (so columns of numbers align).

### 2.3 Spacing, Radius, Elevation

- **8px base grid.** All spacing (padding, gaps, margins) is a multiple of 4, with 8 as the primary rhythm unit. This alone makes the product feel considered rather than eyeballed.
- **Radius:** 10px for cards/panels/inputs, 8px for buttons/badges/chips, 999px (full pill) for status badges and avatar/role chips. Consistent rounding is one of the fastest ways to make an interface feel like one coherent system rather than assembled parts.
- **Elevation via layering, not shadow soup.** Primary elevation cue is background-color contrast between layers (see 2.1). A single soft shadow (`0 4px 24px rgba(0,0,0,0.28)` on dark, lighter on light theme) is reserved for floating elements only — modals, dropdown menus, toasts, the map's floating filter panel. Cards sitting in normal document flow use border + background separation, not shadows — shadow overuse is the single fastest way to make software look dated.

### 2.4 Iconography & Imagery

- **Icon set:** a single consistent line-icon library (Lucide or Phosphor, "regular" weight) throughout — never mix icon styles. 20px default size, 16px in dense table rows, 24px in nav/empty-states.
- **No stock photography anywhere.** This product has no use for generic "team collaborating around a laptop" imagery. The map itself, real data visualizations, and camera thumbnail photos (from the actual photo-upload feature) are the only imagery — everything else is typographic and iconographic.
- **The map is the hero visual.** Where other products would use an illustration or photo, Sentinel uses a live, subtly-animated map preview (e.g., on the login screen background, at low opacity, slowly panning — see Section 4.1).

### 2.5 Motion

- **Duration:** 120–180ms for micro-interactions (hover, focus, toggle), 220–280ms for larger transitions (panel slide-in, modal open, page transition). Nothing above 300ms except deliberate, rare moments (e.g., a first-load hero reveal).
- **Easing:** a custom "ease-out-expo"-family curve for anything entering the screen (feels snappy, decisive), a gentler ease-in-out for anything moving in place (toggles, tab switches).
- **Purposeful motion only:** row insertion/removal in tables animates height+opacity so the list never "jumps." Status badges cross-fade on change rather than hard-swap. Map pins that update status pulse once, briefly, rather than instantly recoloring — a small cue that says "this just changed" without needing a toast for every camera in a busy view.
- **Respect `prefers-reduced-motion`** everywhere, unconditionally.

---

## 3. Information Architecture & Navigation

### 3.1 Top-Level Structure

A **persistent left rail (desktop) / bottom tab bar (mobile)**, not a top navbar — this is a tool people live inside for long sessions, and vertical space is precious for data-dense views (tables, maps). The rail is collapsible to icon-only width, remembered per-user via local preference.

**Primary navigation items** (role-dependent visibility, see 3.2):
1. **Overview** (home/dashboard)
2. **Cameras** (registry — list, add, bulk upload)
3. **Map** (GIS — the visual command center)
4. **Scoring** (integration-readiness queue — admin only)
5. **Health** (at-risk dashboard — admin/field_officer)
6. **Audit Log** (admin/auditor only) — see **[Backend Gap]** in Section 9, this page's read API doesn't exist yet
7. **Settings** (account, and for admins: user role management)

A slim top bar above the content area (not a full navbar) carries: the current page's title + primary action button (right-aligned), a global search trigger (see 3.4), a live connection/sync indicator, and the user's avatar/role menu (top-right).

### 3.2 Role-Based Navigation

Navigation items are **not just permission-gated, they're presence-gated** — a `dept_viewer` never sees "Scoring" or "Audit Log" in their rail at all, rather than seeing them grayed out. Showing a disabled nav item to someone who will never be allowed to use it is dead weight; better to keep their rail focused on what's actually theirs.

| Nav item | admin | field_officer | dept_viewer | auditor |
|---|---|---|---|---|
| Overview | ✅ (full) | ✅ (full) | ✅ (scoped to own dept) | ✅ (audit-focused variant) |
| Cameras | ✅ | ✅ | ✅ (read-only, own dept only) | ✅ (read-only, all depts) |
| Map | ✅ | ✅ | ✅ (own dept cameras only) | — |
| Scoring | ✅ (full, incl. verification queue) | ✅ (lookup only, no queue) | — | — |
| Health | ✅ | ✅ | ✅ (history/current for own cameras only, no at-risk dashboard) | — |
| Audit Log | ✅ | — | — | ✅ |
| Settings | ✅ (incl. user management) | ✅ (own account only) | ✅ (own account only) | ✅ (own account only) |

### 3.3 Breadcrumbs & Wayfinding

No breadcrumb trail as a persistent UI element (it's largely redundant with a one-level-deep IA). Instead: the top bar's page title updates contextually (e.g. "Cameras → Camera Detail: Ring Road Junction Cam-04"), and a single "← Back" affordance appears on any detail/edit view that was entered from a list, always returning to that list with its filters/scroll position preserved — this alone eliminates a huge class of user frustration ("I filtered this list, clicked into a camera, now I have to redo the filter").

### 3.4 Global Search

A `⌘K` / `Ctrl+K` command palette (in the spirit of Linear/Raycast/Vercel), triggered from the top bar's search icon or the keyboard shortcut. Searches across camera name/ID/address, and — role-permitting — jumps directly to navigation destinations ("Go to Scoring Queue," "Go to Map"). This single feature does more for a "premium tool" feeling than almost any other single addition, because it signals the product respects power users' time.

---

## 4. Authentication & Onboarding Experience

### 4.1 Login Page

**Layout:** Split-screen. Left ~45%: the login form on a solid surface-color panel. Right ~55%: a full-bleed, slowly-panning, desaturated/darkened live map of Gujarat with camera-density visualization (a taste of the product before you're even in it) — subtle parallax on mouse move for depth (disabled on mobile/reduced-motion). This single choice — showing the actual product's core visual (the map) as the login backdrop instead of a generic hero photo — is what separates "serious startup" from "generic dashboard."

**Form contents:**
- Product wordmark + a one-line tagline ("The unified registry for Gujarat's camera infrastructure" or similar — final copy TBD with the user) at the top of the form panel.
- Email field, Password field (with show/hide toggle), "Remember me" (persists refresh token duration client-side preference — see 4.3).
- Primary "Sign in" button — full width, brand-accent color, subtle loading spinner replacing the label text (not disabling+graying the whole button) while the request is in flight.
- No "forgot password" flow in v1 — **[Backend Gap]**: no password-reset endpoint exists yet. If this is needed, flag to backend before frontend build; otherwise the copy under the form should read something low-key like "Trouble signing in? Contact your department administrator."
- No self-serve signup — **[Backend Gap]**: there is no public registration endpoint, and there shouldn't be one; accounts are provisioned by an admin via the role-management endpoint. The login page should not imply signup is possible anywhere on it.

**States:**
- *Idle:* as described.
- *Submitting:* button shows spinner, form fields disabled, no layout shift.
- *Error (401 invalid credentials):* an inline, calm error message appears above the button (not a full-page red banner) — "That email or password doesn't look right." Fields are NOT cleared. Password field briefly shakes (60ms, subtle) as a secondary cue.
- *Error (429 rate-limited):* the backend enforces 5 login attempts/minute. On a 429, show "Too many attempts — try again in a moment" with a small live countdown, and disable the submit button until it clears. This is a real, tested backend behavior (see acceptance criteria) — the frontend must handle it gracefully, not show a generic error.
- *Success:* button shows a brief checkmark cross-fade (150ms) before navigating — a tiny moment of positive feedback rather than an instant, jarring redirect.

### 4.2 First-Run Experience (Post-Login)

No forced multi-step product tour (these are almost universally skipped/annoying for a tool used by working professionals, not consumers). Instead: **contextual, dismissible hint bubbles** on a genuinely new account's first visit to each major section (e.g., first time on the Map: a single small callout pointing at the layer toggle, "Toggle coverage gaps and the incident overlay here" — dismiss once, never shown again, no "3 of 7" progress nagging).

### 4.3 Session Handling

- Access token (15 min) held in memory only, never localStorage (XSS surface reduction). Refresh token (7 days) — **[Design Decision Needed]**: whether it's stored in an httpOnly cookie (requires a backend adjustment — currently the refresh endpoint takes the token in the request body) or in localStorage as a pragmatic v1 tradeoff. Recommend flagging this to the user as a security decision before frontend auth work begins; this PRD assumes httpOnly cookie as the target but the current backend contract expects the token in the POST body, so this needs explicit reconciliation.
- Silent refresh: the frontend proactively refreshes the access token a short buffer before its 15-minute expiry (e.g., at the 13-minute mark) via a background timer, so an active user is never interrupted mid-task by an expired-token error.
- On refresh failure (revoked/expired refresh token) or an explicit 401 from any API call: redirect to login, preserving the intended destination URL so the user lands back where they were after re-authenticating.
- Logout: calls `POST /auth/logout` (revokes the refresh token server-side, per the real backend behavior), clears in-memory state, redirects to login with a brief "You've been signed out" toast.

---

## 5. Page-by-Page Specification

Each page below follows the same structure: **Purpose → Layout → Components & Data → States → Interactions → Responsive Behavior.**

---

### 5.1 Overview (Dashboard / Home)

**Purpose:** The first thing anyone sees after login — a role-appropriate, at-a-glance answer to "what's the state of my camera network right now, and does anything need my attention."

**Layout:** A responsive grid of stat tiles at the top, followed by two/three content panels below (composition varies by role, see below). No sidebar-within-page — full width content area.

**Components & Data (admin/field_officer view):**
- **Stat tile row** (4–5 tiles): Total Cameras (with active/inactive split shown as a small secondary line), Cameras Online right now (%, with a tiny sparkline of the last 24h if data supports it), At-Risk Cameras (count, red accent, clickable → Health page filtered), Pending Verifications (count, violet accent, clickable → Scoring queue), Departments Covered (count out of 26).
- **"Needs Your Attention" panel:** a compact, prioritized list merging the two things that actually need human action — pending AI scoring verifications and at-risk cameras — sorted by recency/severity, each row a one-line summary with a direct action button ("Review" / "Investigate"). This is the single most important panel on the page: it turns "browse everything" into "here's your actual to-do list."
- **Recent Activity panel:** last ~10 audit-log-style events relevant to the user (camera created, bulk upload completed, scoring confirmed) — **[Backend Gap]**: requires the audit-log read endpoint noted in Section 9; until that exists, this panel can be seeded from whatever create/update events the frontend's own session has triggered, or omitted from v1.
- **Mini map preview** (bottom, full-width card): a small, non-interactive-until-clicked preview of the camera map, department-scoped for dept_viewer, with a "View full map →" link. Reinforces the map as central to the product even from the dashboard.

**Role variants:**
- `dept_viewer`: stat tiles and panels scoped to their own department only; no "Pending Verifications" tile (they can't access scoring); the mini map shows only their department's cameras.
- `auditor`: a distinct layout entirely — this role cares about oversight, not operations. Leads with an Audit Log summary panel (recent actions across all departments) rather than camera stat tiles. **[Backend Gap]**: depends on the audit-log read endpoint.

**States:**
- *Loading:* skeleton tiles (shimmer, not spinners) matching the exact shape of the real content — this prevents layout shift and feels faster than a centered spinner.
- *Empty (brand-new deployment, zero cameras):* the stat tiles show zeroes gracefully (no broken "NaN%" math), and the "Needs Attention" panel is replaced by a friendly empty state: an icon + "No cameras registered yet" + a primary "Add your first camera" button, right there on the dashboard — turns a dead-end empty state into a funnel toward the core action.
- *Partial failure* (e.g., one API call for a tile fails while others succeed): that specific tile shows a small inline "Couldn't load" with a retry icon, rather than failing the whole dashboard.

**Responsive:** Stat tiles collapse from a 5-column row → 2-column grid (tablet) → single column stack (mobile). "Needs Attention" and "Recent Activity" stack vertically below 1024px. Mini map preview hides below 640px (replaced by a plain "View Map" button) — a tiny non-interactive map thumbnail isn't worth the render cost on mobile data.

---

### 5.2 Camera List / Search

**Purpose:** The operational home base for camera data — browse, filter, search, and jump into any camera's detail or the bulk actions (export, bulk upload).

**Layout:** Full-width. A filter bar directly below the page's top-bar title, then a data table (desktop/tablet) or card list (mobile) filling the remainder, with pagination controls at the bottom.

**Filter bar components** (maps directly to the real `CameraQueryDto`):
- Department dropdown (multi-select searchable combobox — **[Backend Gap]**: no `GET /departments` endpoint exists yet to populate this; the frontend needs either that new endpoint or a hardcoded/config-driven department list as an interim measure — flagging this explicitly since it blocks a core filter).
- Camera Type toggle (All / IP / Analog) — a segmented control, not a dropdown, since it's only 3 options.
- Integration Score filter (multi-select chips: Easy/Medium/Hard/Needs Verification, each pre-colored per the semantic palette so the filter itself doubles as a legend).
- Current Status filter (multi-select chips: Online/Offline/Unknown, same color-as-legend treatment).
- Active/Inactive toggle (default: Active only, with an explicit "Show inactive" switch — matches the real backend default of returning all unless `isActive` is explicitly passed, but the UI defaults the *display* to active-only as the sane default for daily operational use).
- A free-text search input (client-side filter on name, or **[Backend Gap]**: the current `GET /cameras` DTO has no free-text `search` param — only structured filters. If text search is required, this needs a small backend addition; otherwise this control should be scoped as "filter visible results" client-side within the current page only, not a real search).
- Right-aligned: **Export** button (calls `GET /cameras/export`, respecting current filters — admin/auditor only, per the real role restriction) and **Bulk Upload** button (→ opens the bulk upload flow, admin/field_officer only) and primary **+ Add Camera** button.

**Table columns (desktop):** a colored status dot + Name (clickable, links to detail), Department (as a colored tag), Type icon, Integration Score (colored pill), Current Status (colored pill), Brand/Model (secondary/muted text, monospace-adjacent), Last Updated (relative time, e.g. "2h ago," monospace absolute time on hover tooltip). No "Actions" column of icon buttons cluttering every row — actions live on the detail page and via a row-hover "⋮" overflow menu (Edit, Deactivate) for quick access without permanent visual clutter.

**Data density options:** a small density toggle (Comfortable / Compact) in the table's top-right corner — Compact shrinks row height for power users scanning hundreds of cameras, Comfortable is the default for readability.

**States:**
- *Loading:* skeleton rows matching table structure.
- *Empty (no cameras match filters):* icon + "No cameras match these filters" + a "Clear filters" button — never a bare blank table.
- *Empty (genuinely zero cameras, no filters applied):* same empty state as the dashboard's, funneling to Add Camera / Bulk Upload.
- *Error:* inline error banner within the table area with a retry button — the filter bar and page chrome remain interactive.

**Pagination:** matches the real backend's page/limit contract (default 25, max 100) — a page-size selector (25/50/100) plus prev/next, with the current range shown ("Showing 1–25 of 342").

**Responsive:** Below ~900px, the table becomes a stacked card list — each card shows name, status/score pills, department, and a tap target for detail; filters collapse into a single "Filters" button opening a bottom sheet (mobile) or side drawer (tablet) rather than staying inline and cramped.

---

### 5.3 Add / Edit Camera Form

**Purpose:** The primary data-entry surface — used far more often than any other creation flow in the product, since camera onboarding is the core registry function. Must feel fast for a field officer standing at a physical camera location on a phone, and equally good for an admin doing careful desk-based data entry.

**Layout:** A single-column form (max-width ~640px, centered) — deliberately not a multi-column dense form. One clear vertical path reduces cognitive load and works identically on mobile without restructuring.

**Fields, grouped into clear sections (matches the real `CreateCameraDto`/`UpdateCameraDto`):**

*Section 1 — Identity*
- Name (required, text)
- Department (required, searchable dropdown — same **[Backend Gap]** as 5.2)
- Camera Type (required, segmented control: IP / Analog — this choice visually toggles which fields appear later, since IP-specific fields like `ipAddress`/`rtspPort` exist on the schema but currently have **[Backend Gap]**: no endpoint exposes them as settable — see Section 9. For v1, the form should NOT expose ip_address/rtsp_port fields at all until that backend gap is closed; document them as a near-term addition instead of building dead UI.)

*Section 2 — Location*
- A live, embedded mini-map (not just lat/long number inputs) — clicking anywhere on the map sets the pin; the pin is draggable for fine adjustment. Lat/Long number fields sit below, two-way bound to the map (editing the field moves the pin, dragging the pin updates the fields) — monospace font on these two fields specifically, per the typography system.
- **"Use my current location" button** — the actual GPS auto-capture the PRD requires (FR-2), using the browser Geolocation API. Shows a location-acquiring spinner state, then snaps the map/pin to the result. Clearly labeled fallback text below: "GPS unavailable? Set the location manually on the map above."
- Address (optional, free text) — a plain text field, not a geocoding autocomplete in v1 (no backend geocoding integration exists) — labeled as "Address / landmark notes" to set the right expectation that it's descriptive, not authoritative.

*Section 3 — Hardware Details (optional, collapsible "Add hardware details" disclosure — collapsed by default to keep the form short for the common fast-entry case)*
- Brand (text, with an autocomplete sourced from... **[Backend Gap]**: no endpoint lists known brands from `vendor_lookup`; for v1 this is a plain text field, with autocomplete flagged as a near-term enhancement once that read endpoint exists)
- Model (text)
- **Live scoring preview**: as soon as both Brand and Model have values (debounced ~500ms after the user stops typing), fire the real `POST /scoring/lookup` call and show the result inline, right in the form, as a small preview card — "Integration Score: Easy · via known vendor database" or "Integration Score: pending AI review" for the AI-guess path, using the same colored pill treatment as everywhere else. This is one of the PRD's explicit frontend requirements (brand/model autocomplete triggering live scoring preview) and is a genuinely delightful moment — the officer sees real value (an instant technical assessment) the moment they type in hardware info, before even saving the camera.
- Installed Date (optional date picker)

*Section 4 — Photo (optional, collapsible)*
- Drag-and-drop / tap-to-upload photo zone, with live preview thumbnail once selected. Uses the real `POST /cameras/:id/photo` endpoint — meaning on a brand-new camera, the photo upload is deferred until after the camera itself is created (the form should handle this sequencing transparently: create the camera on submit, then if a photo was staged, upload it immediately after in the same flow, showing a brief "Saving photo…" sub-state rather than requiring a second manual step).
- Below the photo zone, once a photo exists: an **"Identify from photo"** button that calls `POST /scoring/lookup/photo` — surfaces the OCR-identified brand/model (if any) back into Section 3's fields for the user to confirm, with a clear "AI-suggested — please verify" tag (using the violet AI-assisted color from 2.1) rather than silently overwriting whatever the user typed.

**Form-level behavior:**
- Inline validation, on-blur (not on every keystroke, which feels twitchy) — a field only shows red until you've engaged with it and left it invalid.
- The primary submit button's label changes contextually: "Add Camera" (create) vs "Save Changes" (edit) — and on edit, is disabled until something has actually changed (dirty-state tracking), preventing pointless empty-diff saves.
- Sticky footer action bar on mobile (submit button always reachable without scrolling past a long form) — a small but real usability win for field use.
- Unsaved-changes guard: navigating away with unsaved edits triggers a confirm dialog, not a silent data loss.

**States:**
- *Submitting:* button spinner, form fields disabled, no layout shift.
- *Success:* a success toast + redirect to the camera's detail page (not back to the list — showing the thing you just did is more satisfying and useful than the list).
- *Validation error (e.g., lat provided without long):* the real backend enforces this pairing — surface it as a clear inline message next to the coordinate fields, not a generic toast.
- *Duplicate name+department conflict:* since bulk upload upserts on this pair, manual creation should surface a clear message if it collides ("A camera named 'X' already exists in this department") rather than a raw 500/constraint-violation error.

**Responsive:** The form is already single-column and mobile-appropriate by design; the map embed shrinks to a fixed ~200px height on mobile with a "Expand map" tap target to go fullscreen for precise pin placement.

---

### 5.4 Bulk Upload Page

**Purpose:** Let an admin/field_officer import or update many cameras at once via CSV, with the real backend's background-job architecture (202 + jobId, poll for status) fully surfaced rather than hidden behind a fake "please wait" spinner.

**Layout:** A focused, single-purpose page — an upload zone at the top, and (once a job is running or has run) a results panel below.

**Components & Data:**
- Large drag-and-drop upload zone with a visible "Download CSV template" link right above it (the template mirrors the real expected columns: name, departmentCode, latitude, longitude, cameraType, brand, model, addressText, installedAt) — this single detail (a working template link) prevents the single most common bulk-upload failure mode (wrong headers) before it happens.
- On file selection: a brief client-side pre-check (row count, header presence) shown immediately, before the file even uploads, so obvious problems surface in under a second rather than after a round-trip.
- On upload (`POST /cameras/bulk`, real 202 response): transition to a **live job-progress view** — a progress bar driven by polling `GET /cameras/bulk/:jobId` (poll every ~1.5–2s while status is `pending`/`processing`), showing "Processing row 4,200 of 10,000" style live counts (`processedRows`/`totalRows` from the real response), with succeeded/failed counts updating live as separate colored segments of the progress bar (green for succeeded, red for failed) — turning an opaque background job into a genuinely satisfying, transparent process to watch, especially at the 10,000-row scale the backend was explicitly built to handle smoothly.
- On completion: a results summary card (Succeeded: N, Failed: N, Total: N) followed by, if `failedCount > 0`, an **expandable, filterable error table** listing every row from `rowErrors` (row number + error message) — with a "Download error report" button (client-side CSV generation from the JSON already in hand, no new backend endpoint needed) so a user can fix and re-upload just the broken rows.
- A "View imported cameras" link at the bottom of a successful run, deep-linking to the Camera List pre-filtered to... **[Backend Gap]**: there's no way to filter the list by "created in job X" since that association isn't tracked on the camera record itself — this link can only reasonably go to the unfiltered list with a toast noting the count, not a precise filtered view, unless a future backend addition tracks job provenance.

**States:**
- *Idle:* upload zone only.
- *Uploading file:* brief progress indicator during the raw file transfer (distinct from job processing progress).
- *Job pending/processing:* the live progress view described above.
- *Job failed (whole-job failure, not per-row):* a clear error state distinct from per-row failures — "The upload couldn't be processed" with the ability to retry.
- *Job completed with zero failures:* a celebratory-but-restrained success state (a single check icon + summary, no confetti — this is a professional tool).

**Responsive:** Fully usable on mobile/tablet (a field team lead might trigger this from a tablet), though large CSV uploads are a desktop-primary workflow — no special mobile restrictions needed, the flow degrades gracefully as a single-column layout naturally.

---

### 5.5 Camera Detail Page

**Purpose:** The single-camera deep-dive — everything about one camera, including its health history and scoring status, in one place. This is where "Overview" tiles and "list row clicks" land.

**Layout:** A two-column layout on desktop (main content ~65% left, a persistent summary/actions sidebar ~35% right), collapsing to a single stacked column below ~1024px.

**Main content (tabbed within the page, not separate routes, so switching feels instant):**
- **Overview tab** (default): key facts in a clean key-value grid (Department, Type, Brand/Model, Address, Installed Date, Created/Updated timestamps in monospace), the photo (if any) shown prominently at the top of this tab, and the integration score + onvif status shown as prominent colored pills with a "Re-run scoring" button next to them (re-triggers `POST /scoring/lookup` with the camera's current brand/model).
- **Health tab:** current status (from `GET /health/:id/current`) shown as a large, clear status indicator at the top, a "Check Now" button (calls `POST /health/:id/check-now` — for IP cameras with an address this triggers a real check with a brief "Checking…" loading state; for analog/no-IP cameras, clicking it opens a small inline prompt "Report current status: Online / Offline" matching the real dual-mode backend behavior exactly), and below that, a **history timeline/chart** — a simple uptime visualization (a horizontal timeline of colored segments, green/red, over the queryable history from `GET /health/:id/history`) rather than a raw table, since visual uptime patterns are far more legible than a list of timestamps.
- **Location tab:** an embedded, larger version of the same interactive map used in the edit form, read-only here (with an "Edit location" shortcut into the edit form for admins/field officers).

**Sidebar (persistent across tabs):**
- Primary actions: Edit, Deactivate (soft-delete, admin-only, with a confirm dialog explaining it's non-destructive/reversible-by-reactivation-via-edit — reducing anxiety around a "delete" action), Upload/Replace Photo.
- A compact "At a glance" card: status dot + integration score pill + department tag, always visible regardless of which main-content tab is active — so key facts never scroll out of view while reading history/location detail.

**States:**
- *Loading:* skeleton for the whole layout.
- *Not found / dept_viewer accessing another department's camera:* the real backend returns 404 (never 403) for this exact scenario by design — the frontend should render a clean "Camera not found" empty state, which is both accurate to the response and correctly avoids leaking "this exists but you can't see it" information, matching the backend's deliberate security posture.
- *Deactivated camera:* the whole page gets a subtle visual treatment (a muted banner: "This camera is inactive" + a Reactivate action for authorized roles) rather than hiding inactive cameras from detail view entirely — you should still be able to look at history for a decommissioned camera.

---

### 5.6 GIS Map (Command Center)

**Purpose:** The product's visual centerpiece — a live, interactive map of every camera the current user can see, with coverage-gap and heatmap overlays. This page should be the one a new user screenshots to show a colleague.

**Layout:** Full-bleed, edge-to-edge map filling the entire content area below the top bar — no card border around it, no padding eating into map real estate. A floating, semi-transparent control panel (glassmorphism-lite: subtle blur + low-opacity surface color, not a heavy frosted-glass cliché) sits over the top-left of the map for filters/layers, and a floating legend sits bottom-left.

**Components & Data:**
- **Base map:** Leaflet with a custom, muted/desaturated tile style (not default OpenStreetMap's busy, brightly-colored default tiles — a clean grayscale-with-subtle-color base lets camera pins and overlay colors do all the visual work, per Section 1's restraint principle).
- **Camera pins**, sourced live from `GET /gis/cameras-in-bounds` as the user pans/zooms (debounced, refetching only when the viewport meaningfully changes — matching the real backend's explicit purpose of avoiding "send all cameras statewide on every pan/zoom"). Pins are colored by whichever legend mode is active (toggle between "Color by Status" and "Color by Integration Score" in the control panel) — never both at once, to avoid a confusing dual-encoding.
- **Pin interaction:** hover shows a lightweight tooltip (name + status), click opens a compact popover card (photo thumbnail if available, key facts, "View full detail →" link) rather than navigating away immediately — keeps the user in map-exploration flow.
- **Coverage Gap overlay** (toggle): calls `GET /gis/gap-analysis` for the current viewport, renders the returned empty grid cells as semi-transparent amber/red rectangles — with a small "Grid density" control (maps to the real `gridSize` param, capped at 50 per the backend) so a user can go from a coarse overview to fine-grained gap detection.
- **Incident Heatmap overlay** (toggle, clearly labeled **"Beta"** with the violet AI-assisted-style badge — matching the real backend response's own `beta: true` flag and required-by-PRD "Beta" labeling): renders the static sample points from `GET /gis/heatmap` as a smooth heatmap gradient layer (using a heatmap rendering library like leaflet.heat). A small info icon next to the toggle, on hover/tap, explains in one sentence that this is sample/illustrative data, not live incident reporting — honest framing rather than letting it look like real crime data.
- **Filter panel:** department multi-select, camera type, status, integration score — mirrors the Camera List's filter vocabulary for consistency (a user who's learned the filter language on one page shouldn't have to relearn it on another).
- **Overlap Detection: explicitly NOT present in v1** — since this backend endpoint is deferred (see Section 9), the map's control panel should not show a toggle for it at all rather than a disabled/grayed one; adding it back later is trivial once the backend ships.

**States:**
- *Loading (initial map + first pin fetch):* the base map tiles + UI chrome render immediately (map libraries are fast to boot); pins fade in once fetched rather than the whole page waiting on a spinner — perceived-speed matters enormously here since this is the flagship page.
- *Empty viewport (zero cameras in the current pan/zoom):* no error, just an empty map — perhaps a very subtle "No cameras in this area" toast that auto-dismisses, not a blocking empty state (empty map regions are completely normal and shouldn't feel like a failure).
- *Gap analysis grid loading:* the overlay shows a brief shimmer over the current viewport while computing, then resolves to the actual gap rectangles.

**Responsive:** On mobile, the floating control panel becomes a bottom sheet (swipe up to reveal filters/layers, swipe down to focus on the map), and pin popovers become a bottom-anchored card rather than an inline popover (touch-friendlier, doesn't get clipped at screen edges). Map remains fully functional and is arguably where mobile use matters most (a field officer standing at a location, checking nearby coverage).

---

### 5.7 Scoring Verification Queue

**Purpose:** The admin's review queue for AI-suggested ONVIF guesses awaiting human confirmation — the human half of the "AI suggests, human confirms, confirmed answers get fast-tracked forever after" loop that's core to FR-3.

**Layout:** A focused list/queue layout — deliberately not a dense data table, since this is a review-and-decide workflow, not a browse-and-filter one. Each item gets enough visual weight to actually be reviewed, not just scanned.

**Components & Data:**
- Queue sourced from `GET /scoring/pending-verification`, each entry rendered as a card (not a table row): camera name + department, brand/model, the AI's suggestion (`aiSuggestedOnvif` + `aiConfidenceNote` shown as a quoted "reasoning" snippet — making the AI's logic visible builds trust in the human reviewing it, rather than a bare "yes/no" with no context), submitted timestamp.
- Two clear action buttons per card: **Confirm** (opens a small inline choice: "Confirm as: Yes / No" — matching the real backend's required `finalOnvifStatus` on confirm, which may differ from the AI's original suggestion if the reviewer disagrees) and **Reject** (single click, no further input needed, matching the real backend's reject path).
- On Confirm: a brief success state on that card (checkmark, "Vendor lookup updated — future cameras of this model will resolve instantly") — explicitly surfacing the systemic effect of the action (the new `vendor_lookup` row) so the reviewer understands their action has lasting value, not just closing one ticket.
- Queue count badge in the nav item itself (e.g., "Scoring 4") — the one place in the product where a small numeric badge is warranted, since it's a genuine actionable count, not vanity.

**States:**
- *Empty queue:* a genuinely pleasant empty state — "You're all caught up" + a subtle celebratory icon, not just blank space. Being told "there's nothing to do" should feel good, briefly, not feel like a broken page.
- *Loading:* skeleton cards.
- *Action in flight:* the specific card being confirmed/rejected shows its own inline spinner; the rest of the queue remains fully interactive (no whole-page lock for one row's action).

**Responsive:** Cards already stack naturally in a single column at all but the widest desktop views (where two columns can fit) — no special mobile treatment needed beyond standard reflow.

---

### 5.8 Health / At-Risk Dashboard

**Purpose:** A focused operational report — which cameras are trending toward failure and need physical attention, per FR-4's at-risk definition (3+ offline events in the trailing 14 days, both thresholds real and backend-configurable).

**Layout:** A single-purpose report page: a summary stat row at top (Total At-Risk, broken down by department as a small bar chart), followed by a prioritized list.

**Components & Data:**
- Sourced from `GET /health/at-risk`. Each row: camera name/department, current status pill, **offline count** shown prominently as the primary sort/scan signal (not buried in metadata — it's the entire reason this camera is on this list), a "View History →" link into that camera's detail page's Health tab.
- Sort control: by offline count (default, descending), by department, by camera name.
- A small "What counts as at-risk?" info tooltip stating the real threshold values in plain language, since the number itself (3 in 14 days) is meaningful context every viewer should have readily available, not buried in documentation.

**States:**
- *Empty (zero at-risk cameras):* another genuinely positive empty state — "No cameras are currently at risk. Nice work." This dashboard existing specifically to *usually* be empty (a healthy network) is worth designing for as the common case, not an edge case.
- *Loading:* skeleton rows.

**Responsive:** Straightforward table→card reflow, same pattern as 5.2.

---

### 5.9 Audit Log Viewer

**Purpose:** A searchable, filterable record of who did what, when — for admin oversight and the dedicated `auditor` role.

**[Backend Gap — this page cannot be fully built yet]:** the backend currently *writes* audit_log rows automatically via the global interceptor (every create/update/delete/login/logout/verify action, confirmed working via the tested `AuditLogInterceptor`), but **no `GET` endpoint exists to read them back.** This is a genuine, real gap — not a frontend oversight — and should be raised as a small, well-scoped backend addition (a paginated, filterable `GET /audit-log` endpoint, admin+auditor only, is all that's needed; the write side and data model already fully support it) before this page can be built. The spec below describes the intended v1 experience once that endpoint exists, so design/frontend work can proceed on everything else while that endpoint is added in parallel.

**Layout (once unblocked):** A filter bar (date range, action type, entity type, user) above a dense, monospace-leaning data table — this is the one page in the product where table density and raw precision (exact timestamps, exact user IDs) should dominate over the softer visual language elsewhere, because its entire purpose is forensic accuracy.

**Components & Data:**
- Table columns: Timestamp (monospace, absolute — not relative time, since precision matters here specifically), Actor (user email), Action (a colored tag: create/update/delete/login/etc.), Entity Type + ID (monospace, clickable if it resolves to a camera → deep-links to that camera's detail page), Correlation ID (monospace, copyable — ties back to the real correlation-ID system already built for request tracing).
- **Diff view:** clicking a row expands it inline to show the real `before`/`after` metadata captured by the backend's audit-context system — rendered as a clean side-by-side or unified diff (field name → old value → new value), not a raw JSON blob dump. This is the single feature that makes this page genuinely valuable rather than a glorified log tail, and it's fully supported by data the backend already captures.

**States:** standard loading/empty/error patterns consistent with the rest of the product.

**Responsive:** Given its dense, precision-oriented nature, this page is reasonably desktop-primary; on mobile it degrades to a simplified card list (Actor + Action + relative time, tap to see full detail in a bottom sheet) rather than trying to cram a wide table into a phone screen.

---

### 5.10 Settings

**Purpose:** Account management for every user, plus user/role administration for admins.

**Layout:** A settings-pattern layout — a left sub-nav (Account, and for admins: User Management) within the settings area, content panel to the right. Collapses to a top tab strip on mobile.

**Account panel (all roles):** view own email/role/department (read-only — no self-service email/password change in v1, since **[Backend Gap]**: no such endpoint exists), a theme toggle (Light/Dark/System — a first-class, prominently placed control given the dual-theme system in Section 2.1), and Sign Out.

**User Management panel (admin only):** **[Backend Gap]**: only `PATCH /users/:id/role` exists — there's no `GET` endpoint to list users, no create-user endpoint, and no way to see a user's department assignment via API. This means a genuine user-management table ("see all users, change any user's role") **cannot be built as a self-contained frontend feature today** — it would need at minimum a `GET /users` list endpoint. Recommend flagging this as a near-term backend addition; until then, this panel should be scoped down to "change a specific user's role, given you already know their user ID" (a simple lookup-by-ID form) as an honest, working v1 stopgap rather than building UI against endpoints that don't exist.

---

## 6. Component Library (Reusable Patterns)

A shared component library underlies every page above — designed once, used everywhere, so visual consistency is structural rather than a matter of discipline.

- **Status Pill:** the colored, pill-shaped badge used for camera status, integration score, and audit action tags throughout. One component, color driven entirely by a semantic prop (`status="online"`, `score="easy"`), never by ad hoc inline styling per usage site.
- **Stat Tile:** the dashboard's building block — label, big number, optional trend/sparkline, optional click-through. Reused identically across Overview and the At-Risk dashboard's summary row.
- **Empty State:** icon + headline + optional body copy + optional primary action button. One component, many configurations — every empty state in this document (dashboard, list, queue, at-risk) is an instance of this same pattern, which is exactly why they all feel coherent rather than independently invented.
- **Data Table:** sortable headers, built-in loading/empty/error slot states, responsive card-fallback behavior baked in rather than reimplemented per page.
- **Toast/Notification:** bottom-right (desktop) / bottom-center (mobile) stack, auto-dismissing (success) or persistent-until-dismissed (error), max 3 visible at once with overflow collapsing into a "+2 more" summary — prevents notification spam from ever burying the UI.
- **Confirm Dialog:** used for every destructive/consequential action (deactivate camera, logout) — consistent copy pattern ("Are you sure you want to [action]? [consequence sentence]"), consistent button placement (destructive action always the right-most, visually de-emphasized as a secondary/outline button — NOT a filled red button, which research on confirm-dialog patterns consistently shows reduces accidental confirms since it's not the "loud, easy-to-hit" default).
- **Map Pin / Marker:** a single custom marker component (not default Leaflet pins) — a small circular dot with a colored ring, sized appropriately at different zoom levels, with the hover/click/popover behavior from Section 5.6 built in once and reused wherever a camera-on-a-map appears (the full GIS page, the dashboard's mini-map preview, the camera detail page's location tab).

---

## 7. Accessibility

- **Color is never the sole signal.** Every status pill pairs its color with a text label and, where space allows, a distinct icon (a filled circle for online, a hollow ring for unknown, an X for offline) — colorblind users and anyone in a low-contrast environment (bright sunlight on a field officer's phone) still get full information.
- **Keyboard navigation is complete**, not an afterthought: every interactive element (including map pins, via a keyboard-accessible list-view fallback for the map) is reachable and operable via keyboard, with visible focus rings using the brand accent color at sufficient contrast against both themes.
- **Contrast ratios meet WCAG AA minimum** (4.5:1 body text, 3:1 large text/UI components) in both dark and light themes — verified against the actual token values in Section 2.1, not assumed.
- **Screen reader support:** all icon-only buttons (the row-hover "⋮" menu, map layer toggles) carry proper `aria-label`s; live-updating regions (the bulk-upload progress bar, the map's pin count) use `aria-live="polite"` so updates are announced without being disruptive.
- **Motion sensitivity:** every animation described in Section 2.5 respects `prefers-reduced-motion: reduce` by falling back to instant state changes, no exceptions.
- **Touch targets** on mobile meet the 44×44px minimum throughout, including map controls and table-row tap zones.

---

## 8. Responsive Strategy Summary

Rather than "mobile-first" or "desktop-first" as a blanket rule, this product has **two genuinely different primary contexts** that both deserve first-class design:

- **Desktop:** the primary context for admins doing bulk operations, reviewing the scoring queue, deep analysis on the map, and audit review. Data density, multi-panel layouts, and keyboard/command-palette power-user affordances matter most here.
- **Mobile:** the primary context for field officers actively at a camera location — adding a new camera with GPS capture, uploading a photo, checking a nearby camera's status. The Add/Edit Camera form and the Map are the two pages that must be exceptional on mobile, not merely functional.

Tablet is treated as its own breakpoint tier (not just "big phone" or "small desktop") for the table→card transition points and control-panel→drawer transitions described per-page above, since a tablet in a control-room context (mounted, larger, often landscape) behaves differently from a phone in someone's hand.

Breakpoints: mobile <640px, tablet 640–1024px, desktop 1024–1440px, wide desktop >1440px (where the content area gets a max-width and centers, rather than data tables stretching uncomfortably wide).

---

## 9. Backend Gaps Discovered While Writing This Document

Flagged honestly rather than silently designed around, per the standard this project has held throughout the backend build. None of these block starting frontend work broadly — they block specific features noted above.

| Gap | Blocks | Suggested resolution |
|---|---|---|
| No `GET /departments` list endpoint | Camera List's department filter, Add/Edit form's department dropdown | Small addition — the data already exists (`department` table), just needs a read endpoint. High priority — blocks two core pages. |
| No audit-log read endpoint (`GET /audit-log` or similar) | Audit Log Viewer page (5.9) entirely; Dashboard's "Recent Activity" panel | The write side and data model are fully built and tested; only a paginated, filterable read endpoint is missing. |
| No `GET /users` list endpoint | Full user-management UI in Settings (5.10) — currently only single-user role updates are possible, given a known ID | Needed for any real admin user-management screen. |
| No endpoint to set `ip_address`/`rtsp_port` on a camera | The Add/Edit form intentionally omits these fields for v1 (Section 5.3) even though the schema/health-check cron already support them | Needed to make the health-monitoring cron actually useful for real IP cameras, since today there's no way to populate the field it depends on except direct DB access. |
| `POST /auth/refresh` expects the refresh token in the request body, not an httpOnly cookie | The recommended cookie-based refresh-token storage in Section 4.3 | Either accept the body-token approach for v1 (simpler, slightly weaker XSS posture) or adjust the endpoint to also accept/set a cookie — a decision worth making deliberately, not by default. |
| No free-text search param on `GET /cameras` | The Camera List's search input (5.2) can only be a client-side filter on the current page's loaded rows, not a true search | Low priority unless camera volume grows large enough that client-side filtering of one page becomes meaningfully worse than server-side search. |
| No password-reset / forgot-password flow | Explicitly omitted from the Login page (4.1) by design for v1 | Only needed if self-service password recovery becomes a requirement; accounts are currently admin-provisioned. |
| `GET /gis/overlap-detection` deferred (user's own decision, not a gap) | The Map page's control panel has no overlap-detection toggle in v1 (5.6) | Already tracked in `model1-service/docs/MAIN.md`'s Future Improvements — add the map toggle back once that endpoint ships. |

---

## 10. Open Questions for the User

A few decisions genuinely need your input before/during frontend build, surfaced here rather than assumed:

1. **Product naming/copy:** this document uses "Sentinel" as a working product name (from the hackathon project's own name) and placeholder tagline copy. Final naming, tagline, and voice/tone for microcopy (empty states, error messages, button labels) should be confirmed.
2. **Refresh-token storage strategy** (Section 4.3 / Section 9) — httpOnly cookie vs. current body-token approach — a real security/architecture tradeoff, not a pure design call.
3. **Priority order for the Backend Gaps in Section 9** — several frontend pages are meaningfully blocked or reduced-scope without small backend additions; worth deciding which (if any) get built before frontend work starts versus in parallel.
4. **Design tool / handoff format** — whether this PRD is the final spec frontend engineers work from directly, or whether a Figma (or similar) high-fidelity design pass happens first using this document as its brief.
