import { Test, TestingModule } from '@nestjs/testing';
import { TotpBackupCodeService } from './totp-backup-code.service';
import { TotpService } from './totp.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('TotpBackupCodeService', () => {
  let service: TotpBackupCodeService;
  let prisma: {
    totpBackupCode: { deleteMany: jest.Mock; createMany: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  };
  let totpService: { generateBackupCodes: jest.Mock; hashBackupCode: jest.Mock; verifyBackupCode: jest.Mock };

  beforeEach(async () => {
    prisma = {
      totpBackupCode: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    totpService = {
      generateBackupCodes: jest.fn(),
      hashBackupCode: jest.fn(),
      verifyBackupCode: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TotpBackupCodeService,
        { provide: PrismaService, useValue: prisma },
        { provide: TotpService, useValue: totpService },
      ],
    }).compile();

    service = module.get(TotpBackupCodeService);
  });

  describe('replaceAll', () => {
    it('deletes existing codes, generates and hashes 10 new ones, and returns the plaintext codes', async () => {
      totpService.generateBackupCodes.mockReturnValue(['AAAA-1111', 'BBBB-2222']);
      totpService.hashBackupCode.mockImplementation(async (code: string) => `hash(${code})`);

      const result = await service.replaceAll('user-1');

      expect(prisma.totpBackupCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(prisma.totpBackupCode.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'user-1', codeHash: 'hash(AAAA-1111)' },
          { userId: 'user-1', codeHash: 'hash(BBBB-2222)' },
        ],
      });
      expect(result).toEqual(['AAAA-1111', 'BBBB-2222']);
    });
  });

  describe('tryConsume', () => {
    it('marks the matching unused code as used and returns true', async () => {
      prisma.totpBackupCode.findMany.mockResolvedValue([
        { backupCodeId: 'code-1', codeHash: 'hash-1' },
        { backupCodeId: 'code-2', codeHash: 'hash-2' },
      ]);
      totpService.verifyBackupCode.mockImplementation(
        async (_code: string, hash: string) => hash === 'hash-2',
      );

      const result = await service.tryConsume('user-1', 'BBBB-2222');

      expect(result).toBe(true);
      expect(prisma.totpBackupCode.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', usedAt: null },
      });
      expect(prisma.totpBackupCode.update).toHaveBeenCalledWith({
        where: { backupCodeId: 'code-2' },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('returns false and marks nothing when no unused code matches', async () => {
      prisma.totpBackupCode.findMany.mockResolvedValue([{ backupCodeId: 'code-1', codeHash: 'hash-1' }]);
      totpService.verifyBackupCode.mockResolvedValue(false);

      const result = await service.tryConsume('user-1', 'wrong-code');

      expect(result).toBe(false);
      expect(prisma.totpBackupCode.update).not.toHaveBeenCalled();
    });

    it('returns false without erroring when the user has no backup codes at all', async () => {
      prisma.totpBackupCode.findMany.mockResolvedValue([]);

      const result = await service.tryConsume('user-1', 'ANY-CODE');

      expect(result).toBe(false);
    });
  });

  describe('deleteAll', () => {
    it('removes every backup code for the user', async () => {
      await service.deleteAll('user-1');
      expect(prisma.totpBackupCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });
  });
});
