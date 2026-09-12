import { authenticator } from 'otplib';
import { TotpService } from './totp.service';

describe('TotpService', () => {
  let service: TotpService;
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');

  beforeEach(() => {
    service = new TotpService(encryptionKey);
  });

  describe('generateSecret / buildOtpauthUrl', () => {
    it('generates a base32 secret and an otpauth:// URL containing it', () => {
      const secret = service.generateSecret();
      expect(secret).toMatch(/^[A-Z2-7]+$/); // base32 alphabet

      const url = service.buildOtpauthUrl(secret, 'officer@sentinel.local');
      expect(url).toMatch(/^otpauth:\/\/totp\//);
      expect(url).toContain(encodeURIComponent('officer@sentinel.local'));
      expect(url).toContain(`secret=${secret}`);
    });
  });

  describe('encryptSecret / decryptSecret', () => {
    it('round-trips a secret through encryption', () => {
      const secret = service.generateSecret();
      const encrypted = service.encryptSecret(secret);
      expect(service.decryptSecret(encrypted)).toBe(secret);
    });
  });

  describe('verifyCode', () => {
    it('accepts a code freshly generated for the same secret', () => {
      const secret = service.generateSecret();
      const code = authenticator.generate(secret);

      expect(service.verifyCode(secret, code)).toBe(true);
    });

    it('rejects a code that does not match the secret', () => {
      const secret = service.generateSecret();
      const otherSecret = authenticator.generateSecret();
      const wrongCode = authenticator.generate(otherSecret);

      expect(service.verifyCode(secret, wrongCode)).toBe(false);
    });

    it('rejects a garbage/malformed code without throwing', () => {
      const secret = service.generateSecret();
      expect(() => service.verifyCode(secret, 'not-a-code')).not.toThrow();
      expect(service.verifyCode(secret, 'not-a-code')).toBe(false);
    });
  });

  describe('generateBackupCodes', () => {
    it('generates 10 unique, human-readable codes', () => {
      const codes = service.generateBackupCodes();
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      for (const code of codes) {
        expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      }
    });
  });

  describe('hashBackupCode / verifyBackupCode', () => {
    it('verifies a code against its own hash', async () => {
      const code = service.generateBackupCodes()[0];
      const hash = await service.hashBackupCode(code);
      await expect(service.verifyBackupCode(code, hash)).resolves.toBe(true);
    });

    it('rejects a code that does not match the hash', async () => {
      const [codeA, codeB] = service.generateBackupCodes();
      const hash = await service.hashBackupCode(codeA);
      await expect(service.verifyBackupCode(codeB, hash)).resolves.toBe(false);
    });

    it('is case-insensitive (a user retyping a code in lowercase still matches)', async () => {
      const code = service.generateBackupCodes()[0];
      const hash = await service.hashBackupCode(code);
      await expect(service.verifyBackupCode(code.toLowerCase(), hash)).resolves.toBe(true);
    });
  });
});
