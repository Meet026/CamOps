import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM: an authenticated encryption mode — tampering with the stored
// ciphertext is detected (decrypt throws) rather than silently producing
// wrong plaintext. Unlike passwordHash/backup-code hashes (one-way, never
// recovered), a TOTP secret must be recoverable so the server can compute
// the expected 6-digit code on every verification — so it's encrypted, not
// hashed. See docs/superpowers/specs/2026-09-12-totp-two-factor-auth-design.md §3.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96-bit IV, the standard/recommended size for GCM
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * Encrypts a TOTP secret for storage. `key` is the base64-encoded 32-byte
 * TOTP_ENCRYPTION_KEY. Returns a single base64 string packing
 * [iv][authTag][ciphertext] together, so the DB column stores one opaque
 * value rather than three separate ones.
 */
export function encryptTotpSecret(plaintext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, 'base64');
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Decrypts a value produced by encryptTotpSecret. Throws if the key is
 * wrong or the ciphertext was tampered with (GCM's authentication check
 * fails) — callers must not treat a thrown error as "invalid code", only
 * as a genuine configuration/integrity problem.
 */
export function decryptTotpSecret(encrypted: string, base64Key: string): string {
  const key = Buffer.from(base64Key, 'base64');
  const raw = Buffer.from(encrypted, 'base64');

  const iv = raw.subarray(0, IV_LENGTH_BYTES);
  const authTag = raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = raw.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
