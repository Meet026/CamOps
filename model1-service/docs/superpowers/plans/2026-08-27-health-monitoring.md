# Health Monitoring (FR-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build FR-4 (Health Monitoring): a scheduled TCP-reachability cron for IP cameras, a dual-mode manual check-now trigger (real check for IP, manual report for analog/unaddressed cameras), status history, current-status, and at-risk endpoints.

**Architecture:** New `health-monitoring/` module (NOT `health/` — that directory and its `HealthModule`/`HealthController` class names are already taken by the existing `/livez` liveness-probe module; confirmed by inspection before writing this plan, so this module is named `HealthMonitoringModule`/`HealthMonitoringController`/`HealthMonitoringService` throughout, no naming collision). Cron scheduling via `@nestjs/schedule`'s `SchedulerRegistry` (dynamic interval from config, not a hardcoded decorator), with an in-memory overlap guard and the same batch-processing shape already used by the bulk-upload background job. TCP reachability via a plain `net.Socket` helper — no external networking library. Reuses `CameraRegistryService.getCameraById` for dept_viewer-scoped single-camera reads; reads camera health-target columns (`ipAddress`, `rtspPort`, `currentStatus`) directly via `prisma.camera.findUnique`/`.update`, matching the precedent already set in `ScoringService`.

**Tech Stack:** NestJS, `@nestjs/schedule` (newly installed), Prisma (plain client calls — no PostGIS/raw-SQL needed for this feature), Node's built-in `net` module, class-validator DTOs, Jest + Supertest.

**Spec:** `docs/superpowers/specs/2026-08-27-health-monitoring-design.md`

## Global Constraints

- TCP check target: `camera.ipAddress`, port = `camera.rtspPort ?? 554`.
- Eligible cameras for the cron: `camera_type = 'ip' AND ip_address IS NOT NULL AND is_active = true`.
- `camera_status_history.status` DB constraint: `'online' | 'offline'` only — never `'unknown'` (confirmed via live constraint check). `camera.current_status` constraint: `'online' | 'offline' | 'unknown'`.
- Cron writes (history row + `current_status` update) get **no** audit_log entry — system-internal telemetry, not a user action. `check-now` **does** get an audit_log entry (`@Audit('manual_health_check', 'camera')`) — it's a deliberate user action.
- New env vars (all optional, sensible defaults, added to `.env`/`.env.example`/`env.validation.ts`/`configuration.ts`):
  - `HEALTH_CHECK_CRON_INTERVAL_MINUTES` (default `5`)
  - `HEALTH_AT_RISK_OFFLINE_THRESHOLD` (default `3`)
  - `HEALTH_AT_RISK_WINDOW_DAYS` (default `14`)
  - `HEALTH_CHECK_TCP_TIMEOUT_MS` (default `2500`)
  - `HEALTH_CHECK_BATCH_SIZE` (default `20`)
- `GET /health/at-risk` is admin/field_officer only — no dept_viewer or auditor access, per the PRD's explicit, repeated dept_viewer confinement rule (see spec's "PRD Corrections" section — this was deliberately confirmed against a proposed change and rejected).
- `GET /health/:cameraId/history` and `/current` are scoped for dept_viewer via the existing `CameraRegistryService.getCameraById` 404-not-403 pattern — no new scoping logic invented.
- `POST /health/:cameraId/check-now` is admin/field_officer only (never dept_viewer), so its own camera lookup is an existence check only, not an access restriction.

---

## Task 1: Install and Wire Up `@nestjs/schedule`

**Files:**
- Modify: `package.json` (via `npm install`, already done — `@nestjs/schedule` present)
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `ScheduleModule` registered globally, making `SchedulerRegistry` injectable anywhere.

- [ ] **Step 1: Confirm `@nestjs/schedule` is installed**

```bash
cd model1-service
node -e "require.resolve('@nestjs/schedule')" && echo "present"
```

Expected: `present`. (Already installed during brainstorming — this step is a checkpoint, not a fresh install.)

- [ ] **Step 2: Register `ScheduleModule` in `app.module.ts`**

Modify `src/app.module.ts` — add the import:

```typescript
import { ScheduleModule } from '@nestjs/schedule';
```

Add `ScheduleModule.forRoot()` to the `imports` array, near the top alongside `ConfigModule.forRoot(...)`:

```typescript
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
```

- [ ] **Step 3: Run the full unit suite to confirm nothing broke**

Run: `npm test`
Expected: all existing suites still pass (this step adds no new tests — `ScheduleModule.forRoot()` has no behavior of its own until a job is registered).

- [ ] **Step 4: Stop — do not commit**

---

## Task 2: Config — New Env Vars

**Files:**
- Modify: `src/config/env.validation.ts`
- Modify: `src/config/configuration.ts`
- Modify: `.env.example`
- Modify: `.env`

**Interfaces:**
- Produces: `configService.get('health.cronIntervalMinutes')`, `.get('health.atRiskOfflineThreshold')`, `.get('health.atRiskWindowDays')`, `.get('health.tcpTimeoutMs')`, `.get('health.batchSize')`.

- [ ] **Step 1: Add the five env vars to `env.validation.ts`**

Modify `src/config/env.validation.ts` — add after the `CLOUDINARY_API_SECRET` field:

```typescript
  @IsNumber()
  @IsOptional()
  HEALTH_CHECK_CRON_INTERVAL_MINUTES: number = 5;

  @IsNumber()
  @IsOptional()
  HEALTH_AT_RISK_OFFLINE_THRESHOLD: number = 3;

  @IsNumber()
  @IsOptional()
  HEALTH_AT_RISK_WINDOW_DAYS: number = 14;

  @IsNumber()
  @IsOptional()
  HEALTH_CHECK_TCP_TIMEOUT_MS: number = 2500;

  @IsNumber()
  @IsOptional()
  HEALTH_CHECK_BATCH_SIZE: number = 20;
```

- [ ] **Step 2: Add the corresponding block to `configuration.ts`**

Modify `src/config/configuration.ts` — add after the `cloudinary` block:

```typescript
  health: {
    cronIntervalMinutes: parseInt(process.env.HEALTH_CHECK_CRON_INTERVAL_MINUTES ?? '5', 10),
    atRiskOfflineThreshold: parseInt(process.env.HEALTH_AT_RISK_OFFLINE_THRESHOLD ?? '3', 10),
    atRiskWindowDays: parseInt(process.env.HEALTH_AT_RISK_WINDOW_DAYS ?? '14', 10),
    tcpTimeoutMs: parseInt(process.env.HEALTH_CHECK_TCP_TIMEOUT_MS ?? '2500', 10),
    batchSize: parseInt(process.env.HEALTH_CHECK_BATCH_SIZE ?? '20', 10),
  },
```

- [ ] **Step 3: Add the five vars to `.env.example` and `.env`**

Append to both `.env.example` and `.env`, after the `CORS_ALLOWED_ORIGINS` line:

```
HEALTH_CHECK_CRON_INTERVAL_MINUTES=5
HEALTH_AT_RISK_OFFLINE_THRESHOLD=3
HEALTH_AT_RISK_WINDOW_DAYS=14
HEALTH_CHECK_TCP_TIMEOUT_MS=2500
HEALTH_CHECK_BATCH_SIZE=20
```

- [ ] **Step 4: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 5: Stop — do not commit**

---

## Task 3: `attemptTcpPortCheck` — TCP Reachability Helper

**Files:**
- Create: `src/health-monitoring/jobs/tcp-port-check.ts`
- Create: `src/health-monitoring/jobs/tcp-port-check.spec.ts`

**Interfaces:**
- Produces: `attemptTcpPortCheck(host: string, port: number, timeoutMs: number): Promise<{ online: boolean; responseTimeMs: number | null }>`.

This is tested against a **real local TCP server** spun up in the test itself — it's a thin wrapper with no external dependency worth isolating from, and a real socket exercise is the only way to actually prove the timeout/refused-connection paths work.

- [ ] **Step 1: Write the failing test**

Create `src/health-monitoring/jobs/tcp-port-check.spec.ts`:

```typescript
import { createServer, Server } from 'net';
import { attemptTcpPortCheck } from './tcp-port-check';

describe('attemptTcpPortCheck', () => {
  let server: Server;
  let port: number;

  beforeAll((done) => {
    server = createServer((socket) => socket.end());
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      port = typeof address === 'object' && address ? address.port : 0;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it('resolves online:true with a numeric responseTimeMs when the port is open', async () => {
    const result = await attemptTcpPortCheck('127.0.0.1', port, 2000);

    expect(result.online).toBe(true);
    expect(typeof result.responseTimeMs).toBe('number');
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('resolves online:false with responseTimeMs null when the connection is refused', async () => {
    // Port 1 is a well-known unassigned/reserved port unlikely to have
    // anything listening in a test environment, and connection refusal is
    // near-instant (no need to wait out the timeout for this case).
    const result = await attemptTcpPortCheck('127.0.0.1', 1, 2000);

    expect(result.online).toBe(false);
    expect(result.responseTimeMs).toBeNull();
  });

  it('resolves online:false when the connection times out', async () => {
    // 10.255.255.1 is a non-routable address commonly used in tests to
    // simulate a connection that hangs rather than actively refuses —
    // pairs with a short timeout so the test itself stays fast.
    const result = await attemptTcpPortCheck('10.255.255.1', 9999, 200);

    expect(result.online).toBe(false);
    expect(result.responseTimeMs).toBeNull();
  }, 10000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tcp-port-check.spec.ts`
Expected: FAIL — `Cannot find module './tcp-port-check'`

- [ ] **Step 3: Write `tcp-port-check.ts`**

Create `src/health-monitoring/jobs/tcp-port-check.ts`:

```typescript
import { Socket } from 'net';

export interface TcpCheckResult {
  online: boolean;
  responseTimeMs: number | null;
}

// Basic TCP reachability probe only — connects and confirms the socket
// opens, then immediately closes it. Deliberately NOT a full RTSP
// handshake or stream validation (explicitly out of scope for Model 1,
// see PRD Section 6a point 2 / FR-4).
export function attemptTcpPortCheck(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<TcpCheckResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new Socket();
    let settled = false;

    const finish = (result: TcpCheckResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      finish({ online: true, responseTimeMs: Date.now() - startedAt });
    });

    socket.once('timeout', () => {
      finish({ online: false, responseTimeMs: null });
    });

    socket.once('error', () => {
      finish({ online: false, responseTimeMs: null });
    });

    socket.connect(port, host);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tcp-port-check.spec.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Stop — do not commit**

---

## Task 4: `HealthMonitoringService` — Read Methods (history, current, at-risk)

**Files:**
- Create: `src/health-monitoring/health.service.ts`
- Create: `src/health-monitoring/health.service.spec.ts`
- Create: `src/health-monitoring/dto/history-query.dto.ts`

**Interfaces:**
- Consumes: `CameraRegistryService.getCameraById` (existing, for scoped single-camera existence checks), `PrismaService`, `ConfigService`.
- Produces: `HealthMonitoringService.getHistory(cameraId, query, currentUser)`, `HealthMonitoringService.getCurrent(cameraId, currentUser)`, `HealthMonitoringService.getAtRisk()`.

- [ ] **Step 1: Write `history-query.dto.ts`**

Create `src/health-monitoring/dto/history-query.dto.ts`:

```typescript
import { PaginationDto } from '../../common/dto/pagination.dto';

export class HistoryQueryDto extends PaginationDto {}
```

- [ ] **Step 2: Write the failing tests**

Create `src/health-monitoring/health.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthMonitoringService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { CameraRegistryService } from '../camera-registry/camera-registry.service';
import { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

describe('HealthMonitoringService', () => {
  let service: HealthMonitoringService;
  let prisma: {
    cameraStatusHistory: { findMany: jest.Mock };
    camera: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let cameraRegistryService: { getCameraById: jest.Mock };
  let config: ConfigService;

  const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };

  beforeEach(async () => {
    prisma = {
      cameraStatusHistory: { findMany: jest.fn() },
      camera: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };
    cameraRegistryService = { getCameraById: jest.fn() };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, number> = {
          'health.atRiskOfflineThreshold': 3,
          'health.atRiskWindowDays': 14,
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthMonitoringService,
        { provide: PrismaService, useValue: prisma },
        { provide: CameraRegistryService, useValue: cameraRegistryService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(HealthMonitoringService);
  });

  describe('getHistory', () => {
    it('checks camera existence/scoping via getCameraById, then returns paginated history rows', async () => {
      cameraRegistryService.getCameraById.mockResolvedValue({ cameraId: 'cam-1' });
      prisma.cameraStatusHistory.findMany.mockResolvedValue([
        { id: 1n, cameraId: 'cam-1', status: 'online', checkedAt: new Date(), responseTimeMs: 12 },
      ]);

      const result = await service.getHistory('cam-1', { page: 1, limit: 25 }, admin);

      expect(cameraRegistryService.getCameraById).toHaveBeenCalledWith('cam-1', admin);
      expect(prisma.cameraStatusHistory.findMany).toHaveBeenCalledWith({
        where: { cameraId: 'cam-1' },
        orderBy: { checkedAt: 'desc' },
        skip: 0,
        take: 25,
      });
      expect(result).toHaveLength(1);
    });

    it('propagates NotFoundException from getCameraById unchanged (dept_viewer scoping enforced there)', async () => {
      cameraRegistryService.getCameraById.mockRejectedValue(new Error('Camera cam-2 not found'));

      await expect(service.getHistory('cam-2', { page: 1, limit: 25 }, admin)).rejects.toThrow(
        'Camera cam-2 not found',
      );
      expect(prisma.cameraStatusHistory.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getCurrent', () => {
    it('checks camera existence/scoping via getCameraById, then returns status + target fields', async () => {
      cameraRegistryService.getCameraById.mockResolvedValue({ cameraId: 'cam-1' });
      prisma.camera.findUnique.mockResolvedValue({
        currentStatus: 'online',
        ipAddress: '10.0.0.5',
        rtspPort: 554,
      });

      const result = await service.getCurrent('cam-1', admin);

      expect(cameraRegistryService.getCameraById).toHaveBeenCalledWith('cam-1', admin);
      expect(result).toEqual({ currentStatus: 'online', ipAddress: '10.0.0.5', rtspPort: 554 });
    });
  });

  describe('getAtRisk', () => {
    it('queries with the configured threshold and window, returning the raw rows', async () => {
      const rows = [{ cameraId: 'cam-1', name: 'Camera A', departmentId: 'dept-1', currentStatus: 'offline', offlineCount: 4n }];
      prisma.$queryRaw.mockResolvedValue(rows);

      const result = await service.getAtRisk();

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        { cameraId: 'cam-1', name: 'Camera A', departmentId: 'dept-1', currentStatus: 'offline', offlineCount: 4 },
      ]);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- health.service.spec.ts`
Expected: FAIL — `Cannot find module './health.service'`

- [ ] **Step 4: Write `health.service.ts`**

Create `src/health-monitoring/health.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CameraRegistryService } from '../camera-registry/camera-registry.service';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

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

    return this.prisma.cameraStatusHistory.findMany({
      where: { cameraId },
      orderBy: { checkedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }

  async getCurrent(cameraId: string, currentUser: AuthenticatedUser) {
    await this.cameraRegistryService.getCameraById(cameraId, currentUser);

    const camera = await this.prisma.camera.findUnique({
      where: { cameraId },
      select: { currentStatus: true, ipAddress: true, rtspPort: true },
    });

    return camera;
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
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- health.service.spec.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Stop — do not commit**

---

## Task 5: `HealthMonitoringService` — `checkNow` (dual-mode)

**Files:**
- Modify: `src/health-monitoring/health.service.ts`
- Modify: `src/health-monitoring/health.service.spec.ts`
- Create: `src/health-monitoring/dto/check-now.dto.ts`

**Interfaces:**
- Consumes: `attemptTcpPortCheck` (Task 3).
- Produces: `HealthMonitoringService.checkNow(cameraId, status, request): Promise<{ status: string; checkedAt: Date; responseTimeMs: number | null }>`.

- [ ] **Step 1: Write `check-now.dto.ts`**

Create `src/health-monitoring/dto/check-now.dto.ts`:

```typescript
import { IsIn, IsOptional } from 'class-validator';

const STATUSES = ['online', 'offline'] as const;

export class CheckNowDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}
```

- [ ] **Step 2: Write the failing tests**

Add to `src/health-monitoring/health.service.spec.ts` — first extend the `prisma` mock in `beforeEach` with `camera: { findUnique: jest.fn(), update: jest.fn() }` (merge `update` into the existing `camera` mock object) and `cameraStatusHistory: { findMany: jest.fn(), create: jest.fn() }` (merge `create` in), and mock the TCP check module:

```typescript
jest.mock('./jobs/tcp-port-check', () => ({
  attemptTcpPortCheck: jest.fn(),
}));
```

Add this import near the top: `import { attemptTcpPortCheck } from './jobs/tcp-port-check';`

Then add:

```typescript
  describe('checkNow', () => {
    it('runs a real TCP check for an IP camera with ip_address, ignoring any provided status', async () => {
      cameraRegistryService.getCameraById.mockResolvedValue({ cameraId: 'cam-1' });
      prisma.camera.findUnique.mockResolvedValue({
        cameraId: 'cam-1',
        cameraType: 'ip',
        ipAddress: '10.0.0.5',
        rtspPort: 554,
      });
      (attemptTcpPortCheck as jest.Mock).mockResolvedValue({ online: true, responseTimeMs: 42 });
      prisma.cameraStatusHistory.create.mockResolvedValue({});
      prisma.camera.update.mockResolvedValue({});

      const result = await service.checkNow('cam-1', 'offline', admin);

      expect(attemptTcpPortCheck).toHaveBeenCalledWith('10.0.0.5', 554, expect.any(Number));
      expect(prisma.cameraStatusHistory.create).toHaveBeenCalledWith({
        data: { cameraId: 'cam-1', status: 'online', responseTimeMs: 42 },
      });
      expect(prisma.camera.update).toHaveBeenCalledWith({
        where: { cameraId: 'cam-1' },
        data: { currentStatus: 'online' },
      });
      expect(result.status).toBe('online');
    });

    it('defaults to port 554 when rtsp_port is null', async () => {
      cameraRegistryService.getCameraById.mockResolvedValue({ cameraId: 'cam-1' });
      prisma.camera.findUnique.mockResolvedValue({
        cameraId: 'cam-1',
        cameraType: 'ip',
        ipAddress: '10.0.0.5',
        rtspPort: null,
      });
      (attemptTcpPortCheck as jest.Mock).mockResolvedValue({ online: false, responseTimeMs: null });
      prisma.cameraStatusHistory.create.mockResolvedValue({});
      prisma.camera.update.mockResolvedValue({});

      await service.checkNow('cam-1', undefined, admin);

      expect(attemptTcpPortCheck).toHaveBeenCalledWith('10.0.0.5', 554, expect.any(Number));
    });

    it('records a manually-reported status for an analog camera, with null responseTimeMs', async () => {
      cameraRegistryService.getCameraById.mockResolvedValue({ cameraId: 'cam-2' });
      prisma.camera.findUnique.mockResolvedValue({
        cameraId: 'cam-2',
        cameraType: 'analog',
        ipAddress: null,
        rtspPort: null,
      });
      prisma.cameraStatusHistory.create.mockResolvedValue({});
      prisma.camera.update.mockResolvedValue({});

      const result = await service.checkNow('cam-2', 'online', admin);

      expect(attemptTcpPortCheck).not.toHaveBeenCalled();
      expect(prisma.cameraStatusHistory.create).toHaveBeenCalledWith({
        data: { cameraId: 'cam-2', status: 'online', responseTimeMs: null },
      });
      expect(result.status).toBe('online');
    });

    it('records a manually-reported status for an IP camera with no ip_address set', async () => {
      cameraRegistryService.getCameraById.mockResolvedValue({ cameraId: 'cam-3' });
      prisma.camera.findUnique.mockResolvedValue({
        cameraId: 'cam-3',
        cameraType: 'ip',
        ipAddress: null,
        rtspPort: null,
      });
      prisma.cameraStatusHistory.create.mockResolvedValue({});
      prisma.camera.update.mockResolvedValue({});

      const result = await service.checkNow('cam-3', 'offline', admin);

      expect(attemptTcpPortCheck).not.toHaveBeenCalled();
      expect(result.status).toBe('offline');
    });

    it('throws BadRequestException when status is missing for a non-checkable camera', async () => {
      cameraRegistryService.getCameraById.mockResolvedValue({ cameraId: 'cam-4' });
      prisma.camera.findUnique.mockResolvedValue({
        cameraId: 'cam-4',
        cameraType: 'analog',
        ipAddress: null,
        rtspPort: null,
      });

      await expect(service.checkNow('cam-4', undefined, admin)).rejects.toThrow(BadRequestException);
      expect(prisma.cameraStatusHistory.create).not.toHaveBeenCalled();
    });
  });
```

Also add `import { BadRequestException } from '@nestjs/common';` to the top of the spec file.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- health.service.spec.ts`
Expected: FAIL — `service.checkNow is not a function`

- [ ] **Step 4: Add `checkNow` to `health.service.ts`**

Modify `src/health-monitoring/health.service.ts` — add `BadRequestException` to the `@nestjs/common` import, add `import { attemptTcpPortCheck } from './jobs/tcp-port-check';`, and add this method after `getAtRisk`:

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- health.service.spec.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 6: Stop — do not commit**

---

## Task 6: `HealthMonitoringController` + `HealthMonitoringModule`

**Files:**
- Create: `src/health-monitoring/health.controller.ts`
- Create: `src/health-monitoring/health.controller.spec.ts`
- Create: `src/health-monitoring/health-monitoring.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `HealthMonitoringService` (Tasks 4-5).
- Produces: `GET /health/:cameraId/history`, `GET /health/:cameraId/current`, `GET /health/at-risk`, `POST /health/:cameraId/check-now`.

**Route ordering note:** `GET /health/at-risk` and `GET /health/:cameraId/history`/`current` use different literal second path segments, so they would not actually conflict regardless of declaration order — but for consistency with the established project convention (see `camera-registry.controller.ts`'s `bulk/:jobId`/`export` positioning), declare the literal `at-risk` route before any `:cameraId`-prefixed route in the same controller anyway.

- [ ] **Step 1: Write the failing controller test**

Create `src/health-monitoring/health.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { HealthMonitoringController } from './health.controller';
import { HealthMonitoringService } from './health.service';
import { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

describe('HealthMonitoringController', () => {
  let controller: HealthMonitoringController;
  let service: Record<string, jest.Mock>;

  const currentUser: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };

  beforeEach(async () => {
    service = {
      getHistory: jest.fn(),
      getCurrent: jest.fn(),
      getAtRisk: jest.fn(),
      checkNow: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthMonitoringController],
      providers: [{ provide: HealthMonitoringService, useValue: service }],
    }).compile();

    controller = module.get(HealthMonitoringController);
  });

  it('getHistory delegates to HealthMonitoringService.getHistory with cameraId, query, and current user', async () => {
    const query = { page: 1, limit: 25 };
    const rows = [{ id: 1 }];
    service.getHistory.mockResolvedValue(rows);

    const result = await controller.getHistory('cam-1', query as any, currentUser);

    expect(service.getHistory).toHaveBeenCalledWith('cam-1', query, currentUser);
    expect(result).toEqual(rows);
  });

  it('getCurrent delegates to HealthMonitoringService.getCurrent with cameraId and current user', async () => {
    const status = { currentStatus: 'online', ipAddress: '10.0.0.5', rtspPort: 554 };
    service.getCurrent.mockResolvedValue(status);

    const result = await controller.getCurrent('cam-1', currentUser);

    expect(service.getCurrent).toHaveBeenCalledWith('cam-1', currentUser);
    expect(result).toEqual(status);
  });

  it('getAtRisk delegates to HealthMonitoringService.getAtRisk with no arguments', async () => {
    const rows = [{ cameraId: 'cam-1', offlineCount: 4 }];
    service.getAtRisk.mockResolvedValue(rows);

    const result = await controller.getAtRisk();

    expect(service.getAtRisk).toHaveBeenCalledWith();
    expect(result).toEqual(rows);
  });

  it('checkNow delegates to HealthMonitoringService.checkNow with cameraId, status, and current user', async () => {
    const dto = { status: 'online' as const };
    const checkResult = { status: 'online', checkedAt: new Date(), responseTimeMs: 12 };
    service.checkNow.mockResolvedValue(checkResult);

    const result = await controller.checkNow('cam-1', dto, currentUser);

    expect(service.checkNow).toHaveBeenCalledWith('cam-1', 'online', currentUser);
    expect(result).toEqual(checkResult);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- health.controller.spec.ts`
Expected: FAIL — `Cannot find module './health.controller'`

- [ ] **Step 3: Write `health.controller.ts`**

Create `src/health-monitoring/health.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { HealthMonitoringService } from './health.service';
import { HistoryQueryDto } from './dto/history-query.dto';
import { CheckNowDto } from './dto/check-now.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

@Controller('health')
export class HealthMonitoringController {
  constructor(private readonly healthService: HealthMonitoringService) {}

  // Declared before the :cameraId-prefixed routes below, matching the
  // project convention of literal path segments winning over parameterized
  // ones (see camera-registry.controller.ts's bulk/:jobId and export routes).
  @Roles('admin', 'field_officer')
  @Get('at-risk')
  async getAtRisk() {
    return this.healthService.getAtRisk();
  }

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get(':cameraId/history')
  async getHistory(
    @Param('cameraId') cameraId: string,
    @Query() query: HistoryQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.healthService.getHistory(cameraId, query, currentUser);
  }

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get(':cameraId/current')
  async getCurrent(
    @Param('cameraId') cameraId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.healthService.getCurrent(cameraId, currentUser);
  }

  @Roles('admin', 'field_officer')
  @Audit('manual_health_check', 'camera')
  @Post(':cameraId/check-now')
  async checkNow(
    @Param('cameraId') cameraId: string,
    @Body() dto: CheckNowDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.healthService.checkNow(cameraId, dto.status, currentUser);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- health.controller.spec.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Create `health-monitoring.module.ts`**

Create `src/health-monitoring/health-monitoring.module.ts`. This lives in `src/health-monitoring/` (not `src/health/`) specifically because `src/health/` already contains an unrelated `HealthModule`/`HealthController` pair (the `/livez` liveness probe from Phase 1) — confirmed by inspection during planning, so this whole feature has used `src/health-monitoring/` and `HealthMonitoring*`-prefixed class names from Task 3 onward to avoid any collision:

```typescript
import { Module } from '@nestjs/common';
import { HealthMonitoringController } from './health.controller';
import { HealthMonitoringService } from './health.service';
import { CameraRegistryModule } from '../camera-registry/camera-registry.module';

@Module({
  imports: [CameraRegistryModule],
  controllers: [HealthMonitoringController],
  providers: [HealthMonitoringService],
  exports: [HealthMonitoringService],
})
export class HealthMonitoringModule {}
```

- [ ] **Step 6: Register `HealthMonitoringModule` in `app.module.ts`**

Modify `src/app.module.ts` — add the import and add it to `imports`:

```typescript
import { HealthMonitoringModule } from './health-monitoring/health-monitoring.module';
```

```typescript
    ScoringModule,
    HealthMonitoringModule,
```

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`
Expected: all suites pass, including the new ones.

- [ ] **Step 8: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 9: Stop — do not commit**

---

## Task 7: Health-Check Cron Job

**Files:**
- Create: `src/health-monitoring/jobs/health-check.cron.ts`
- Create: `src/health-monitoring/jobs/health-check.cron.spec.ts`
- Modify: `src/health-monitoring/health-monitoring.module.ts`

**Interfaces:**
- Consumes: `attemptTcpPortCheck` (Task 3), `PrismaService`, `ConfigService`, `SchedulerRegistry` (`@nestjs/schedule`).
- Produces: `HealthCheckCron` — a NestJS provider that, on module init, registers a dynamically-scheduled cron job via `SchedulerRegistry`.

- [ ] **Step 1: Write the failing test**

Create `src/health-monitoring/jobs/health-check.cron.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { HealthCheckCron } from './health-check.cron';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('./tcp-port-check', () => ({
  attemptTcpPortCheck: jest.fn(),
}));
import { attemptTcpPortCheck } from './tcp-port-check';

describe('HealthCheckCron', () => {
  let cron: HealthCheckCron;
  let prisma: {
    camera: { findMany: jest.Mock };
    cameraStatusHistory: { create: jest.Mock };
    $executeRaw: jest.Mock;
  };
  let schedulerRegistry: { addCronJob: jest.Mock };
  let config: ConfigService;

  beforeEach(async () => {
    prisma = {
      camera: { findMany: jest.fn() },
      cameraStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    schedulerRegistry = { addCronJob: jest.fn() };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, number> = {
          'health.cronIntervalMinutes': 5,
          'health.tcpTimeoutMs': 2500,
          'health.batchSize': 20,
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthCheckCron,
        { provide: PrismaService, useValue: prisma },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    cron = module.get(HealthCheckCron);
    (attemptTcpPortCheck as jest.Mock).mockReset();
  });

  it('registers a cron job with SchedulerRegistry on module init', () => {
    cron.onModuleInit();

    expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith('health-check', expect.anything());
  });

  it('queries only active IP cameras with a non-null ip_address', async () => {
    prisma.camera.findMany.mockResolvedValue([]);

    await cron.runHealthCheck();

    expect(prisma.camera.findMany).toHaveBeenCalledWith({
      where: { cameraType: 'ip', ipAddress: { not: null }, isActive: true },
      select: { cameraId: true, ipAddress: true, rtspPort: true },
    });
  });

  it('writes a history row and updates current_status for each checked camera', async () => {
    prisma.camera.findMany.mockResolvedValue([
      { cameraId: 'cam-1', ipAddress: '10.0.0.5', rtspPort: 554 },
    ]);
    (attemptTcpPortCheck as jest.Mock).mockResolvedValue({ online: true, responseTimeMs: 30 });

    await cron.runHealthCheck();

    expect(prisma.cameraStatusHistory.create).toHaveBeenCalledWith({
      data: { cameraId: 'cam-1', status: 'online', responseTimeMs: 30 },
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('skips a run entirely (does not query cameras) if a previous run is still in progress', async () => {
    let resolveFirstRun: () => void = () => {};
    prisma.camera.findMany.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirstRun = () => resolve([]); }),
    );

    const firstRun = cron.runHealthCheck();
    const secondRun = cron.runHealthCheck();

    expect(prisma.camera.findMany).toHaveBeenCalledTimes(1);

    resolveFirstRun();
    await Promise.all([firstRun, secondRun]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- health-check.cron.spec.ts`
Expected: FAIL — `Cannot find module './health-check.cron'`

- [ ] **Step 3: Write `health-check.cron.ts`**

Create `src/health-monitoring/jobs/health-check.cron.ts`:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { attemptTcpPortCheck } from './tcp-port-check';

const CRON_JOB_NAME = 'health-check';
const DEFAULT_BATCH_SIZE = 20;

@Injectable()
export class HealthCheckCron implements OnModuleInit {
  private readonly logger = new Logger(HealthCheckCron.name);
  // In-memory overlap guard: if a previous tick hasn't finished, a new
  // tick logs a warning and returns immediately rather than starting a
  // second concurrent run. Batching + per-check timeouts keep a normal
  // run well under the interval at this project's expected scale, but
  // this is cheap insurance against that assumption changing later.
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMinutes = this.config.get<number>('health.cronIntervalMinutes') ?? 5;
    const job = CronJob.from({
      cronTime: `0 */${intervalMinutes} * * * *`,
      onTick: () => {
        this.runHealthCheck().catch((error: Error) => {
          this.logger.error(`Health check cron run failed: ${error.message}`);
        });
      },
      start: true,
    });
    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
  }

  async runHealthCheck(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Health check cron tick skipped — previous run still in progress');
      return;
    }
    this.isRunning = true;

    try {
      const cameras = await this.prisma.camera.findMany({
        where: { cameraType: 'ip', ipAddress: { not: null }, isActive: true },
        select: { cameraId: true, ipAddress: true, rtspPort: true },
      });

      const timeoutMs = this.config.get<number>('health.tcpTimeoutMs') ?? 2500;
      const batchSize = this.config.get<number>('health.batchSize') ?? DEFAULT_BATCH_SIZE;

      for (let i = 0; i < cameras.length; i += batchSize) {
        const batch = cameras.slice(i, i + batchSize);
        await Promise.all(batch.map((camera) => this.checkOneCamera(camera, timeoutMs)));
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async checkOneCamera(
    camera: { cameraId: string; ipAddress: string | null; rtspPort: number | null },
    timeoutMs: number,
  ): Promise<void> {
    if (!camera.ipAddress) return; // defensive — query already filters this

    const port = camera.rtspPort ?? 554;
    const result = await attemptTcpPortCheck(camera.ipAddress, port, timeoutMs);
    const status = result.online ? 'online' : 'offline';

    await this.prisma.cameraStatusHistory.create({
      data: { cameraId: camera.cameraId, status, responseTimeMs: result.responseTimeMs },
    });

    // Plain $executeRaw (not prisma.camera.update) here only because this
    // write must never touch location_geo and this keeps the write
    // minimal/explicit; a plain Prisma update would work identically since
    // current_status isn't a geography column — either is fine, this
    // matches the raw-SQL convention already used for other single-column
    // camera writes in this codebase (see ScoringService).
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE camera SET current_status = ${status}, updated_at = now() WHERE camera_id = ${camera.cameraId}::uuid`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- health-check.cron.spec.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Register `HealthCheckCron` in the module**

Modify `src/health-monitoring/health-monitoring.module.ts` — add the import and provider:

```typescript
import { HealthCheckCron } from './jobs/health-check.cron';
```

```typescript
  providers: [HealthMonitoringService, HealthCheckCron],
```

- [ ] **Step 6: Run the full unit suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 7: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 8: Stop — do not commit**

---

## Task 8: End-to-End Tests

**Files:**
- Create: `test/health-monitoring.e2e-spec.ts`

**Interfaces:**
- Consumes: the full health-monitoring flow (Tasks 1-7). The cron itself is NOT disabled for e2e — it runs on its normal schedule in the background during the test process, but with a 5-minute default interval it will not fire during a short-lived test run, so no explicit override is needed. `check-now` is tested directly via HTTP, independent of the cron.

- [ ] **Step 1: Write the e2e test**

Create `test/health-monitoring.e2e-spec.ts`. Uses the same real department IDs and cleanup pattern as prior e2e specs in this project:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health Monitoring (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-health-admin@sentinel.local';
  const viewerEmail = 'e2e-health-viewer@sentinel.local';
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME
  const DEPARTMENT_B_ID = '1de2e83f-ab28-4d0a-8825-05fdc9e008c3'; // RTO

  let adminToken: string;
  let viewerToken: string;

  async function cleanup() {
    const users = await prisma.appUser.findMany({
      where: { email: { in: [adminEmail, viewerEmail] } },
    });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    const cameras = await prisma.camera.findMany({ where: { name: { startsWith: 'E2E Health Camera' } } });
    const cameraIds = cameras.map((c) => c.cameraId);
    if (cameraIds.length > 0) {
      await prisma.cameraStatusHistory.deleteMany({ where: { cameraId: { in: cameraIds } } });
    }
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Health Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, viewerEmail] } } });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await cleanup();

    await prisma.appUser.create({
      data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 10), role: 'admin' },
    });
    await prisma.appUser.create({
      data: {
        email: viewerEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'dept_viewer',
        departmentId: DEPARTMENT_A_ID,
      },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;

    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: viewerEmail, password });
    viewerToken = viewerLogin.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function createTestCamera(name: string, departmentId: string, cameraType: 'ip' | 'analog') {
    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, departmentId, latitude: 23.0, longitude: 72.0, cameraType });
    return response.body.cameraId;
  }

  it('check-now records a manually-reported status for an analog camera and it appears in history/current', async () => {
    const cameraId = await createTestCamera('E2E Health Camera Analog', DEPARTMENT_A_ID, 'analog');

    const checkResponse = await request(app.getHttpServer())
      .post(`/api/v1/health/${cameraId}/check-now`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'offline' });

    expect(checkResponse.status).toBe(201);
    expect(checkResponse.body.status).toBe('offline');

    const currentResponse = await request(app.getHttpServer())
      .get(`/api/v1/health/${cameraId}/current`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(currentResponse.body.currentStatus).toBe('offline');

    const historyResponse = await request(app.getHttpServer())
      .get(`/api/v1/health/${cameraId}/history`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(historyResponse.body.some((row: any) => row.status === 'offline')).toBe(true);
  });

  it('check-now rejects a missing status for an analog camera with 400', async () => {
    const cameraId = await createTestCamera('E2E Health Camera Analog No Status', DEPARTMENT_A_ID, 'analog');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/health/${cameraId}/check-now`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it('check-now attempts a real TCP check for an IP camera with an unreachable ip_address, resulting in offline', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Health Camera IP',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });
    const cameraId = createResponse.body.cameraId;

    await request(app.getHttpServer())
      .patch(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({}); // no-op, camera has no ipAddress-setting endpoint yet in this plan — see note below

    const response = await request(app.getHttpServer())
      .post(`/api/v1/health/${cameraId}/check-now`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    // No ip_address was ever set on this camera (PATCH /cameras/:id does
    // not currently expose ip_address as an updatable field — out of
    // scope for this plan), so this exercises the "IP camera with no
    // ip_address" branch, requiring a manual status instead.
    expect(response.status).toBe(400);
  });

  it('dept_viewer can view history/current for their own department camera, but not another department\'s', async () => {
    const ownCameraId = await createTestCamera('E2E Health Camera Own Dept', DEPARTMENT_A_ID, 'analog');
    const otherCameraId = await createTestCamera('E2E Health Camera Other Dept', DEPARTMENT_B_ID, 'analog');

    const ownResponse = await request(app.getHttpServer())
      .get(`/api/v1/health/${ownCameraId}/current`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(ownResponse.status).toBe(200);

    const otherResponse = await request(app.getHttpServer())
      .get(`/api/v1/health/${otherCameraId}/current`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(otherResponse.status).toBe(404);
  });

  it('rejects at-risk access for a dept_viewer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/at-risk')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(403);
  });

  it('at-risk lists a camera with 3+ offline check-now events in the trailing window', async () => {
    const cameraId = await createTestCamera('E2E Health Camera At Risk', DEPARTMENT_A_ID, 'analog');

    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post(`/api/v1/health/${cameraId}/check-now`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'offline' });
    }

    const response = await request(app.getHttpServer())
      .get('/api/v1/health/at-risk')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.some((row: any) => row.cameraId === cameraId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npm run test:e2e -- health-monitoring.e2e-spec.ts`
Expected: PASS, all 6 tests green. If the third test ("unreachable ip_address") fails because the assumption about `PATCH /cameras/:id` not exposing `ipAddress` turns out wrong (check `src/camera-registry/dto/update-camera.dto.ts` if it fails), adjust the test to actually set a real unreachable IP (e.g. `10.255.255.1`) via whatever mechanism is available, and assert `offline` with a real TCP-check response instead.

- [ ] **Step 3: Stop — do not commit**

---

## Final Task: Full Regression Pass

**Files:** none created — verification only.

- [ ] **Step 1: Run the entire unit test suite**

```bash
cd model1-service
npm test
```

Expected: every suite from this build plus every suite from every prior build passes.

- [ ] **Step 2: Run the entire e2e test suite**

```bash
npm run test:e2e
```

Expected: all e2e suites pass, including the new one from Task 8.

- [ ] **Step 3: Run the TypeScript compiler**

```bash
npx tsc --noEmit -p tsconfig.build.json
```

Expected: zero errors.

- [ ] **Step 4: Manually verify the full cycle against a live server**

```bash
npm run start:dev
```

Confirm via startup logs that the health-check cron registered successfully (no crash, no error about `SchedulerRegistry`). Create a test analog camera, call `check-now` with a status, confirm it appears in both `/current` and `/history`. Create a test IP camera, manually set an unreachable `ip_address` directly via psql (since no endpoint exposes it), wait or trigger a check, confirm `offline` is recorded. Call `/at-risk` and confirm it reflects real data. Clean up all test data (cameras, camera_status_history rows, audit_log rows, test users) afterward via psql. Stop the dev server.

**Note:** unlike the scoring feature, health monitoring has no external API dependency (OpenAI/Cloudinary) — the TCP check is fully verifiable locally without any missing credentials, so this manual pass should be complete, not partial.

- [ ] **Step 5: Stop — do not commit. Report completion to the user.**

Summarize: what was built (configurable-interval cron with an overlap guard and batched TCP reachability checks, dual-mode check-now serving both automated IP checks and manual analog/no-ip_address reporting, history/current/at-risk endpoints), what passed (exact test counts), and confirm the cron correctly skips ineligible cameras (analog, soft-deleted, no ip_address) without error per the PRD's "unknown is valid" philosophy.
