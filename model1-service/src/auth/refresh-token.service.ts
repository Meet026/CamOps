import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import ms from 'ms';

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  async issue(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(48).toString('hex');
    const expiry = this.configService.get<string>('refreshToken.expiry') ?? '7d';
    // `expiry` is a runtime string from env config, not known at compile
    // time, so it can't structurally match ms's `StringValue` template-
    // literal type — the cast is safe because ms's actual runtime parser
    // accepts any valid duration string ('7d', '15m', etc.) regardless.
    const expiresAt = new Date(Date.now() + ms(expiry as Parameters<typeof ms>[0]));

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(token),
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  async validate(rawToken: string): Promise<{ userId: string } | null> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });

    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;

    return { userId: row.userId };
  }

  async revoke(rawToken: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });

    if (!row) return;

    await this.prisma.refreshToken.update({
      where: { tokenId: row.tokenId },
      data: { revokedAt: new Date() },
    });
  }

  // Used by AuthService.changePassword to force re-authentication
  // everywhere else once a password changes — a compromised old password
  // can no longer keep a stale session alive via refresh.
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
