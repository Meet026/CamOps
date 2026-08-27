import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_KEY, AuditMetadata } from '../decorators/audit.decorator';
import { AuditContextService } from '../context/audit-context.service';
import { writeAuditLogEntry } from '../audit/write-audit-log-entry';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly auditContext: AuditContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditMeta = this.reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const correlationId: string | undefined = request.correlationId;
    const userId: string | null = request.user?.userId ?? null;

    return next.handle().pipe(
      tap(() => {
        // If the service method that just ran called
        // AuditContextService.setChanges(before, after), include those
        // values in the audit row. Routes that never call it (e.g. login,
        // which doesn't edit an existing field) get metadata with just a
        // correlationId, same as before this feature existed.
        const changes = this.auditContext.getChanges(request);
        // Prisma's Json field type (InputJsonValue) can't statically verify
        // an arbitrary Record<string, unknown> is JSON-safe — the cast is
        // safe here because `before`/`after` are always plain, serializable
        // field-value objects (e.g. { role: 'admin' }), never functions,
        // classes, or circular references.
        const metadata: Prisma.InputJsonValue = changes
          ? { correlationId, before: changes.before, after: changes.after }
          : { correlationId };

        writeAuditLogEntry(this.prisma, userId, auditMeta.action, auditMeta.entityType, metadata);
      }),
    );
  }
}
