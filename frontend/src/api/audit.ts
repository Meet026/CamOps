import { apiClient } from './client'

export interface AuditLogEntry {
  auditId: string
  userId: string | null
  action: string
  entityType: string
  entityId: string | null
  metadata: { correlationId?: string; before?: Record<string, unknown>; after?: Record<string, unknown> } | null
  createdAt: string
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
