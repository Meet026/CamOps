# PRD — Two-Factor Authentication (TOTP) Frontend

**Status:** Backend is fully built, tested (315 unit + 8 dedicated e2e tests,
all passing), and live. This document describes the UI to build on top of
it. Nothing here requires further backend changes — every endpoint below
already exists and works exactly as described.

**Audience:** whoever builds the frontend for this feature. Every request/
response shape below was copied directly from the real, verified backend
code (`model1-service/src/auth/`), not written from memory.

**Design spec for the backend side (background reading, not required to
build the UI):** `docs/superpowers/specs/2026-09-12-totp-two-factor-auth-design.md`

---

## 1. What we're building

Users can turn on TOTP-based two-factor authentication (the kind Google
Authenticator, Authy, or 1Password support) for their own account. Once
turned on:

- Logging in requires the password **and** a 6-digit code from their phone.
- If they lose their phone, one of 10 one-time backup codes gets them back
  in.
- They can turn it off again at any time (with a password re-check).

Nothing changes for a user who never turns this on — their login stays
exactly as it is today.

---

## 2. Where this lives in the product

Two places need new UI:

1. **Settings page** — a new "Two-Factor Authentication" section where a
   user enables, disables, or regenerates backup codes for their own
   account.
2. **Login flow** — after a correct password, a user with 2FA enabled sees
   one more screen asking for their 6-digit code (or a backup code) before
   they're actually logged in.

No other page changes. This is entirely self-contained to the login flow
and the user's own account settings.

---

## 3. The full user flow

### 3.1 Turning 2FA on (from Settings)

```
1. User clicks "Enable Two-Factor Authentication" in Settings.
2. Frontend calls POST /auth/totp/setup (no body needed).
   → Backend generates a new secret and returns it, plus a QR-code URL.
3. Frontend shows a QR code (rendered from the returned URL) and, next to
   it, the raw secret as text (for anyone who can't scan a QR code and
   needs to type it into their app manually).
4. User scans the QR code (or types the secret) into their authenticator
   app. The app starts showing a 6-digit code that changes every 30 seconds.
5. Frontend shows an input for that 6-digit code, with a "Confirm" button.
6. User enters the current code from their app and clicks Confirm.
7. Frontend calls POST /auth/totp/confirm with that code.
   → If wrong: show an error, let them try again (nothing is enabled yet,
     so there's no risk in retrying).
   → If right: 2FA is now ON. The response includes 10 backup codes.
8. Frontend shows all 10 backup codes clearly, with a strong instruction to
   save them somewhere safe — this is the ONLY time they will ever be shown
   in full. (A "Download" or "Copy all" button is a good idea here.)
9. User acknowledges (a checkbox or a "I've saved these" button) and the
   flow closes, returning to Settings, which now shows 2FA as "Enabled".
```

**Important UX detail:** step 4 has no signal the frontend can observe —
the user is off in their phone's authenticator app. Don't add a spinner or
timer here; just wait for them to come back and type a code in step 5-6.

**Important edge case:** if a user starts setup (step 2) and abandons it —
closes the tab, never confirms — nothing bad happens. The backend simply
overwrites the unconfirmed secret the next time they call `/auth/totp/setup`
again. 2FA is never accidentally "half-enabled." The frontend doesn't need
to handle this specially; just let them start over.

### 3.2 Logging in with 2FA enabled

```
1. User enters email + password on the normal login screen, clicks Login.
2. Frontend calls POST /auth/login as it does today.
3. THE RESPONSE SHAPE NOW DIFFERS — see §4.1. If the response has
   `mfaRequired: true`, do NOT treat this as a successful login. Store the
   `mfaToken` from the response (in memory only, not localStorage — same
   handling as the access token today) and show a new screen: "Enter the
   6-digit code from your authenticator app."
4. User enters the code (or, if they don't have their phone, a backup code
   instead — same input field works for both, see §4.3) and submits.
5. Frontend calls POST /auth/totp/verify with { mfaToken, code }.
   → If wrong: show an error ("Invalid code"), let them retry. Same rate
     limit as login itself applies (5 attempts/minute) — if they hit it,
     show the same "too many attempts, try again in a moment" messaging
     the login screen already has for password rate-limiting.
   → If right: response is a normal { accessToken, refreshToken } — treat
     this exactly like a successful login today (store tokens, redirect).
```

**One input field, two possible code formats:** a TOTP code is 6 digits
(e.g. `482913`). A backup code looks like `XXXX-XXXX` (4 letters/numbers, a
dash, 4 more — e.g. `Y6JB-GJCY`). The backend accepts either in the same
`code` field and figures out which one it is — the frontend does not need
to validate the format or ask which kind the user is entering. A small
helper line under the input ("Lost your phone? You can also enter one of
your backup codes here.") is enough.

### 3.3 Disabling 2FA (from Settings)

```
1. User clicks "Disable Two-Factor Authentication" in Settings (only
   visible when 2FA is currently enabled).
2. Frontend shows a confirmation dialog asking for their CURRENT PASSWORD
   (not a TOTP code) — this is a deliberate security requirement, not
   optional. Explain briefly why if there's room: "For your security,
   please confirm your password to turn off two-factor authentication."
3. Frontend calls POST /auth/totp/disable with { currentPassword }.
   → Wrong password: show an error, let them retry.
   → Right password: 2FA is now off. All existing backup codes are
     deleted. Settings updates to show 2FA as "Disabled".
```

### 3.4 Regenerating backup codes (from Settings, only when 2FA is enabled)

```
1. User clicks "Generate new backup codes" (e.g. because they've used most
   of their 10, or are worried the old ones leaked).
2. Same password-confirmation dialog as disabling (§3.3).
3. Frontend calls POST /auth/totp/backup-codes/regenerate with
   { currentPassword }.
   → Right password: ALL old backup codes stop working immediately, and
     10 brand new ones are returned. Show them exactly like step 8 in
     §3.1 — this is the only time these new codes will ever be shown.
```

---

## 4. API reference — every endpoint, exact shapes

All endpoints are under the existing `/api/v1` prefix. All error responses
follow the existing app-wide error shape: `{ statusCode, message, error,
correlationId }`.

### 4.1 `POST /auth/login` — **existing endpoint, response shape now varies**

Request (unchanged):
```json
{ "email": "officer@sentinel.local", "password": "correct-password" }
```

Response when the account does **not** have 2FA enabled (unchanged from
today):
```json
{ "accessToken": "<jwt>", "refreshToken": "<opaque token>" }
```

Response when the account **does** have 2FA enabled (new):
```json
{ "mfaRequired": true, "mfaToken": "<short-lived jwt, expires in 5 minutes>" }
```

**Frontend must check for `mfaRequired` in the response before assuming a
successful login.** The cleanest check: `if (response.data.mfaRequired) { ... show code screen ... } else { ... treat as logged in, same as today ... }`.

Errors (unchanged): `401` for wrong email/password, `429` if rate-limited
(5 attempts/minute/IP).

### 4.2 `POST /auth/totp/verify` — **new, completes a 2FA login**

Public route (no auth header — the user isn't logged in yet at this point).

Request:
```json
{ "mfaToken": "<the mfaToken from the login response above>", "code": "482913" }
```
`code` can be a 6-digit TOTP code OR a backup code like `"Y6JB-GJCY"` — same
field, backend tries the TOTP code first and falls back to backup codes
automatically.

Response on success (identical shape to a normal successful login):
```json
{ "accessToken": "<jwt>", "refreshToken": "<opaque token>" }
```

Errors:
- `401 "Invalid code"` — wrong TOTP code and no backup code matched either.
- `401 "Invalid or expired MFA challenge token"` — the `mfaToken` itself is
  expired (5 min limit) or malformed. In this case, send the user back to
  the login screen to start over — there's no way to recover an expired
  challenge, they must log in again.
- `429` — same 5/minute rate limit as login itself.

### 4.3 `GET /auth/totp/status` — **new, check current 2FA state**

Requires a valid access token (normal authenticated request). No body.

Response:
```json
{ "enabled": false, "enabledAt": null }
```
or, once enabled:
```json
{ "enabled": true, "enabledAt": "2026-09-12T14:37:09.971Z" }
```

Use this to decide what Settings shows (the "Enable" button vs. the
"Disable" + "Regenerate backup codes" buttons). Call it once when Settings
loads.

### 4.4 `POST /auth/totp/setup` — **new, step 1 of enabling 2FA**

Requires a valid access token. No request body.

Response:
```json
{
  "secret": "GQYAAPRAPE5CKTC2",
  "otpauthUrl": "otpauth://totp/Sentinel:officer%40sentinel.local?secret=GQYAAPRAPE5CKTC2&period=30&digits=6&algorithm=SHA1&issuer=Sentinel"
}
```

- `otpauthUrl` — feed this directly into a QR-code-rendering library (any
  client-side QR generator that takes a string and draws a QR code works —
  no special otpauth-specific library needed, it's a plain URL).
- `secret` — show this as plain text underneath the QR code, for manual
  entry into an authenticator app that can't scan (or for users on a
  device where scanning isn't convenient).

Safe to call multiple times in a row (e.g. user clicks "Enable" again after
closing the dialog without confirming) — each call just replaces the
previous unconfirmed secret.

### 4.5 `POST /auth/totp/confirm` — **new, step 2 of enabling 2FA**

Requires a valid access token.

Request:
```json
{ "code": "482913" }
```
(the current 6-digit code from the authenticator app, after scanning the
QR code from §4.4)

Response on success:
```json
{ "backupCodes": ["Y6JB-GJCY", "DXWT-SDMF", "JHCX-2M9D", "4AL9-ZSZA", "USAE-Z2QW", "VXV5-TJU6", "49ZX-2X2L", "9QT7-SMF7", "2RFR-ZV2L", "669L-295P"] }
```
Always exactly 10 codes. **This is the only response that will ever contain
them in full — there is no "view my backup codes again" endpoint.** Make
sure the UI makes this crystal clear (a warning banner, not just a small
caption) and gives an easy way to copy/download them before the user moves
on.

Errors: `401 "Invalid code"` if the code doesn't match — 2FA is NOT enabled
in this case, let the user try again (call `/confirm` again with a new
code; no need to call `/setup` again unless they want a fresh QR code too).

### 4.6 `POST /auth/totp/disable` — **new**

Requires a valid access token.

Request:
```json
{ "currentPassword": "correct-password" }
```

Response on success: `204 No Content` (empty body).

Errors: `401 "Current password is incorrect"` if the password is wrong —
2FA stays enabled in this case.

### 4.7 `POST /auth/totp/backup-codes/regenerate` — **new**

Requires a valid access token. Only meaningful when 2FA is already enabled.

Request:
```json
{ "currentPassword": "correct-password" }
```

Response on success:
```json
{ "backupCodes": ["<10 new codes>"] }
```
Same "show once, make it obvious" treatment as §4.5. All 10 previous backup
codes are invalidated the instant this succeeds.

Errors: `401 "Current password is incorrect"` (nothing changes), or `401
"2FA is not enabled for this account"` if somehow called while 2FA is off
(shouldn't be reachable from the UI if the button is only shown when
`enabled: true`, but worth handling gracefully just in case).

---

## 5. What changes in the existing frontend code

This section is a map of the real files this touches, for whoever picks up
the implementation — not new files to invent, just where the new pieces
plug into what's already there.

- **`src/api/auth.ts`** — the `login()` function's return type needs to
  widen to `LoginResponse | MfaChallengeResponse` (or a discriminated union
  with an `mfaRequired` flag). Add `verifyTotp(mfaToken, code)`,
  `getTotpStatus()`, `setupTotp()`, `confirmTotp(code)`, `disableTotp(currentPassword)`,
  `regenerateBackupCodes(currentPassword)` — all thin wrappers over
  `apiClient`, matching the existing style in this file exactly.
- **`src/contexts/AuthContext.tsx`** — `login()` currently calls
  `authApi.login(...)` and unconditionally calls `setTokens(...)`. This
  needs to branch: if the response has `mfaRequired: true`, don't call
  `setTokens` — instead return/expose the challenge (e.g. throw a typed
  error the login page catches, or return a discriminated result) so
  `LoginPage` can show the code-entry screen instead of redirecting.
- **`src/pages/login/LoginPage.tsx`** — needs a second screen/step after a
  successful password check when a challenge comes back. Simplest approach:
  keep the same page, swap the rendered form based on local state (e.g.
  `step: 'password' | 'totp'`), reusing the existing card layout.
- **`src/pages/settings/SettingsPage.tsx`** — new "Two-Factor
  Authentication" section, likely right below the existing "Change
  Password" section (`ChangePasswordSection`, per the file's existing
  structure) — same card style, same password-recheck dialog pattern
  already used there for changing passwords.
- **`src/types/api.ts`** — new types for the TOTP request/response shapes
  in §4.

None of this requires new routes, new pages, or new layout components —
it's new state and new sections inside pages that already exist.

---

## 6. Non-negotiable UX/security rules

1. **Backup codes are shown exactly once** (right after confirm, and right
   after regenerate). Never build a "view my backup codes" screen — the
   backend genuinely cannot show them again (only their hashes are
   stored), so any such screen would either be fake or a bug.
2. **The `mfaToken` is not the same as an access token.** Don't store it in
   the same place as `accessToken`/`refreshToken`, don't send it as an
   `Authorization` header anywhere — it's a one-time-use value passed only
   to `/auth/totp/verify`, and it expires in 5 minutes.
3. **Disabling 2FA or regenerating backup codes always requires the
   current password**, never just "are you logged in." Don't skip this
   dialog even if it feels redundant — it's the same reasoning as the
   existing Change Password flow already requiring the current password.
4. **A wrong TOTP/backup code during login must never reveal which one was
   wrong** (this is symmetric with how login already treats "wrong email"
   and "wrong password" identically) — just show a generic "Invalid code."
5. **An expired `mfaToken`** (user took more than 5 minutes on the code
   screen) should send them back to the login form to start over, with a
   clear message like "That took too long — please log in again."
