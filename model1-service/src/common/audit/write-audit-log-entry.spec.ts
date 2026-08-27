import { writeAuditLogEntry } from './write-audit-log-entry';
import { PrismaService } from '../../prisma/prisma.service';

describe('writeAuditLogEntry', () => {
  let prisma: { auditLog: { create: jest.Mock } };

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
  });

  it('calls prisma.auditLog.create with the given userId, action, entityType, and metadata', () => {
    writeAuditLogEntry(
      prisma as unknown as PrismaService,
      'user-1',
      'create_camera',
      'camera',
      { correlationId: 'corr-1' },
    );

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'create_camera',
        entityType: 'camera',
        metadata: { correlationId: 'corr-1' },
      },
    });
  });

  it('accepts a null userId', () => {
    writeAuditLogEntry(prisma as unknown as PrismaService, null, 'login', 'app_user', {});

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: { userId: null, action: 'login', entityType: 'app_user', metadata: {} },
    });
  });

  it('does not throw and does not block the caller when the write itself rejects', () => {
    prisma.auditLog.create.mockRejectedValue(new Error('db write failed'));

    expect(() =>
      writeAuditLogEntry(prisma as unknown as PrismaService, 'user-1', 'create_camera', 'camera', {}),
    ).not.toThrow();
  });
});
