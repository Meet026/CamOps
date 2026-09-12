# TOTP Two-Factor Authentication — Design

**Status:** Approved by explicit user instruction ("don't ask me if anything
figures out on your side") — every open design decision below was resolved
directly rather than raised as a question, and is documented with its
reasoning so it can be revisited later if needed.

**Goal:** let a user optionally enable TOTP-based two-factor authentication
(the standard used by Google Authenticator, Authy, 1Password, etc. — no SMS,
no third-party service, fully self-contained). Once enabled, login requires
the usual password *and* a 6-digit time-based code from their authenticator
app. Users can enable it, get challenged for it at login, and disable it.

---

## 1. What TOTP is, in one paragraph

A shared secret is generated once and given to the user (as a QR code they
scan with an authenticator app). From then on, both the app and the server
independently compute the same 6-digit code by combining that secret with
the current 30-second time window, using a standard, publicly specified
algorithm (RFC 6238). Nothing is transmitted over SMS or through a
third-party provider — the server only ever needs to verify a code someone
already generated on their own phone.

---

## 2. Database changes

One new migration, purely additive — no existing column changes.

### `AppUser` gains three columns

| Column | Type | Purpose |
|---|---|---|
| `totpSecret` | `String?` (`totp_secret`) | The shared secret, **encrypted at rest** (see §3) — `null` until enrollment starts |
| `totpEnabled` | `Boolean` (`totp_enabled`), default `false` | Whether 2FA is actually active and enforced at login |
| `totpEnabledAt` | `DateTime?` (`totp_enabled_at`) | When it was confirmed enabled — for support/audit visibility, not enforced logic |

**Why one secret column serves both "pending" and "enabled" states:** during
enrollment (§4), the secret is written but `totpEnabled` stays `false` — so
scanning a QR code and not confirming it never accidentally turns on
enforcement. This avoids needing a separate "pending_secret" column.

### New table: `totp_backup_code`

```
model TotpBackupCode {
  backupCodeId String    @id @default(dbgenerated("gen_random_uuid()")) @map("backup_code_id") @db.Uuid
  userId       String    @map("user_id") @db.Uuid
  codeHash     String    @map("code_hash")   // bcrypt, exactly like a password
  usedAt       DateTime? @map("used_at")     // null = still valid, single-use
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz

  user AppUser @relation(fields: [userId], references: [userId], onDelete: Cascade)

  @@index([userId])
  @@map("totp_backup_code")
}
```

**Why a separate table, not a JSON array column:** each code needs its own
independent "used" state and its own hash — a relational table is the
natural fit, and it mirrors the existing `refresh_token` table's pattern
(one row per credential-like artifact, hashed, revocable/consumable).

**Why bcrypt for backup codes, not the same AES encryption as the TOTP
secret:** backup codes are *consumed once and never needed again* — exactly
like a password — so they should be hashed one-way, never recovered. The
TOTP secret must be *reused indefinitely* to verify future codes, so it
needs reversible encryption instead. Different guarantees, different
mechanism — this is deliberate, not inconsistent.

---

## 3. Encrypting the TOTP secret at rest

Unlike a password or backup code, the server must get the *original*
secret back to compute an expected TOTP code — so it can't be one-way
hashed. It will be encrypted with **AES-256-GCM** (an authenticated
encryption mode — tampering with the stored value is detected, not just
silently decrypted wrong) using a new required environment variable:

```
TOTP_ENCRYPTION_KEY=<32 bytes, base64-encoded>
```

- Generated once per environment (documented in `.env.example` with a
  comment showing how to generate one, e.g. `openssl rand -base64 32`).
- Validated at boot via the existing `env.validation.ts` pattern (fails
  fast if missing/wrong length, exactly like `JWT_SECRET` already does) —
  no code path should ever run with a missing encryption key.
- Decrypted only in-memory at the moment of TOTP verification, never
  logged, and never included in any API response after the initial setup
  step (§4).

**Why not reuse `JWT_SECRET` or `REFRESH_TOKEN_SECRET` for this:** those are
signing keys (HMAC), not encryption keys, and mixing their purpose would
weaken both if either were ever rotated independently — a dedicated key for
a dedicated purpose, consistent with how this project already keeps
`JWT_SECRET` and `REFRESH_TOKEN_SECRET` as two separate values rather than
one shared secret doing double duty.

---

## 4. Enrollment flow (turning 2FA on)

**`POST /auth/totp/setup`** (authenticated, any role)
1. Generate a new random TOTP secret.
2. Encrypt it, save it to `totpSecret` — `totpEnabled` stays `false`.
3. Return:
   - `secret`: the raw base32 secret, for manual entry as a fallback.
   - `otpauthUrl`: a standard `otpauth://totp/Sentinel:<email>?secret=...&issuer=Sentinel` URI — the frontend renders this as a QR code (a widely available client-side library does this; no server-side QR image generation needed).
4. Calling this again before confirming simply overwrites the pending
   secret — no state to clean up, no error case to handle.

**`POST /auth/totp/confirm`** (authenticated, body: `{ code: string }`)
1. Decrypt the pending secret, verify the submitted 6-digit code against it
   (with the standard ±1 time-step tolerance for clock drift).
2. On success: set `totpEnabled = true`, `totpEnabledAt = now()`, generate
   **10 backup codes** (cryptographically random, human-readable format like
   `XXXX-XXXX`), hash and store each in `totp_backup_code`, and return the
   **plaintext codes to the user exactly once** — never retrievable again
   after this response.
3. On failure: 400, "Invalid code" — `totpEnabled` stays `false`, nothing
   is destroyed, the user can just try again or re-call `/setup`.
4. Audited as `enable_totp` / `app_user`.

**Why confirmation is a separate step from setup, not combined:** if
`/setup` alone flipped `totpEnabled` to `true`, a user who never actually
finished scanning the QR code (network hiccup, closed the tab) would be
locked out of their own account on next login with no way in. Requiring one
successful code confirms the phone and server are actually in sync before
enforcement begins.

---

## 5. Login flow (the core restructuring)

Today, `POST /auth/login` checks the password and immediately returns
`{ accessToken, refreshToken }`. This changes to a two-step challenge when
2FA is on, while staying a **single, unchanged step when it's off** — no
behavior change at all for the majority of users who haven't enabled it.

**`POST /auth/login`** (unchanged request shape: `{ email, password }`)
- Password wrong → unchanged: `401 Invalid credentials`.
- Password correct, `totpEnabled = false` → **unchanged**: returns
  `{ accessToken, refreshToken }` exactly as today.
- Password correct, `totpEnabled = true` → **new**: returns
  `{ mfaRequired: true, mfaToken: <short-lived JWT> }` instead of real
  tokens. No access/refresh token is issued yet.

**The `mfaToken`** is a separate, narrowly-scoped signed JWT (5-minute
expiry) whose only claim is `{ sub: userId, purpose: 'totp_challenge' }` —
it cannot be used as a bearer token against any other protected route (a
dedicated guard checks the `purpose` claim), so even if it leaked, it's
useless for anything except completing this one login attempt.

**`POST /auth/totp/verify`** (public route, body: `{ mfaToken, code }` —
`code` may be either a 6-digit TOTP code or a backup code)
1. Validate `mfaToken` (signature + expiry + `purpose` claim).
2. Try the 6-digit code first; if that fails, try matching against unused
   backup codes (bcrypt-compare against each unused hash — there are at
   most 10, so this is cheap).
3. On success: if a backup code was used, mark that one row's `usedAt`
   (single-use, consistent with its purpose as an emergency fallback, not a
   reusable password). Issue the real `{ accessToken, refreshToken }`
   exactly as a normal login would.
4. On failure: `401 Invalid code`. Reuses the same `/auth/login` rate limit
   tier (5/min/IP) so this can't be brute-forced any more than password
   login already can't be.
5. Audited as `login` / `app_user` (same action name as a normal login —
   this *is* completing a login, just in two steps; the audit trail already
   distinguishes normal logins from this by whichever endpoint's
   correlation ID/metadata is attached).

**Why a short-lived intermediate token instead of, say, a server-side
session flag:** keeps the server fully stateless between the two calls
(no new "pending login" table, no cleanup job for abandoned attempts) — the
JWT itself carries everything needed to complete the flow, expires on its
own, and requires no extra database writes for the common case.

---

## 6. Disabling 2FA

**`POST /auth/totp/disable`** (authenticated, body: `{ currentPassword: string }`)
1. Re-verify the current password (not the TOTP code) before disabling.
2. On success: clear `totpSecret` to `null`, `totpEnabled = false`,
   `totpEnabledAt = null`, and delete all rows in `totp_backup_code` for
   that user.
3. Audited as `disable_totp` / `app_user`.

**Why require the password again, not the TOTP code:** the whole point of
2FA is that a stolen *session* (an active browser with valid tokens) isn't
enough on its own to compromise the account — if disabling 2FA only needed
an already-authenticated request, an attacker who hijacked a live session
could remove the second factor without ever needing to know it. Re-checking
the password (something only the real owner should know, independent of
whether their browser session is compromised) closes that gap. This mirrors
why `change-password` already forces re-entry of the current password
rather than trusting the active session alone.

---

## 7. Other endpoints

**`GET /auth/totp/status`** (authenticated) — returns `{ enabled: boolean, enabledAt: string | null }`. Lets the frontend show the right Settings UI (an "Enable" button vs. a "Disable" button + status) without guessing from the JWT, which never carries this flag (kept out of the JWT deliberately, since 2FA status can change mid-session and the JWT is not re-issued until the next natural refresh).

**`POST /auth/totp/backup-codes/regenerate`** (authenticated, body: `{ currentPassword: string }`) — invalidates all existing backup codes and issues 10 fresh ones (shown once), same password-reconfirmation guard as disabling. Necessary because backup codes are single-use and finite — without this, a user who burns through all 10 during genuine phone-loss recoveries would have no way back in except contacting an admin.

---

## 8. What does NOT change

- Normal login (`POST /auth/login`) for a user without 2FA enabled: **zero
  behavior change**, same request/response shape as today.
- `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`,
  `POST /auth/change-password`: unchanged. (Though: enabling/disabling 2FA
  does not itself force other sessions to log out — only a password change
  does that, per existing behavior. This is a deliberate scope boundary,
  not an oversight — see §10.)
- No changes to the `refresh_token` table or its revocation model.
- No changes to RBAC/`RolesGuard` — 2FA is orthogonal to role-based access,
  applies identically regardless of role.

---

## 9. New Prisma models — full definitions

```prisma
model TotpBackupCode {
  backupCodeId String    @id @default(dbgenerated("gen_random_uuid()")) @map("backup_code_id") @db.Uuid
  userId       String    @map("user_id") @db.Uuid
  codeHash     String    @map("code_hash")
  usedAt       DateTime? @map("used_at")
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz

  user AppUser @relation(fields: [userId], references: [userId], onDelete: Cascade)

  @@index([userId])
  @@map("totp_backup_code")
}
```

`AppUser` gains:
```prisma
totpSecret    String?   @map("totp_secret")
totpEnabled   Boolean   @default(false) @map("totp_enabled")
totpEnabledAt DateTime? @map("totp_enabled_at") @db.Timestamptz

totpBackupCodes TotpBackupCode[]
```

---

## 10. Explicit scope decisions (resolved directly, not raised as questions)

- **No "remember this device for 30 days" cookie.** Simpler, more secure
  default — can be added later as a genuinely separate feature if wanted.
- **No recovery-via-email path if both the phone and all 10 backup codes
  are lost.** Consistent with this project's existing, deliberate choice
  (see `change-password`'s design) to route account recovery through an
  admin rather than building an email-based flow — the same reasoning
  applies here.
- **2FA is opt-in per user, not mandatory per role.** No requirement in the
  current ask that, say, all `admin` accounts must have it — every account
  decides independently. (Easy to add a role-level requirement later if
  wanted; out of scope now since it wasn't asked for.)
- **Enabling/disabling 2FA does not force-logout other active sessions**
  (unlike a password change, which already does). Reasoning: a password
  change invalidates something an attacker might have stolen (the
  password); turning 2FA on or off doesn't invalidate anything a
  currently-valid session already possesses — the active session remains
  exactly as trustworthy as it was a moment before. Revisit only if a
  concrete concern is raised.
- **TOTP window tolerance is ±1 step (±30s)** — the standard, widely used
  default balancing clock drift tolerance against security (a wider window
  weakens the "time-based" guarantee).
- **Backup codes are shown once, in the API response only** — no email
  delivery, no re-download later. If lost, `regenerate` (§7) is the only
  path back, requiring the password.
