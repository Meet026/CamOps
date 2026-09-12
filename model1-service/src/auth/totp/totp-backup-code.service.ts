import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TotpService } from './totp.service';

@Injectable()
export class TotpBackupCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totpService: TotpService,
  ) {}

  // Used at both confirm-2FA (§4) and regenerate-backup-codes (§7) — wipes
  // any existing codes and issues 10 fresh ones. Returns the plaintext
  // codes so the caller can hand them to the user exactly once; nothing
  // after this call ever has access to them again, only their hashes.
  async replaceAll(userId: string): Promise<string[]> {
    await this.prisma.totpBackupCode.deleteMany({ where: { userId } });

    const codes = this.totpService.generateBackupCodes();
    const hashed = await Promise.all(
      codes.map(async (code) => ({ userId, codeHash: await this.totpService.hashBackupCode(code) })),
    );
    await this.prisma.totpBackupCode.createMany({ data: hashed });

    return codes;
  }

  // Tries the given code against every unused backup code for this user
  // (at most 10, so this is cheap even without an index on the hash — bcrypt
  // hashes are salted and can't be looked up by equality anyway). On a
  // match, marks that one row used (single-use, like the credential it's
  // standing in for) and returns true.
  async tryConsume(userId: string, code: string): Promise<boolean> {
    const unused = await this.prisma.totpBackupCode.findMany({ where: { userId, usedAt: null } });

    for (const row of unused) {
      if (await this.totpService.verifyBackupCode(code, row.codeHash)) {
        await this.prisma.totpBackupCode.update({
          where: { backupCodeId: row.backupCodeId },
          data: { usedAt: new Date() },
        });
        return true;
      }
    }

    return false;
  }

  // Used by AuthService.disableTotp — backup codes are meaningless once
  // 2FA itself is off.
  async deleteAll(userId: string): Promise<void> {
    await this.prisma.totpBackupCode.deleteMany({ where: { userId } });
  }
}
