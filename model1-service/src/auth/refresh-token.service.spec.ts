import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenService } from './refresh-token.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('7d') },
        },
      ],
    }).compile();

    service = module.get(RefreshTokenService);
  });

  describe('issue', () => {
    it('creates a refresh_token row and returns a raw token plus expiry', async () => {
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.issue('user-1');

      expect(result.token).toEqual(expect.any(String));
      expect(result.token.length).toBeGreaterThan(20);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('never stores the raw token as the tokenHash', async () => {
      prisma.refreshToken.create.mockResolvedValue({});
      const result = await service.issue('user-1');
      const createCallArg = prisma.refreshToken.create.mock.calls[0][0];
      expect(createCallArg.data.tokenHash).not.toBe(result.token);
    });
  });

  describe('validate', () => {
    it('returns the userId for a valid, non-expired, non-revoked token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: null,
      });

      const result = await service.validate('some-raw-token');

      expect(result).toEqual({ userId: 'user-1' });
    });

    it('returns null when the token is not found', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      const result = await service.validate('unknown-token');
      expect(result).toBeNull();
    });

    it('returns null when the token is expired', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      });
      const result = await service.validate('expired-token');
      expect(result).toBeNull();
    });

    it('returns null when the token has been revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: new Date(),
      });
      const result = await service.validate('revoked-token');
      expect(result).toBeNull();
    });
  });

  describe('revoke', () => {
    it('sets revokedAt on the matching token row', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ tokenId: 'token-row-1' });
      prisma.refreshToken.update.mockResolvedValue({});

      await service.revoke('raw-token-to-revoke');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { tokenId: 'token-row-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('does nothing (no throw) when the token does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.revoke('nonexistent-token')).resolves.not.toThrow();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllForUser', () => {
    it('marks every non-revoked refresh token for the user as revoked', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await service.revokeAllForUser('user-1');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
