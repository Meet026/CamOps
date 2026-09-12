import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface AuditLogQuery {
  page: number;
  limit: number;
  fromDate?: string;
  toDate?: string;
  action?: string;
  entityType?: string;
  userId?: string;
}

export interface AuditActor {
  userId: string;
  email: string;
  role: string;
  departmentName: string | null;
}

export interface AuditLogEntry {
  auditId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  // Human-readable label for the entity this row refers to (a camera's
  // name, a user's email) — null when entityId is unset, entityType isn't
  // one we know how to label, or the referenced row no longer exists (e.g.
  // hard-deleted). Resolved via a batched lookup, not a per-row join,
  // since entityType varies row to row and points at different tables.
  entityLabel: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  actor: AuditActor | null;
}

// Raw shape as returned by findMany with the user/department include below —
// not the generated Prisma payload type, to keep this file's surface small
// and stable regardless of exactly which scalar fields get selected.
interface RawAuditLogRow {
  auditId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  user: {
    userId: string;
    email: string;
    role: string;
    department: { name: string } | null;
  } | null;
}

function shapeRow(row: RawAuditLogRow, entityLabel: string | null): AuditLogEntry {
  return {
    auditId: row.auditId,
    userId: row.userId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel,
    metadata: row.metadata,
    createdAt: row.createdAt,
    actor: row.user
      ? {
          userId: row.user.userId,
          email: row.user.email,
          role: row.user.role,
          departmentName: row.user.department?.name ?? null,
        }
      : null,
  };
}

// Read path only — the write path (common/audit/write-audit-log-entry.ts,
// AuditLogInterceptor) is untouched and stays exactly as it is.
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogQuery): Promise<AuditLogEntry[]> {
    const where: Prisma.AuditLogWhereInput = {};
    // Case-insensitive substring search, not exact match — real action
    // values are compound (create_camera, update_role, ...), so an exact
    // filter meant typing the whole thing correctly; "camera" now matches
    // every *_camera action, same convention as CameraRegistryService's
    // name/address_text search.
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.entityType) where.entityType = { contains: query.entityType, mode: 'insensitive' };
    if (query.userId) where.userId = query.userId;
    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
        ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
      };
    }

    // Joins the actor's email/role and their department's name in the same
    // query — replaces the frontend's earlier approach of fetching a
    // separate (admin-only, capped) user list and matching client-side,
    // which broke down for large user counts and for the auditor role.
    // Explicit `select` (never a bare `include`) so app_user.password_hash
    // never travels over this endpoint, even indirectly.
    const rows = (await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
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
    })) as unknown as RawAuditLogRow[];

    const entityLabels = await this.resolveEntityLabels(rows);

    return rows.map((row) => shapeRow(row, entityLabels.get(row.entityId ?? '') ?? null));
  }

  // One batched lookup per known entity type across the whole page, not one
  // query per row — a page can mix camera and app_user rows freely, and
  // each needs its own table/label column, so entityIds are grouped by
  // entityType first.
  private async resolveEntityLabels(rows: RawAuditLogRow[]): Promise<Map<string, string>> {
    const cameraIds = new Set<string>();
    const userIds = new Set<string>();
    for (const row of rows) {
      if (!row.entityId) continue;
      if (row.entityType === 'camera') cameraIds.add(row.entityId);
      if (row.entityType === 'app_user') userIds.add(row.entityId);
    }

    const labels = new Map<string, string>();
    if (cameraIds.size > 0) {
      const cameras = await this.prisma.camera.findMany({
        where: { cameraId: { in: Array.from(cameraIds) } },
        select: { cameraId: true, name: true },
      });
      for (const camera of cameras) labels.set(camera.cameraId, camera.name);
    }
    if (userIds.size > 0) {
      const users = await this.prisma.appUser.findMany({
        where: { userId: { in: Array.from(userIds) } },
        select: { userId: true, email: true },
      });
      for (const user of users) labels.set(user.userId, user.email);
    }

    return labels;
  }
}
