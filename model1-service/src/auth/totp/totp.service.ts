import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { encryptTotpSecret, decryptTotpSecret } from './totp-encryption';

const ISSUER = 'Sentinel';
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids visual ambiguity when a user reads a code off a screen or printout

// ±1 time-step (30s) tolerance for clock drift between the server and the
// user's phone — the standard, widely used default. A wider window would
// weaken the "time-based" guarantee; narrower risks rejecting legitimate
// codes over ordinary clock drift.
authenticator.options = { window: 1 };

@Injectable()
export class TotpService {
  constructor(private readonly encryptionKey: string) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  buildOtpauthUrl(secret: string, email: string): string {
    return authenticator.keyuri(email, ISSUER, secret);
  }

  encryptSecret(plaintext: string): string {
    return encryptTotpSecret(plaintext, this.encryptionKey);
  }

  decryptSecret(encrypted: string): string {
    return decryptTotpSecret(encrypted, this.encryptionKey);
  }

  // Never throws on a malformed/garbage code — an invalid 6-digit guess is
  // an expected, routine input here, not an exceptional one.
  verifyCode(secret: string, code: string): boolean {
    try {
      return authenticator.verify({ token: code, secret });
    } catch {
      return false;
    }
  }

  generateBackupCodes(): string[] {
    const codes = new Set<string>();
    while (codes.size < BACKUP_CODE_COUNT) {
      codes.add(`${randomAlphabetString(4)}-${randomAlphabetString(4)}`);
    }
    return Array.from(codes);
  }

  async hashBackupCode(code: string): Promise<string> {
    return bcrypt.hash(normalizeBackupCode(code), 10);
  }

  async verifyBackupCode(code: string, hash: string): Promise<boolean> {
    return bcrypt.compare(normalizeBackupCode(code), hash);
  }
}

function normalizeBackupCode(code: string): string {
  return code.toUpperCase();
}

function randomAlphabetString(length: number): string {
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BACKUP_CODE_ALPHABET[bytes[i] % BACKUP_CODE_ALPHABET.length];
  }
  return result;
}
