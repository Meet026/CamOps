import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RefreshTokenService } from './refresh-token.service';
import { TotpService } from './totp/totp.service';
import { TotpChallengeJwtService } from './totp/totp-challenge-jwt.service';
import { TotpBackupCodeService } from './totp/totp-backup-code.service';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  // Not returned to the client as part of the API response shape used by
  // the frontend — added so AuthController can attribute the audit_log
  // row to the account that just logged in (see AuditLogInterceptor,
  // which otherwise has no request.user to read on this @Public() route).
  userId: string;
}

// Returned by login() in place of LoginResult when the account has 2FA
// enabled — no access/refresh token is issued until verifyTotpLogin
// succeeds. See docs/superpowers/specs/2026-09-12-totp-two-factor-auth-design.md §5.
export interface MfaChallengeResult {
  mfaRequired: true;
  mfaToken: string;
  // Same reasoning as LoginResult.userId — stripped from the client
  // response by the controller, kept only for audit attribution.
  userId: string;
}

export interface RefreshResult {
  accessToken: string;
}

export interface ProfileResult {
  userId: string;
  email: string;
  role: string;
  departmentId: string | null;
}

export interface TotpSetupResult {
  secret: string;
  otpauthUrl: string;
}

export interface TotpConfirmResult {
  backupCodes: string[];
}

export interface TotpStatusResult {
  enabled: boolean;
  enabledAt: Date | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly totpService: TotpService,
    private readonly totpChallengeJwtService: TotpChallengeJwtService,
    private readonly totpBackupCodeService: TotpBackupCodeService,
  ) {}

  private signAccessToken(user: { userId: string; role: string; departmentId: string | null }) {
    return this.jwtService.sign({
      sub: user.userId,
      role: user.role,
      departmentId: user.departmentId,
    });
  }

  private async issueTokensFor(user: {
    userId: string;
    role: string;
    departmentId: string | null;
  }): Promise<LoginResult> {
    const accessToken = this.signAccessToken(user);
    const { token: refreshToken } = await this.refreshTokenService.issue(user.userId);
    return { accessToken, refreshToken, userId: user.userId };
  }

  async login(email: string, password: string): Promise<LoginResult | MfaChallengeResult> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.totpEnabled) {
      // Password is correct, but real tokens don't get issued until the
      // TOTP challenge is also satisfied (see verifyTotpLogin). No change
      // in behavior at all for the majority of users who haven't enabled
      // 2FA — this branch only exists for accounts that opted in.
      return {
        mfaRequired: true,
        mfaToken: this.totpChallengeJwtService.sign(user.userId),
        userId: user.userId,
      };
    }

    return this.issueTokensFor(user);
  }

  // Completes a login that was interrupted by an MFA challenge. `code` may
  // be either a fresh 6-digit TOTP code or one of the user's one-time
  // backup codes — the TOTP code is tried first (the common case), falling
  // back to backup codes only if it doesn't match, since consuming a
  // backup code is a one-way, finite action that shouldn't happen on a
  // successful primary-code attempt.
  async verifyTotpLogin(mfaToken: string, code: string): Promise<LoginResult> {
    // Throws UnauthorizedException on its own for an invalid/expired/
    // wrong-purpose token — propagates unchanged, no need to re-wrap.
    const { userId } = this.totpChallengeJwtService.verify(mfaToken);

    const user = await this.usersService.findById(userId);
    if (!user || !user.totpEnabled || !user.totpSecret) {
      // Covers both "user deleted" and "2FA was disabled" between the
      // challenge being issued and this call completing it — either way,
      // the challenge is no longer valid.
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }

    const secret = this.totpService.decryptSecret(user.totpSecret);
    const codeMatches = this.totpService.verifyCode(secret, code);

    if (!codeMatches) {
      const backupCodeMatched = await this.totpBackupCodeService.tryConsume(userId, code);
      if (!backupCodeMatched) {
        throw new UnauthorizedException('Invalid code');
      }
    }

    return this.issueTokensFor(user);
  }

  async refresh(rawRefreshToken: string): Promise<RefreshResult> {
    const validated = await this.refreshTokenService.validate(rawRefreshToken);
    if (!validated) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findById(validated.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const accessToken = this.signAccessToken(user);
    return { accessToken };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokenService.revoke(rawRefreshToken);
  }

  async getProfile(userId: string): Promise<ProfileResult> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      userId: user.userId,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.usersService.updatePasswordHash(userId, newHash);

    // Force re-authentication everywhere else — standard practice after a
    // password change, so a compromised old password can't keep a stale
    // session alive. The caller's own current access token remains valid
    // until its normal 15-minute expiry; their next refresh attempt will
    // correctly fail and prompt a fresh login with the new password.
    await this.refreshTokenService.revokeAllForUser(userId);
  }

  // Starts (or restarts) 2FA enrollment — generates a new secret, stores
  // it encrypted, but does NOT enable enforcement yet (see confirmTotp).
  // Callable repeatedly before confirming: each call simply overwrites the
  // previous pending secret, so an abandoned attempt (closed tab, never
  // scanned the QR code) never leaves the account in a broken state.
  async setupTotp(userId: string): Promise<TotpSetupResult> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const secret = this.totpService.generateSecret();
    const encrypted = this.totpService.encryptSecret(secret);
    await this.usersService.setPendingTotpSecret(userId, encrypted);

    return { secret, otpauthUrl: this.totpService.buildOtpauthUrl(secret, user.email) };
  }

  // Confirms enrollment: verifies one real code against the pending
  // secret before enabling enforcement, so a user who never actually
  // finished scanning the QR code can't get locked out of their own
  // account on next login.
  async confirmTotp(userId: string, code: string): Promise<TotpConfirmResult> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.totpSecret) {
      throw new UnauthorizedException('No 2FA setup in progress — call setup first');
    }

    const secret = this.totpService.decryptSecret(user.totpSecret);
    if (!this.totpService.verifyCode(secret, code)) {
      throw new UnauthorizedException('Invalid code');
    }

    await this.usersService.enableTotp(userId);
    const backupCodes = await this.totpBackupCodeService.replaceAll(userId);

    return { backupCodes };
  }

  // Requires the CURRENT PASSWORD (not a TOTP code) to disable — otherwise
  // a hijacked, already-authenticated session alone could remove the
  // second factor without ever needing to know it. Mirrors why
  // changePassword already requires re-entering the current password
  // rather than trusting the active session.
  async disableTotp(userId: string, currentPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.usersService.disableTotp(userId);
    await this.totpBackupCodeService.deleteAll(userId);
  }

  // Same password-reconfirmation guard as disableTotp, for the same
  // reason. Necessary because backup codes are single-use and finite —
  // without this, a user who burns through all 10 during genuine
  // phone-loss recoveries has no way back in except an admin.
  async regenerateBackupCodes(userId: string, currentPassword: string): Promise<TotpConfirmResult> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.totpEnabled) {
      throw new UnauthorizedException('2FA is not enabled for this account');
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const backupCodes = await this.totpBackupCodeService.replaceAll(userId);
    return { backupCodes };
  }

  async getTotpStatus(userId: string): Promise<TotpStatusResult> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return { enabled: user.totpEnabled, enabledAt: user.totpEnabledAt };
  }
}
