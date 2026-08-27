import { Module } from '@nestjs/common';
import { AuditContextService } from './audit-context.service';

/**
 * Not @Global() — AuditContextService is REQUEST-scoped, and importing it
 * explicitly (rather than making it global) keeps it obvious which modules
 * actually use it. Any module whose service methods need to record
 * before/after changes for the audit log must import this module.
 */
@Module({
  providers: [AuditContextService],
  exports: [AuditContextService],
})
export class AuditContextModule {}
