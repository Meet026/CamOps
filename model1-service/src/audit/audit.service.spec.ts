import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: { auditLog: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { auditLog: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AuditService);
  });

  it('returns paginated audit log rows with no filters applied when none given', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);

    await service.list({ page: 1, limit: 25 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 25,
    });
  });

  it('applies action, entityType, userId, and date-range filters when provided', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);

    await service.list({
      page: 1,
      limit: 25,
      action: 'create_camera',
      entityType: 'camera',
      userId: 'user-1',
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        action: 'create_camera',
        entityType: 'camera',
        userId: 'user-1',
        createdAt: { gte: new Date('2026-08-01'), lte: new Date('2026-08-31') },
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 25,
    });
  });
});
