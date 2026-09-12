import { encryptTotpSecret, decryptTotpSecret } from './totp-encryption';

describe('totp-encryption', () => {
  // A real 32-byte key, base64-encoded — same shape TOTP_ENCRYPTION_KEY
  // validates against in env.validation.ts.
  const key = Buffer.alloc(32, 7).toString('base64');

  it('decrypts back to the original plaintext secret', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP'; // a real-shaped base32 TOTP secret
    const encrypted = encryptTotpSecret(plaintext, key);
    const decrypted = decryptTotpSecret(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each time for the same plaintext (random IV)', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const first = encryptTotpSecret(plaintext, key);
    const second = encryptTotpSecret(plaintext, key);
    expect(first).not.toBe(second);
  });

  it('throws when decrypting with the wrong key', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptTotpSecret(plaintext, key);
    const wrongKey = Buffer.alloc(32, 9).toString('base64');
    expect(() => decryptTotpSecret(encrypted, wrongKey)).toThrow();
  });

  it('throws when the ciphertext has been tampered with', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptTotpSecret(plaintext, key);
    // Flip a character in the middle of the base64 payload — GCM's
    // authentication tag must reject this rather than silently decrypt
    // garbage.
    const tampered = encrypted.slice(0, 10) + (encrypted[10] === 'A' ? 'B' : 'A') + encrypted.slice(11);
    expect(() => decryptTotpSecret(tampered, key)).toThrow();
  });
});
