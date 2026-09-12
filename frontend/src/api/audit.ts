import { apiClient } from './client'

export interface AuditActor {
  userId: string
  email: string
  role: string
  departmentName: string | null
}

export interface AuditLogEntry {
  auditId: string
  userId: string | null
  action: string
  entityType: string
  entityId: string | null
  // Human-readable label for the entity (a camera's name, a user's email) —
  // null when entityId is unset, entityType isn't one the backend knows how
  // to label, or the referenced row no longer exists.
  entityLabel: string | null
  metadata: {
    correlationId?: string
    ipAddress?: string
    userAgent?: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown>
  } | null
  createdAt: string
  // Backend-joined actor detail (email/role/department) — null when the
  // action has no associated user (e.g. a rejected login never reaches the
  // interceptor at all, since it throws before the route handler returns).
  actor: AuditActor | null
}

export interface AuditLogQuery {
  page?: number
  limit?: number
  fromDate?: string
  toDate?: string
  action?: string
  entityType?: string
  userId?: string
}

export async function listAuditLog(query: AuditLogQuery): Promise<AuditLogEntry[]> {
  const response = await apiClient.get<AuditLogEntry[]>('/audit-log', { params: query })
  return response.data
}
