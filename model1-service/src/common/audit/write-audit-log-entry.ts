import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const logger = new Logger('AuditLog');

// Fire-and-forget: writes one audit_log row. Never throws, never blocks the
// caller — a broken audit log must never fail the underlying operation,
// whether that's an HTTP request (via AuditLogInterceptor) or a background
// bulk-upload row (called directly, no request/interceptor involved).
export function writeAuditLogEntry(
  prisma: PrismaService,
  userId: string | null,
  action: string,
  entityType: string,
  metadata: Prisma.InputJsonValue,
): void {
  prisma.auditLog
    .create({
      data: { userId, action, entityType, metadata },
    })
    .catch((error: Error) => {
      logger.error(`Failed to write audit log for action "${action}": ${error.message}`);
    });
}
