# Integration-Readiness Scoring (FR-3) + Photo Upload (FR-2) — Design

## Scope

This design covers FR-3 (Integration-Readiness Scoring) in full, plus the minimal
slice of FR-2 (photo upload) that FR-3's OCR flow depends on: a standalone photo
upload endpoint that sets `camera.photo_url`. FR-2's "use current location" GPS
button is frontend-only and out of scope here (backend already accepts
lat/long directly).

Out of scope: FR-4 (health monitoring), FR-5 (GIS), and any further FR-2 polish.

## PRD Deviation: AI Vendor

**PRD Section 6a point 6 currently pins the AI provider to Anthropic Claude
(`claude-haiku-4-5`). This design changes that to OpenAI (`gpt-4o-mini`)** —
decided during brainstorming for this feature. Reasoning: gpt-4o-mini is
natively multimodal (one model/API handles both the text ONVIF-guess and the
label-photo vision/OCR call), requires only an API key (no AWS account/IAM
setup, unlike the Bedrock alternative considered), and is cheap/fast enough
for this classification-scale task. The PRD will be updated to reflect this
as part of implementation. The 8-second timeout / 1-retry-with-backoff /
fall-back-to-`null` contract from Section 6a point 6 is unchanged — only the
vendor underneath it changes.

The provider is built behind an `AiProvider` interface specifically so this
vendor choice can change again later without touching any calling code.

## Module Layout

```
src/
├── scoring/
│   ├── scoring.module.ts
│   ├── scoring.controller.ts          # POST /scoring/lookup, /scoring/lookup/photo,
│   │                                   #   GET /scoring/pending-verification,
│   │                                   #   POST /scoring/verify/:verificationId
│   ├── scoring.service.ts             # vendor_lookup fast-path, score computation,
│   │                                   #   scoring_verification writes
│   ├── dto/
│   │   ├── score-lookup.dto.ts        # { cameraId, brand, model }
│   │   ├── score-lookup-photo.dto.ts  # { cameraId }
│   │   └── verify-scoring.dto.ts      # { decision, finalOnvifStatus? }
│   └── providers/
│       ├── ai-provider.interface.ts   # AiProvider — the vendor-swap boundary
│       ├── ai-provider.token.ts       # AI_PROVIDER injection token
│       ├── openai.provider.ts         # OpenAiProvider implements AiProvider
│       └── openai.provider.spec.ts
├── storage/
│   ├── storage.module.ts
│   ├── storage-provider.interface.ts  # StorageProvider — save(), getUrl()
│   ├── storage-provider.token.ts      # STORAGE_PROVIDER injection token
│   ├── cloudinary-storage.provider.ts
│   └── cloudinary-storage.provider.spec.ts
```

`storage/` is a standalone module (not nested under `scoring/` or
`camera-registry/`) since file storage is a generic capability any future
feature could need — matches Section 6a point 7's `StorageProvider`
interface requirement. The camera photo-upload endpoint
(`POST /cameras/:id/photo`) lives on the existing `CameraRegistryController`
(it's fundamentally a camera operation) but depends on `storage/`'s
`StorageProvider` token rather than owning upload logic itself.

`ScoringService` depends on the `AiProvider` interface via its injection
token, never on `OpenAiProvider` directly — swapping AI vendors later means
writing one new class implementing `AiProvider` and changing one binding in
`scoring.module.ts`. `ScoringService`'s own tests mock the interface, so they
don't change either.

## AI Provider Contract

```typescript
interface AiProvider {
  guessOnvifSupport(
    brand: string,
    model: string,
  ): Promise<{ onvifSupported: 'yes' | 'no' | 'unsure'; reasoning: string } | null>;

  identifyFromPhoto(
    photoUrl: string,
  ): Promise<{ brand: string | null; model: string | null } | null>;
}
```

Both methods return `null` on any failure (timeout, API error, malformed
JSON response) rather than throwing. Callers treat `null` as "fall back to
unknown" — this satisfies FR-3's "AI provider failure must never block
camera creation/scoring" requirement structurally, not via try/catch
scattered at call sites.

`OpenAiProvider` (the only v1 implementation):
- Uses the official `openai` npm SDK.
- Model from `OPENAI_MODEL` env var, default `gpt-4o-mini`.
- `guessOnvifSupport`: `chat.completions.create` with
  `response_format: { type: 'json_object' }`, prompting for
  `{ onvif_supported: 'yes'|'no'|'unsure', reasoning: string }`.
- `identifyFromPhoto`: same call shape, with an `image_url` content block
  (the Cloudinary-hosted photo URL) instead of a text-only prompt, asking
  for `{ brand: string|null, model: string|null }`.
- 8-second timeout via the SDK's request options; on timeout or non-2xx,
  one retry with exponential backoff (fixed short delay is sufficient at
  this scale — e.g. 500ms); second failure returns `null`.

`.env.example` changes: remove `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`, add
`OPENAI_API_KEY=` / `OPENAI_MODEL=gpt-4o-mini`.

## Score Computation

`ScoringService.lookupByBrandModel(cameraId, brand, model)` — the shared
core both `/scoring/lookup` and the post-OCR half of `/scoring/lookup/photo`
call into:

1. Query `vendor_lookup`: exact match on `brand` (case-insensitive), then
   match the input `model` against each candidate row's `model_pattern`
   using SQL `LIKE`/`ILIKE` — the wildcard lives in the **stored**
   `model_pattern` value (e.g. a row with `model_pattern = 'DS-2CD%'`
   matches an input `model` of `'DS-2CD2143G2-I'`), so the query is
   `WHERE brand ILIKE $1 AND $2 ILIKE model_pattern`, not the other way
   around. First match wins; if multiple rows could match the same input,
   that's a data-quality issue in `vendor_lookup` seeding, not something
   this query resolves.
2. **Match found** → `onvifStatus = row.onvifStatus`,
   `sdkAvailable = row.sdkAvailable`, `onvifSource = 'vendor_lookup'`,
   `dataConfidence = 'verified'`. No AI call, no `scoring_verification` row.
3. **No match** → `aiProvider.guessOnvifSupport(brand, model)`.
   - Success → `onvifStatus` = mapped from `onvif_supported`
     (`'unsure'` → `'unknown'`), `sdkAvailable = false` (the AI contract
     carries no SDK-availability signal — that's a vendor_lookup-only
     concept per the score formula), `onvifSource = 'ai_guess'`,
     `dataConfidence = 'ai_estimated'`. Creates a `scoring_verification` row
     (`status = 'pending'`, `ai_suggested_onvif`,
     `ai_confidence_note = reasoning`).
   - Failure (`null`) → `onvifStatus = 'unknown'`, `onvifSource = null`,
     `dataConfidence = 'self_reported'`. No `scoring_verification` row —
     there is no guess to verify.
4. `integrationScore` computed from the fixed PRD formula
   (`onvifStatus`/`sdkAvailable`) — **always derived, never accepted as
   direct input on any endpoint.**
5. Camera's `onvifStatus`, `integrationScore`, `onvifSource`,
   `dataConfidence` written via raw SQL `UPDATE` (same pattern as
   `applyCameraFieldChanges` in `camera-registry.service.ts`), plus an
   `update_camera` audit entry via the existing shared
   `writeAuditLogEntry`.

Note: an AI-guess path can only ever resolve to `integration_score` of
`easy`, `hard`, or `needs_verification` — never `medium`, since `medium`
requires `sdk_available = true` and the AI provider has no way to assert
that. This is a natural consequence of the AI contract, not a gap.

**Why `integration_score` stays a stored column** (resolved during
brainstorming): it's fully derived from `onvif_status` + `sdk_available`
with no independent input, so it's a denormalized read-optimization, not new
information. It stays because FR-1's `GET /cameras` already filters/lists by
`integrationScore` — storing it keeps that query simple and avoids
duplicating the score formula's branching logic across every read site. The
single write path (this service) guarantees it never drifts out of sync.

## Endpoints

### `POST /scoring/lookup` — roles: admin, field_officer

Body: `{ cameraId: string, brand: string, model: string }` (all required —
`cameraId` is not optional; this endpoint always resolves and writes to a
real camera, decided during brainstorming).

Loads the camera (404 if not found), runs `lookupByBrandModel`, returns the
updated `{ onvifStatus, integrationScore, onvifSource, dataConfidence }`.

### `POST /cameras/:id/photo` — roles: admin, field_officer

New endpoint on the existing `CameraRegistryController`. Multipart file
upload (reuses the `FileInterceptor` pattern and `MulterModule` config
already established for `POST /cameras/bulk` — no new Multer setup needed).

1. Loads the camera (404 if not found).
2. `storageProvider.save(fileBuffer, cameraId)` → `CloudinaryStorageProvider`
   uploads to Cloudinary, returns a URL.
3. Updates `camera.photo_url`.
4. Writes an `update_camera` audit entry.
5. Returns the updated camera record.

### `POST /scoring/lookup/photo` — roles: admin, field_officer

Body: `{ cameraId: string }`.

1. Loads the camera; `400` if `photoUrl` is null ("camera has no photo —
   upload one first via POST /cameras/:id/photo").
2. `aiProvider.identifyFromPhoto(camera.photoUrl)`.
   - Success, both `brand` and `model` non-null → writes the identified
     brand/model onto the camera (the one case where brand/model is set as
     a side effect, since the officer didn't type them), then calls
     `lookupByBrandModel(cameraId, brand, model)` and returns its result.
   - Success but brand/model partially/fully unidentifiable (either is
     `null`), or failure (`null` from the provider call) → treated
     identically: camera's `onvifStatus` stays/becomes `'unknown'`,
     `integrationScore = 'needs_verification'`,
     `dataConfidence = 'self_reported'`. No `scoring_verification` row.
     Response is `200` with `{ identified: false, onvifStatus: 'unknown',
     integrationScore: 'needs_verification' }` — not a `500`; per the PRD's
     "unknown is valid" philosophy this is an expected outcome requiring
     manual brand/model entry, not a server error. The success case
     returns `{ identified: true, brand, model, onvifStatus,
     integrationScore, onvifSource, dataConfidence }`.

### `GET /scoring/pending-verification` — roles: admin

Paginated list of `scoring_verification WHERE status = 'pending'`, joined
with the camera's name/brand/model for display. Same pagination DTO
conventions as `GET /cameras` (default 25, max 100).

### `POST /scoring/verify/:verificationId` — roles: admin

Body: `{ decision: 'confirm' | 'reject', finalOnvifStatus?: 'yes' | 'no' }`.
`finalOnvifStatus` is required when `decision = 'confirm'`, rejected as
`400` if present with `decision = 'reject'` (there's nothing to finalize on
a rejection) and required-but-missing on confirm.

1. Loads the `scoring_verification` row; `404` if not found, `400` if
   `status !== 'pending'` (already decided — cannot re-verify).
2. **Confirm**: sets `status = 'confirmed'`, `verified_by = currentUser`,
   `verified_at = now()`, `final_onvif_status`. Updates the source camera's
   `onvifStatus = finalOnvifStatus`, recomputes `integrationScore`, sets
   `onvifSource = 'user_confirmed'`. Inserts a new `vendor_lookup` row
   (`brand`, `model` as `model_pattern`, `onvif_status = finalOnvifStatus`,
   `source = 'ai_verified'`) so future cameras of the same model resolve
   via the fast path.
3. **Reject**: sets `status = 'rejected'`, `verified_by`, `verified_at`.
   Camera is left untouched (still shows `onvif_source = 'ai_guess'` until
   someone re-runs lookup or edits manually). No `vendor_lookup` row.
4. Both branches write an audit entry
   (`action: 'verify_scoring'`, `entityType: 'scoring_verification'`).

## Error Handling

- AI provider failures never throw past the provider boundary — `null` is
  the only failure signal, handled explicitly at each call site per the
  flows above. No endpoint in this feature can 500 due to an AI/Cloudinary
  outage; the worst case is falling back to `unknown`/`needs_verification`,
  which is explicitly a valid state per the PRD.
- Cloudinary upload failure in `POST /cameras/:id/photo` **does** propagate
  as an error response (`502 Bad Gateway` or similar) — unlike the AI
  provider, there's no meaningful "unknown" fallback for "the photo didn't
  get stored"; the endpoint's entire job is that upload, so failure must be
  visible to the caller rather than silently swallowed.
- Standard `NotFoundException`/`BadRequestException` for missing
  cameras/verification rows and invalid state transitions, consistent with
  the existing `camera-registry` module's error style.

## Testing

Same TDD discipline as prior modules: RED → GREEN per method, `AiProvider`
and `StorageProvider` mocked at the interface boundary in `ScoringService`
and `CameraRegistryController`/`CameraRegistryService`'s unit tests. A
`ClaudeAiProvider`-equivalent-level "does the real SDK call shape work"
check happens only in `openai.provider.spec.ts` (mocking the `openai` SDK
client itself, not the whole `AiProvider` interface) — no live API calls in
automated tests. E2E tests use a fake `AiProvider`/`StorageProvider`
override bound in the test module, so they can run without real
OpenAI/Cloudinary credentials, exercising the full HTTP → service → DB path
with deterministic fake responses.
