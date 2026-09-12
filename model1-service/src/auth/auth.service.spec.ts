import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RefreshTokenService } from './refresh-token.service';
import { TotpService } from './totp/totp.service';
import { TotpChallengeJwtService } from './totp/totp-challenge-jwt.service';
import { TotpBackupCodeService } from './totp/totp-backup-code.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    findById: jest.Mock;
    updatePasswordHash: jest.Mock;
    setPendingTotpSecret: jest.Mock;
    enableTotp: jest.Mock;
    disableTotp: jest.Mock;
  };
  let jwtService: { sign: jest.Mock };
  let refreshTokenService: {
    issue: jest.Mock;
    validate: jest.Mock;
    revoke: jest.Mock;
    revokeAllForUser: jest.Mock;
  };
  let totpService: {
    generateSecret: jest.Mock;
    buildOtpauthUrl: jest.Mock;
    encryptSecret: jest.Mock;
    decryptSecret: jest.Mock;
    verifyCode: jest.Mock;
  };
  let totpChallengeJwtService: { sign: jest.Mock; verify: jest.Mock };
  let totpBackupCodeService: { replaceAll: jest.Mock; tryConsume: jest.Mock; deleteAll: jest.Mock };

  const passwordHash = bcrypt.hashSync('correct-password', 10);
  const fakeUser = {
    userId: 'user-1',
    email: 'admin@sentinel.local',
    passwordHash,
    role: 'admin',
    departmentId: null,
    totpEnabled: false,
    totpSecret: null as string | null,
  };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      updatePasswordHash: jest.fn(),
      setPendingTotpSecret: jest.fn(),
      enableTotp: jest.fn(),
      disableTotp: jest.fn(),
    };
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt-token') };
    refreshTokenService = {
      issue: jest.fn().mockResolvedValue({ token: 'raw-refresh-token', expiresAt: new Date() }),
      validate: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    };
    totpService = {
      generateSecret: jest.fn().mockReturnValue('NEWSECRET'),
      buildOtpauthUrl: jest.fn().mockReturnValue('otpauth://totp/Sentinel:x@y.com?secret=NEWSECRET'),
      encryptSecret: jest.fn().mockImplementation((s: string) => `encrypted(${s})`),
      decryptSecret: jest.fn().mockImplementation((s: string) => s.replace(/^encrypted\((.*)\)$/, '$1')),
      verifyCode: jest.fn(),
    };
    totpChallengeJwtService = {
      sign: jest.fn().mockReturnValue('mfa-challenge-token'),
      verify: jest.fn(),
    };
    totpBackupCodeService = {
      replaceAll: jest.fn().mockResolvedValue(['AAAA-1111', 'BBBB-2222']),
      tryConsume: jest.fn(),
      deleteAll: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: TotpService, useValue: totpService },
        { provide: TotpChallengeJwtService, useValue: totpChallengeJwtService },
        { provide: TotpBackupCodeService, useValue: totpBackupCodeService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login', () => {
    it('returns an access token and refresh token for valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue(fakeUser);

      const result = await service.login('admin@sentinel.local', 'correct-password');

      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.refreshToken).toBe('raw-refresh-token');
      expect(refreshTokenService.issue).toHaveBeenCalledWith('user-1');
    });

    it('includes the userId of the account that logged in, for audit-log attribution', async () => {
      usersService.findByEmail.mockResolvedValue(fakeUser);

      const result = await service.login('admin@sentinel.local', 'correct-password');

      expect(result.userId).toBe('user-1');
    });

    it('throws UnauthorizedException for an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await expect(service.login('nobody@sentinel.local', 'anything')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for a wrong password', async () => {
      usersService.findByEmail.mockResolvedValue(fakeUser);
      await expect(service.login('admin@sentinel.local', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('never reveals whether the failure was a bad email or bad password', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      try {
        await service.login('nobody@sentinel.local', 'anything');
        fail('expected to throw');
      } catch (e) {
        expect((e as UnauthorizedException).message).toBe('Invalid credentials');
      }

      usersService.findByEmail.mockResolvedValue(fakeUser);
      try {
        await service.login('admin@sentinel.local', 'wrong-password');
        fail('expected to throw');
      } catch (e) {
        expect((e as UnauthorizedException).message).toBe('Invalid credentials');
      }
    });

    it('when 2FA is enabled, returns an MFA challenge instead of real tokens', async () => {
      usersService.findByEmail.mockResolvedValue({ ...fakeUser, totpEnabled: true });

      const result = await service.login('admin@sentinel.local', 'correct-password');

      expect(result).toEqual({ mfaRequired: true, mfaToken: 'mfa-challenge-token', userId: 'user-1' });
      expect(totpChallengeJwtService.sign).toHaveBeenCalledWith('user-1');
      expect(refreshTokenService.issue).not.toHaveBeenCalled();
    });
  });

  describe('verifyTotpLogin', () => {
    it('issues real tokens when the TOTP code is correct', async () => {
      totpChallengeJwtService.verify.mockReturnValue({ userId: 'user-1' });
      usersService.findById.mockResolvedValue({
        ...fakeUser,
        totpEnabled: true,
        totpSecret: 'encrypted(REALSECRET)',
      });
      totpService.verifyCode.mockReturnValue(true);

      const result = await service.verifyTotpLogin('mfa-challenge-token', '123456');

      expect(totpService.decryptSecret).toHaveBeenCalledWith('encrypted(REALSECRET)');
      expect(totpService.verifyCode).toHaveBeenCalledWith('REALSECRET', '123456');
      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.refreshToken).toBe('raw-refresh-token');
      expect(refreshTokenService.issue).toHaveBeenCalledWith('user-1');
    });

    it('falls back to a backup code when the TOTP code does not match, and consumes it', async () => {
      totpChallengeJwtService.verify.mockReturnValue({ userId: 'user-1' });
      usersService.findById.mockResolvedValue({
        ...fakeUser,
        totpEnabled: true,
        totpSecret: 'encrypted(REALSECRET)',
      });
      totpService.verifyCode.mockReturnValue(false);
      totpBackupCodeService.tryConsume.mockResolvedValue(true);

      const result = await service.verifyTotpLogin('mfa-challenge-token', 'AAAA-1111');

      expect(totpBackupCodeService.tryConsume).toHaveBeenCalledWith('user-1', 'AAAA-1111');
      expect(result.accessToken).toBe('signed-jwt-token');
    });

    it('throws when neither the TOTP code nor any backup code matches', async () => {
      totpChallengeJwtService.verify.mockReturnValue({ userId: 'user-1' });
      usersService.findById.mockResolvedValue({
        ...fakeUser,
        totpEnabled: true,
        totpSecret: 'encrypted(REALSECRET)',
      });
      totpService.verifyCode.mockReturnValue(false);
      totpBackupCodeService.tryConsume.mockResolvedValue(false);

      await expect(service.verifyTotpLogin('mfa-challenge-token', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokenService.issue).not.toHaveBeenCalled();
    });

    it('throws when the mfaToken itself is invalid or expired (propagates from TotpChallengeJwtService)', async () => {
      totpChallengeJwtService.verify.mockImplementation(() => {
        throw new UnauthorizedException('Invalid or expired MFA challenge token');
      });

      await expect(service.verifyTotpLogin('bad-token', '123456')).rejects.toThrow(UnauthorizedException);
    });

    it('throws if 2FA was disabled between issuing the challenge and verifying it', async () => {
      totpChallengeJwtService.verify.mockReturnValue({ userId: 'user-1' });
      usersService.findById.mockResolvedValue({ ...fakeUser, totpEnabled: false, totpSecret: null });

      await expect(service.verifyTotpLogin('mfa-challenge-token', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokenService.issue).not.toHaveBeenCalled();
    });
  });

  describe('setupTotp', () => {
    it('generates a new secret, stores it encrypted as pending, and returns the secret plus an otpauth URL', async () => {
      usersService.findById.mockResolvedValue(fakeUser);

      const result = await service.setupTotp('user-1');

      expect(totpService.encryptSecret).toHaveBeenCalledWith('NEWSECRET');
      expect(usersService.setPendingTotpSecret).toHaveBeenCalledWith('user-1', 'encrypted(NEWSECRET)');
      expect(result).toEqual({
        secret: 'NEWSECRET',
        otpauthUrl: 'otpauth://totp/Sentinel:x@y.com?secret=NEWSECRET',
      });
    });

    it('throws UnauthorizedException when the user no longer exists', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(service.setupTotp('missing-user')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('confirmTotp', () => {
    it('verifies the code against the pending secret, enables 2FA, and returns backup codes', async () => {
      usersService.findById.mockResolvedValue({ ...fakeUser, totpSecret: 'encrypted(PENDINGSECRET)' });
      totpService.verifyCode.mockReturnValue(true);

      const result = await service.confirmTotp('user-1', '654321');

      expect(totpService.decryptSecret).toHaveBeenCalledWith('encrypted(PENDINGSECRET)');
      expect(totpService.verifyCode).toHaveBeenCalledWith('PENDINGSECRET', '654321');
      expect(usersService.enableTotp).toHaveBeenCalledWith('user-1');
      expect(totpBackupCodeService.replaceAll).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ backupCodes: ['AAAA-1111', 'BBBB-2222'] });
    });

    it('throws and does not enable 2FA when the code is wrong', async () => {
      usersService.findById.mockResolvedValue({ ...fakeUser, totpSecret: 'encrypted(PENDINGSECRET)' });
      totpService.verifyCode.mockReturnValue(false);

      await expect(service.confirmTotp('user-1', '000000')).rejects.toThrow(UnauthorizedException);
      expect(usersService.enableTotp).not.toHaveBeenCalled();
    });

    it('throws when no setup was ever started (no pending secret)', async () => {
      usersService.findById.mockResolvedValue({ ...fakeUser, totpSecret: null });

      await expect(service.confirmTotp('user-1', '123456')).rejects.toThrow(UnauthorizedException);
      expect(totpService.verifyCode).not.toHaveBeenCalled();
    });
  });

  describe('disableTotp', () => {
    it('re-verifies the password, then clears the secret and deletes backup codes', async () => {
      usersService.findById.mockResolvedValue({ ...fakeUser, totpEnabled: true });

      await service.disableTotp('user-1', 'correct-password');

      expect(usersService.disableTotp).toHaveBeenCalledWith('user-1');
      expect(totpBackupCodeService.deleteAll).toHaveBeenCalledWith('user-1');
    });

    it('throws and disables nothing when the password is wrong', async () => {
      usersService.findById.mockResolvedValue({ ...fakeUser, totpEnabled: true });

      await expect(service.disableTotp('user-1', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(usersService.disableTotp).not.toHaveBeenCalled();
      expect(totpBackupCodeService.deleteAll).not.toHaveBeenCalled();
    });
  });

  describe('regenerateBackupCodes', () => {
    it('re-verifies the password, then replaces all backup codes', async () => {
      usersService.findById.mockResolvedValue({ ...fakeUser, totpEnabled: true });

      const result = await service.regenerateBackupCodes('user-1', 'correct-password');

      expect(totpBackupCodeService.replaceAll).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ backupCodes: ['AAAA-1111', 'BBBB-2222'] });
    });

    it('throws when the password is wrong', async () => {
      usersService.findById.mockResolvedValue({ ...fakeUser, totpEnabled: true });

      await expect(service.regenerateBackupCodes('user-1', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when 2FA is not even enabled', async () => {
      usersService.findById.mockResolvedValue({ ...fakeUser, totpEnabled: false });

      await expect(service.regenerateBackupCodes('user-1', 'correct-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getTotpStatus', () => {
    it('returns enabled/enabledAt for the user', async () => {
      const enabledAt = new Date('2026-09-01T00:00:00Z');
      usersService.findById.mockResolvedValue({ ...fakeUser, totpEnabled: true, totpEnabledAt: enabledAt });

      const result = await service.getTotpStatus('user-1');

      expect(result).toEqual({ enabled: true, enabledAt });
    });
  });

  describe('refresh', () => {
    it('returns a new access token for a valid refresh token', async () => {
      refreshTokenService.validate.mockResolvedValue({ userId: 'user-1' });
      usersService.findById.mockResolvedValue(fakeUser);

      const result = await service.refresh('valid-raw-refresh-token');

      expect(result.accessToken).toBe('signed-jwt-token');
    });

    it('throws UnauthorizedException for an invalid/expired/revoked refresh token', async () => {
      refreshTokenService.validate.mockResolvedValue(null);
      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if the user behind a valid token no longer exists', async () => {
      refreshTokenService.validate.mockResolvedValue({ userId: 'deleted-user' });
      usersService.findById.mockResolvedValue(null);
      await expect(service.refresh('valid-token-orphaned-user')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revokes the given refresh token', async () => {
      await service.logout('some-raw-refresh-token');
      expect(refreshTokenService.revoke).toHaveBeenCalledWith('some-raw-refresh-token');
    });
  });

  describe('getProfile', () => {
    it('returns userId, email, role, departmentId for the given user', async () => {
      usersService.findById.mockResolvedValue(fakeUser);

      const result = await service.getProfile('user-1');

      expect(result).toEqual({
        userId: 'user-1',
        email: 'admin@sentinel.local',
        role: 'admin',
        departmentId: null,
      });
    });

    it('throws UnauthorizedException when the user no longer exists', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(service.getProfile('missing-user')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('updates the password hash and revokes all refresh tokens when the current password is correct', async () => {
      usersService.findById.mockResolvedValue(fakeUser);

      await service.changePassword('user-1', 'correct-password', 'new-password-123');

      expect(usersService.updatePasswordHash).toHaveBeenCalledWith('user-1', expect.any(String));
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });

    it('throws UnauthorizedException when currentPassword does not match', async () => {
      usersService.findById.mockResolvedValue(fakeUser);

      await expect(service.changePassword('user-1', 'wrong-password', 'new-password-123')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(usersService.updatePasswordHash).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
