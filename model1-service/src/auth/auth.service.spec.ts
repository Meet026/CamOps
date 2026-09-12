import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RefreshTokenService } from './refresh-token.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock; findById: jest.Mock; updatePasswordHash: jest.Mock };
  let jwtService: { sign: jest.Mock };
  let refreshTokenService: {
    issue: jest.Mock;
    validate: jest.Mock;
    revoke: jest.Mock;
    revokeAllForUser: jest.Mock;
  };

  const passwordHash = bcrypt.hashSync('correct-password', 10);
  const fakeUser = {
    userId: 'user-1',
    email: 'admin@sentinel.local',
    passwordHash,
    role: 'admin',
    departmentId: null,
  };

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), findById: jest.fn(), updatePasswordHash: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt-token') };
    refreshTokenService = {
      issue: jest.fn().mockResolvedValue({ token: 'raw-refresh-token', expiresAt: new Date() }),
      validate: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
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
