import { writeAuditLogEntry } from './write-audit-log-entry';
import { PrismaService } from '../../prisma/prisma.service';

describe('writeAuditLogEntry', () => {
  let prisma: { auditLog: { create: jest.Mock } };

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
  });

  it('calls prisma.auditLog.create with the given userId, action, entityType, entityId, and metadata', () => {
    writeAuditLogEntry(
      prisma as unknown as PrismaService,
      'user-1',
      'create_camera',
      'camera',
      'camera-123',
      { correlationId: 'corr-1' },
    );

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'create_camera',
        entityType: 'camera',
        entityId: 'camera-123',
        metadata: { correlationId: 'corr-1' },
      },
    });
  });

  it('accepts a null userId and a null entityId', () => {
    writeAuditLogEntry(prisma as unknown as PrismaService, null, 'login', 'app_user', null, {});

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: { userId: null, action: 'login', entityType: 'app_user', entityId: null, metadata: {} },
    });
  });

  it('does not throw and does not block the caller when the write itself rejects', () => {
    prisma.auditLog.create.mockRejectedValue(new Error('db write failed'));

    expect(() =>
      writeAuditLogEntry(prisma as unknown as PrismaService, 'user-1', 'create_camera', 'camera', null, {}),
    ).not.toThrow();
  });
});
