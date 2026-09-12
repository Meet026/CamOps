import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const PURPOSE = 'totp_challenge';
const EXPIRY = '5m';

interface TotpChallengePayload {
  sub: string;
  purpose: typeof PURPOSE;
}

export interface TotpChallengeResult {
  userId: string;
}

/**
 * Signs and verifies the short-lived `mfaToken` issued by POST /auth/login
 * when a user has 2FA enabled, in place of real access/refresh tokens (see
 * docs/superpowers/specs/2026-09-12-totp-two-factor-auth-design.md §5).
 *
 * Deliberately a separate JwtService instance from the main app's access
 * tokens, signed with the SAME JWT_SECRET (reusing the app's existing key
 * rather than introducing a second one to manage) but a distinct `purpose`
 * claim and a much shorter (5 min) expiry — so this token can never be
 * used as a bearer token against any other protected route (JwtStrategy's
 * payload shape has no `purpose` field, so a totp_challenge token wouldn't
 * even carry a role/departmentId `RolesGuard` could check), and even if it
 * leaked, it is useless for anything except completing this one login.
 */
@Injectable()
export class TotpChallengeJwtService {
  constructor(private readonly jwtService: JwtService) {}

  sign(userId: string): string {
    const payload: TotpChallengePayload = { sub: userId, purpose: PURPOSE };
    return this.jwtService.sign(payload, { expiresIn: EXPIRY });
  }

  // Throws (never returns a "maybe" result) on any invalid token — expired,
  // wrong secret, wrong purpose, or malformed — so callers can treat any
  // thrown error uniformly as "reject this login attempt".
  verify(token: string): TotpChallengeResult {
    let payload: TotpChallengePayload;
    try {
      payload = this.jwtService.verify<TotpChallengePayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA challenge token');
    }

    if (payload.purpose !== PURPOSE) {
      throw new UnauthorizedException('Invalid or expired MFA challenge token');
    }

    return { userId: payload.sub };
  }
}
