import { Injectable } from '@nestjs/common';
import { Request } from 'express';

// Deliberately narrower than Record<string, unknown> — before/after values
// must be plain JSON-serializable field values (they end up stored in
// audit_log.metadata, a Postgres JSONB column), never functions, class
// instances, or anything else that can't round-trip through JSON.
export type AuditFieldValues = Record<string, string | number | boolean | null>;

export interface AuditChanges {
  // null is valid for `before` specifically — a create action has nothing
  // that existed beforehand (see CameraRegistryService.createCamera).
  before: AuditFieldValues | null;
  after: AuditFieldValues;
  entityId?: string;
}

declare module 'express' {
  interface Request {
    auditChanges?: AuditChanges;
  }
}

/**
 * Lets a service method record the before/after values of a change it just
 * made, so the AuditLogInterceptor can pick them up later in the same
 * request and store them on the audit_log row.
 *
 * A normal singleton (NOT request-scoped) that stores its data directly on
 * the request object — the same pattern already used for `correlationId`
 * and `user`. This was deliberately NOT built with NestJS's Scope.REQUEST
 * feature: doing so would have forced AuditLogInterceptor (registered
 * globally as APP_INTERCEPTOR) to also become request-scoped, which broke
 * its other dependency (Reflector) during real requests — confirmed via a
 * failing e2e test. Storing on the request object avoids that entirely and
 * is also cheaper (no per-request provider re-instantiation).
 */
@Injectable()
export class AuditContextService {
  setChanges(
    request: Request,
    before: AuditFieldValues | null,
    after: AuditFieldValues,
    entityId?: string,
  ): void {
    request.auditChanges = entityId ? { before, after, entityId } : { before, after };
  }

  getChanges(request: Request): AuditChanges | undefined {
    return request.auditChanges;
  }
}
