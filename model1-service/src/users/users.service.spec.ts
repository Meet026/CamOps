import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: { appUser: { findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock } };
  let auditContext: { setChanges: jest.Mock };

  beforeEach(async () => {
    prisma = { appUser: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() } };
    auditContext = { setChanges: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditContextService, useValue: auditContext },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('findByEmail returns the user when found', async () => {
    const fakeUser = { userId: '1', email: 'admin@sentinel.local', role: 'admin' };
    prisma.appUser.findUnique.mockResolvedValue(fakeUser);

    const result = await service.findByEmail('admin@sentinel.local');

    expect(result).toEqual(fakeUser);
    expect(prisma.appUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@sentinel.local' },
    });
  });

  it('findByEmail returns null when not found', async () => {
    prisma.appUser.findUnique.mockResolvedValue(null);
    const result = await service.findByEmail('nobody@sentinel.local');
    expect(result).toBeNull();
  });

  it('findById returns the user when found', async () => {
    const fakeUser = { userId: 'user-1', email: 'x@y.com', role: 'field_officer' };
    prisma.appUser.findUnique.mockResolvedValue(fakeUser);

    const result = await service.findById('user-1');

    expect(result).toEqual(fakeUser);
    expect(prisma.appUser.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('findById returns null when not found', async () => {
    prisma.appUser.findUnique.mockResolvedValue(null);
    const result = await service.findById('nonexistent');
    expect(result).toBeNull();
  });

  describe('updateRole', () => {
    const fakeRequest = {} as any;

    it('reads the old role, updates it, and records the before/after change', async () => {
      const existingUser = { userId: 'user-1', email: 'x@y.com', role: 'field_officer' };
      const updatedUser = { userId: 'user-1', email: 'x@y.com', role: 'admin' };
      prisma.appUser.findUnique.mockResolvedValue(existingUser);
      prisma.appUser.update.mockResolvedValue(updatedUser);

      const result = await service.updateRole(fakeRequest, 'user-1', 'admin');

      expect(result).toEqual(updatedUser);
      expect(prisma.appUser.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { role: 'admin' },
      });
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        { role: 'field_officer' },
        { role: 'admin' },
        'user-1',
      );
    });

    it('throws NotFoundException when the user does not exist, without writing anything', async () => {
      prisma.appUser.findUnique.mockResolvedValue(null);

      await expect(service.updateRole(fakeRequest, 'nonexistent', 'admin')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.appUser.update).not.toHaveBeenCalled();
      expect(auditContext.setChanges).not.toHaveBeenCalled();
    });

    it('does not call setChanges when the new role is the same as the old one (no-op update)', async () => {
      const existingUser = { userId: 'user-1', email: 'x@y.com', role: 'admin' };
      prisma.appUser.findUnique.mockResolvedValue(existingUser);
      prisma.appUser.update.mockResolvedValue(existingUser);

      await service.updateRole(fakeRequest, 'user-1', 'admin');

      expect(auditContext.setChanges).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns paginated users with only userId, email, role, departmentId — never passwordHash', async () => {
      prisma.appUser.findMany.mockResolvedValue([
        { userId: 'user-1', email: 'admin@sentinel.local', role: 'admin', departmentId: null },
      ]);

      const result = await service.list({ page: 1, limit: 25 });

      expect(prisma.appUser.findMany).toHaveBeenCalledWith({
        select: { userId: true, email: true, role: true, departmentId: true },
        orderBy: { email: 'asc' },
        skip: 0,
        take: 25,
      });
      expect(result).toEqual([
        { userId: 'user-1', email: 'admin@sentinel.local', role: 'admin', departmentId: null },
      ]);
    });

    it('computes skip correctly for a later page', async () => {
      prisma.appUser.findMany.mockResolvedValue([]);

      await service.list({ page: 3, limit: 10 });

      expect(prisma.appUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('updatePasswordHash', () => {
    it('writes the given hash to the user row', async () => {
      prisma.appUser.update.mockResolvedValue({});

      await service.updatePasswordHash('user-1', 'new-hashed-value');

      expect(prisma.appUser.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { passwordHash: 'new-hashed-value' },
      });
    });
  });

  describe('setPendingTotpSecret', () => {
    it('writes the encrypted secret without enabling enforcement', async () => {
      prisma.appUser.update.mockResolvedValue({});

      await service.setPendingTotpSecret('user-1', 'encrypted-secret-value');

      expect(prisma.appUser.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { totpSecret: 'encrypted-secret-value' },
      });
    });
  });

  describe('enableTotp', () => {
    it('sets totpEnabled true and stamps totpEnabledAt', async () => {
      prisma.appUser.update.mockResolvedValue({});

      await service.enableTotp('user-1');

      expect(prisma.appUser.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { totpEnabled: true, totpEnabledAt: expect.any(Date) },
      });
    });
  });

  describe('disableTotp', () => {
    it('clears the secret, enabled flag, and enabledAt timestamp', async () => {
      prisma.appUser.update.mockResolvedValue({});

      await service.disableTotp('user-1');

      expect(prisma.appUser.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { totpSecret: null, totpEnabled: false, totpEnabledAt: null },
      });
    });
  });
});
