import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: {
    auditLog: { findMany: jest.Mock };
    camera: { findMany: jest.Mock };
    appUser: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      auditLog: { findMany: jest.fn() },
      camera: { findMany: jest.fn().mockResolvedValue([]) },
      appUser: { findMany: jest.fn().mockResolvedValue([]) },
    };

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
      include: {
        user: {
          select: {
            userId: true,
            email: true,
            role: true,
            department: { select: { name: true } },
          },
        },
      },
    });
  });

  it('applies action and entityType as case-insensitive substring search, plus userId and date-range filters', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);

    await service.list({
      page: 1,
      limit: 25,
      action: 'camera',
      entityType: 'cam',
      userId: 'user-1',
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        action: { contains: 'camera', mode: 'insensitive' },
        entityType: { contains: 'cam', mode: 'insensitive' },
        userId: 'user-1',
        createdAt: { gte: new Date('2026-08-01'), lte: new Date('2026-08-31') },
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 25,
      include: {
        user: {
          select: {
            userId: true,
            email: true,
            role: true,
            department: { select: { name: true } },
          },
        },
      },
    });
  });

  it('shapes each row with an actor object built from the joined user and department', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        auditId: 'audit-1',
        userId: 'user-1',
        action: 'update_camera',
        entityType: 'camera',
        entityId: 'cam-1',
        metadata: { correlationId: 'corr-1' },
        createdAt: new Date('2026-09-01T00:00:00Z'),
        user: {
          userId: 'user-1',
          email: 'officer@sentinel.local',
          role: 'field_officer',
          department: { name: 'Home Department' },
        },
      },
    ]);
    prisma.camera.findMany.mockResolvedValue([{ cameraId: 'cam-1', name: 'Main Gate Camera' }]);

    const result = await service.list({ page: 1, limit: 25 });

    expect(result[0]).toEqual({
      auditId: 'audit-1',
      userId: 'user-1',
      action: 'update_camera',
      entityType: 'camera',
      entityId: 'cam-1',
      entityLabel: 'Main Gate Camera',
      metadata: { correlationId: 'corr-1' },
      createdAt: new Date('2026-09-01T00:00:00Z'),
      actor: {
        userId: 'user-1',
        email: 'officer@sentinel.local',
        role: 'field_officer',
        departmentName: 'Home Department',
      },
    });
  });

  it('shapes actor as null for a system/unauthenticated action with no user (e.g. a failed-before-auth attempt)', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        auditId: 'audit-2',
        userId: null,
        action: 'login',
        entityType: 'app_user',
        entityId: null,
        metadata: {},
        createdAt: new Date('2026-09-01T00:00:00Z'),
        user: null,
      },
    ]);

    const result = await service.list({ page: 1, limit: 25 });

    expect(result[0].actor).toBeNull();
  });

  it('shapes actor.departmentName as null when the user has no department (e.g. admin/auditor)', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        auditId: 'audit-3',
        userId: 'user-2',
        action: 'login',
        entityType: 'app_user',
        entityId: 'user-2',
        metadata: {},
        createdAt: new Date('2026-09-01T00:00:00Z'),
        user: {
          userId: 'user-2',
          email: 'admin@sentinel.local',
          role: 'admin',
          department: null,
        },
      },
    ]);
    prisma.appUser.findMany.mockResolvedValue([{ userId: 'user-2', email: 'admin@sentinel.local' }]);

    const result = await service.list({ page: 1, limit: 25 });

    expect(result[0].actor).toEqual({
      userId: 'user-2',
      email: 'admin@sentinel.local',
      role: 'admin',
      departmentName: null,
    });
  });

  describe('entityLabel resolution', () => {
    it('resolves entityLabel to the camera name for a camera-entity row', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          auditId: 'audit-4',
          userId: 'user-1',
          action: 'delete_camera',
          entityType: 'camera',
          entityId: 'cam-99',
          metadata: {},
          createdAt: new Date('2026-09-01T00:00:00Z'),
          user: null,
        },
      ]);
      prisma.camera.findMany.mockResolvedValue([{ cameraId: 'cam-99', name: 'Back Gate Camera' }]);

      const result = await service.list({ page: 1, limit: 25 });

      expect(prisma.camera.findMany).toHaveBeenCalledWith({
        where: { cameraId: { in: ['cam-99'] } },
        select: { cameraId: true, name: true },
      });
      expect(result[0].entityLabel).toBe('Back Gate Camera');
    });

    it('resolves entityLabel to the user email for an app_user-entity row', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          auditId: 'audit-5',
          userId: 'user-1',
          action: 'update_role',
          entityType: 'app_user',
          entityId: 'user-2',
          metadata: {},
          createdAt: new Date('2026-09-01T00:00:00Z'),
          user: null,
        },
      ]);
      prisma.appUser.findMany.mockResolvedValue([
        { userId: 'user-2', email: 'target-user@sentinel.local' },
      ]);

      const result = await service.list({ page: 1, limit: 25 });

      expect(prisma.appUser.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['user-2'] } },
        select: { userId: true, email: true },
      });
      expect(result[0].entityLabel).toBe('target-user@sentinel.local');
    });

    it('resolves entityLabel to null when entityId is null', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          auditId: 'audit-6',
          userId: null,
          action: 'login',
          entityType: 'app_user',
          entityId: null,
          metadata: {},
          createdAt: new Date('2026-09-01T00:00:00Z'),
          user: null,
        },
      ]);

      const result = await service.list({ page: 1, limit: 25 });

      expect(result[0].entityLabel).toBeNull();
    });

    it('resolves entityLabel to null for an entity type it does not know how to label (e.g. scoring_verification)', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          auditId: 'audit-7',
          userId: 'user-1',
          action: 'verify_scoring',
          entityType: 'scoring_verification',
          entityId: 'ver-1',
          metadata: {},
          createdAt: new Date('2026-09-01T00:00:00Z'),
          user: null,
        },
      ]);

      const result = await service.list({ page: 1, limit: 25 });

      expect(result[0].entityLabel).toBeNull();
    });

    it('resolves entityLabel to null when the referenced camera/user no longer exists', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          auditId: 'audit-8',
          userId: 'user-1',
          action: 'delete_camera',
          entityType: 'camera',
          entityId: 'cam-deleted',
          metadata: {},
          createdAt: new Date('2026-09-01T00:00:00Z'),
          user: null,
        },
      ]);
      prisma.camera.findMany.mockResolvedValue([]); // hard-deleted or never existed

      const result = await service.list({ page: 1, limit: 25 });

      expect(result[0].entityLabel).toBeNull();
    });

    it('batches all camera and user entityIds across a page into a single lookup each, not one query per row', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          auditId: 'audit-9',
          userId: 'user-1',
          action: 'update_camera',
          entityType: 'camera',
          entityId: 'cam-1',
          metadata: {},
          createdAt: new Date('2026-09-01T00:00:00Z'),
          user: null,
        },
        {
          auditId: 'audit-10',
          userId: 'user-1',
          action: 'delete_camera',
          entityType: 'camera',
          entityId: 'cam-2',
          metadata: {},
          createdAt: new Date('2026-09-01T00:00:00Z'),
          user: null,
        },
        {
          auditId: 'audit-11',
          userId: 'user-1',
          action: 'update_role',
          entityType: 'app_user',
          entityId: 'user-9',
          metadata: {},
          createdAt: new Date('2026-09-01T00:00:00Z'),
          user: null,
        },
      ]);
      prisma.camera.findMany.mockResolvedValue([
        { cameraId: 'cam-1', name: 'Camera One' },
        { cameraId: 'cam-2', name: 'Camera Two' },
      ]);
      prisma.appUser.findMany.mockResolvedValue([{ userId: 'user-9', email: 'nine@sentinel.local' }]);

      const result = await service.list({ page: 1, limit: 25 });

      expect(prisma.camera.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.appUser.findMany).toHaveBeenCalledTimes(1);
      expect(result[0].entityLabel).toBe('Camera One');
      expect(result[1].entityLabel).toBe('Camera Two');
      expect(result[2].entityLabel).toBe('nine@sentinel.local');
    });
  });
});
