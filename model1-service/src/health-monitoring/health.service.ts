import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CameraRegistryService } from '../camera-registry/camera-registry.service';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';
import { attemptTcpPortCheck } from './jobs/tcp-port-check';

interface AtRiskRow {
  cameraId: string;
  name: string;
  departmentId: string;
  currentStatus: string;
  offlineCount: bigint;
}

@Injectable()
export class HealthMonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cameraRegistryService: CameraRegistryService,
    private readonly config: ConfigService,
  ) {}

  async getHistory(
    cameraId: string,
    query: { page: number; limit: number },
    currentUser: AuthenticatedUser,
  ) {
    // Reuses the existing 404-not-403 dept_viewer scoping check — no new
    // scoping logic invented for this feature.
    await this.cameraRegistryService.getCameraById(cameraId, currentUser);

    const rows = await this.prisma.cameraStatusHistory.findMany({
      where: { cameraId },
      orderBy: { checkedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    // id is a Prisma BigInt (matches the DB's BIGSERIAL column) — Express's
    // default JSON serializer cannot stringify BigInt values and throws a
    // 500 at the response layer. History row counts never approach
    // Number.MAX_SAFE_INTEGER in practice, so converting to a plain number
    // here is safe and keeps the response body serializable.
    return rows.map((row) => ({ ...row, id: Number(row.id) }));
  }

  async getCurrent(cameraId: string, currentUser: AuthenticatedUser) {
    await this.cameraRegistryService.getCameraById(cameraId, currentUser);

    return this.prisma.camera.findUnique({
      where: { cameraId },
      select: { currentStatus: true, ipAddress: true, rtspPort: true },
    });
  }

  // Unscoped by design — this endpoint is admin/field_officer only and
  // never reached by dept_viewer (see spec's "PRD Corrections" section).
  async getAtRisk() {
    const threshold = this.config.get<number>('health.atRiskOfflineThreshold') ?? 3;
    const windowDays = this.config.get<number>('health.atRiskWindowDays') ?? 14;

    const rows = await this.prisma.$queryRaw<AtRiskRow[]>(Prisma.sql`
      SELECT
        c.camera_id AS "cameraId",
        c.name AS "name",
        c.department_id AS "departmentId",
        c.current_status AS "currentStatus",
        count(h.id) AS "offlineCount"
      FROM camera_status_history h
      JOIN camera c ON c.camera_id = h.camera_id
      WHERE h.status = 'offline'
        AND h.checked_at >= now() - (${windowDays} || ' days')::interval
      GROUP BY c.camera_id, c.name, c.department_id, c.current_status
      HAVING count(h.id) >= ${threshold}
      ORDER BY count(h.id) DESC
    `);

    return rows.map((row) => ({ ...row, offlineCount: Number(row.offlineCount) }));
  }

  async checkNow(
    cameraId: string,
    manualStatus: 'online' | 'offline' | undefined,
    currentUser: AuthenticatedUser,
  ): Promise<{ status: string; checkedAt: Date; responseTimeMs: number | null }> {
    // The caller here is always admin/field_officer per the controller's
    // @Roles guard, never dept_viewer — this is an existence check, not an
    // access restriction, but reused for consistency with getHistory/getCurrent.
    await this.cameraRegistryService.getCameraById(cameraId, currentUser);

    const camera = await this.prisma.camera.findUnique({
      where: { cameraId },
      select: { cameraType: true, ipAddress: true, rtspPort: true },
    });

    let status: 'online' | 'offline';
    let responseTimeMs: number | null;

    if (camera?.cameraType === 'ip' && camera.ipAddress) {
      // A real TCP check is authoritative when one is possible — any
      // manually-supplied status is silently ignored, not a validation error.
      const timeoutMs = this.config.get<number>('health.tcpTimeoutMs') ?? 2500;
      const port = camera.rtspPort ?? 554;
      const result = await attemptTcpPortCheck(camera.ipAddress, port, timeoutMs);
      status = result.online ? 'online' : 'offline';
      responseTimeMs = result.responseTimeMs;
    } else {
      // Analog camera, or an IP camera with no ip_address yet — this is
      // the analog-camera manual-update mechanism the PRD required but
      // never named an endpoint for (see spec's "PRD Corrections").
      if (!manualStatus) {
        throw new BadRequestException(
          `Camera ${cameraId} cannot be automatically checked (no ip_address configured) — a status must be provided manually`,
        );
      }
      status = manualStatus;
      responseTimeMs = null;
    }

    const checkedAt = new Date();
    await this.prisma.cameraStatusHistory.create({
      data: { cameraId, status, responseTimeMs },
    });
    await this.prisma.camera.update({
      where: { cameraId },
      data: { currentStatus: status },
    });

    return { status, checkedAt, responseTimeMs };
  }
}
