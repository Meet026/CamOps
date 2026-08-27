# GIS & Map Features (FR-5, partial) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three of FR-5's four endpoints: `GET /gis/cameras-in-bounds` (viewport pin query), `GET /gis/gap-analysis` (grid-based coverage-gap detection), `GET /gis/heatmap` (static sample incident overlay). `GET /gis/overlap-detection` and pin clustering are explicitly deferred — see spec.

**Architecture:** New `gis/` module. Both spatial endpoints use `prisma.$queryRaw` with parameterized PostGIS SQL (`ST_MakeEnvelope`, `ST_Within`) — never Prisma's query builder, which can't express `GEOGRAPHY`/spatial operators (project-wide rule, already followed by camera-registry's raw-SQL queries). `heatmap` is a pure static-data endpoint with no database access at all. dept_viewer scoping for `cameras-in-bounds` follows the same conditions-array pattern already used in `CameraRegistryService.listCamerasUnpaginated`.

**Tech Stack:** NestJS, Prisma (`$queryRaw` for all spatial queries), PostGIS (`ST_MakeEnvelope`, `ST_Within`, `ST_X`/`ST_Y`), class-validator DTOs, Jest + Supertest.

**Spec:** `docs/superpowers/specs/2026-08-27-gis-map-features-design.md`

## Global Constraints

- `GET /gis/cameras-in-bounds`: roles all (dept_viewer scoped). `GET /gis/gap-analysis` and `GET /gis/heatmap`: roles admin, field_officer only.
- Spatial queries filter `is_active = true` always — soft-deleted cameras never appear in GIS results, matching the project-wide convention.
- Bounding box validation: `minLat < maxLat` and `minLng < maxLng` required — a 400 on an inverted/degenerate box, checked explicitly in the service (class-validator alone can't express a cross-field comparison cleanly).
- `gap-analysis`'s `gridSize`: optional, `@Min(1) @Max(50)`, default from `GIS_GAP_ANALYSIS_DEFAULT_GRID_SIZE` env var (default `10`).
- Verified against the live database during planning: `ST_MakeEnvelope(minLng, minLat, maxLng, maxLat, 4326)` + `ST_Within(location_geo::geometry, envelope)` correctly filters cameras to a bounding box; the grid-cell assignment formula (`floor((x - min) / cellSize)`, clamped to `gridSize - 1`) correctly buckets a real camera into its expected cell. Both confirmed via a temporary manual SQL test against real inserted/deleted rows — see conversation history for the exact verification queries.
- `heatmap` never touches the database — its data is a hardcoded TypeScript array.

---

## Task 1: Config — Gap Analysis Grid Size Env Var

**Files:**
- Modify: `src/config/env.validation.ts`
- Modify: `src/config/configuration.ts`
- Modify: `.env.example`
- Modify: `.env`

**Interfaces:**
- Produces: `configService.get('gis.gapAnalysisDefaultGridSize')`.

- [ ] **Step 1: Add the env var to `env.validation.ts`**

Modify `src/config/env.validation.ts` — add after the `HEALTH_CHECK_BATCH_SIZE` field:

```typescript
  @IsNumber()
  @IsOptional()
  GIS_GAP_ANALYSIS_DEFAULT_GRID_SIZE: number = 10;
```

- [ ] **Step 2: Add the corresponding block to `configuration.ts`**

Modify `src/config/configuration.ts` — add after the `health` block:

```typescript
  gis: {
    gapAnalysisDefaultGridSize: parseInt(process.env.GIS_GAP_ANALYSIS_DEFAULT_GRID_SIZE ?? '10', 10),
  },
```

- [ ] **Step 3: Add the var to `.env.example` and `.env`**

Append to both, after the `HEALTH_CHECK_BATCH_SIZE` line:

```
GIS_GAP_ANALYSIS_DEFAULT_GRID_SIZE=10
```

- [ ] **Step 4: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 5: Stop — do not commit**

---

## Task 2: `MapBoundsQueryDto` + `GisService.getCamerasInBounds`

**Files:**
- Create: `src/gis/dto/map-bounds-query.dto.ts`
- Create: `src/gis/gis.service.ts`
- Create: `src/gis/gis.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `applyDeptScope`/`AuthenticatedUser` (existing).
- Produces: `MapBoundsQueryDto`, `GisService.getCamerasInBounds(query, currentUser): Promise<CameraPin[]>` where `CameraPin = { cameraId, name, latitude, longitude, departmentId, cameraType, currentStatus, integrationScore }`.

- [ ] **Step 1: Write `map-bounds-query.dto.ts`**

Create `src/gis/dto/map-bounds-query.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude } from 'class-validator';

export class MapBoundsQueryDto {
  @Type(() => Number)
  @IsLatitude()
  minLat!: number;

  @Type(() => Number)
  @IsLongitude()
  minLng!: number;

  @Type(() => Number)
  @IsLatitude()
  maxLat!: number;

  @Type(() => Number)
  @IsLongitude()
  maxLng!: number;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/gis/gis.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GisService } from './gis.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

describe('GisService', () => {
  let service: GisService;
  let prisma: { $queryRaw: jest.Mock };
  let config: ConfigService;

  const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };
  const deptViewer: AuthenticatedUser = {
    userId: 'user-2',
    role: 'dept_viewer',
    departmentId: 'dept-1',
  };
  const validBounds = { minLat: 22.5, minLng: 72.0, maxLat: 23.5, maxLng: 73.0 };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, number> = { 'gis.gapAnalysisDefaultGridSize': 10 };
        return values[key];
      }),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GisService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(GisService);
  });

  describe('getCamerasInBounds', () => {
    it('returns mapped pin data for cameras within the given bounds', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          cameraId: 'cam-1',
          name: 'Camera A',
          latitude: 23.0,
          longitude: 72.5,
          departmentId: 'dept-1',
          cameraType: 'ip',
          currentStatus: 'online',
          integrationScore: 'easy',
        },
      ]);

      const result = await service.getCamerasInBounds(validBounds, admin);

      expect(result).toEqual([
        {
          cameraId: 'cam-1',
          name: 'Camera A',
          latitude: 23.0,
          longitude: 72.5,
          departmentId: 'dept-1',
          cameraType: 'ip',
          currentStatus: 'online',
          integrationScore: 'easy',
        },
      ]);
    });

    it('includes the bounding box and is_active filter in the query', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getCamerasInBounds(validBounds, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('ST_MakeEnvelope');
      expect(serializedQuery).toContain('ST_Within');
      expect(serializedQuery).toContain('is_active');
    });

    it("scopes the query to the dept_viewer's own department", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getCamerasInBounds(validBounds, deptViewer);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('dept-1');
    });

    it('does not scope the query for an admin', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getCamerasInBounds(validBounds, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).not.toContain('department_id =');
    });

    it('throws BadRequestException when minLat >= maxLat', async () => {
      await expect(
        service.getCamerasInBounds({ minLat: 23.5, minLng: 72.0, maxLat: 22.5, maxLng: 73.0 }, admin),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when minLng >= maxLng', async () => {
      await expect(
        service.getCamerasInBounds({ minLat: 22.5, minLng: 73.0, maxLat: 23.5, maxLng: 72.0 }, admin),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- gis.service.spec.ts`
Expected: FAIL — `Cannot find module './gis.service'`

- [ ] **Step 4: Write `gis.service.ts`**

Create `src/gis/gis.service.ts`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyDeptScope, AuthenticatedUser } from '../common/scoping/dept-scope.helper';

export interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface CameraPin {
  cameraId: string;
  name: string;
  latitude: number;
  longitude: number;
  departmentId: string;
  cameraType: string;
  currentStatus: string;
  integrationScore: string;
}

@Injectable()
export class GisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getCamerasInBounds(bounds: Bounds, currentUser: AuthenticatedUser): Promise<CameraPin[]> {
    this.validateBounds(bounds);

    // dept_viewer scoping follows the same conditions-array pattern as
    // CameraRegistryService.listCamerasUnpaginated — applyDeptScope
    // determines the effective departmentId (undefined for non-scoped
    // roles), and the condition is only appended when one is present.
    const scoped = applyDeptScope({}, currentUser);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`ST_Within(location_geo::geometry, ST_MakeEnvelope(${bounds.minLng}, ${bounds.minLat}, ${bounds.maxLng}, ${bounds.maxLat}, 4326))`,
      Prisma.sql`is_active = true`,
    ];
    if (scoped.departmentId) {
      conditions.push(Prisma.sql`department_id = ${scoped.departmentId}::uuid`);
    }

    const rows = await this.prisma.$queryRaw<CameraPin[]>(Prisma.sql`
      SELECT
        camera_id AS "cameraId",
        name,
        ST_Y(location_geo::geometry) AS latitude,
        ST_X(location_geo::geometry) AS longitude,
        department_id AS "departmentId",
        camera_type AS "cameraType",
        current_status AS "currentStatus",
        integration_score AS "integrationScore"
      FROM camera
      WHERE ${Prisma.join(conditions, ' AND ')}
    `);

    return rows;
  }

  private validateBounds(bounds: Bounds): void {
    if (bounds.minLat >= bounds.maxLat) {
      throw new BadRequestException('minLat must be less than maxLat');
    }
    if (bounds.minLng >= bounds.maxLng) {
      throw new BadRequestException('minLng must be less than maxLng');
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- gis.service.spec.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Stop — do not commit**

---

## Task 3: `GET /gis/cameras-in-bounds` Endpoint — `GisController` + `GisModule`

**Files:**
- Create: `src/gis/gis.controller.ts`
- Create: `src/gis/gis.controller.spec.ts`
- Create: `src/gis/gis.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `GisService.getCamerasInBounds` (Task 2).
- Produces: `GET /gis/cameras-in-bounds` → `200`, `CameraPin[]`.

- [ ] **Step 1: Write the failing controller test**

Create `src/gis/gis.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { GisController } from './gis.controller';
import { GisService } from './gis.service';
import { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

describe('GisController', () => {
  let controller: GisController;
  let service: Record<string, jest.Mock>;

  const currentUser: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };

  beforeEach(async () => {
    service = { getCamerasInBounds: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GisController],
      providers: [{ provide: GisService, useValue: service }],
    }).compile();

    controller = module.get(GisController);
  });

  it('getCamerasInBounds delegates to GisService.getCamerasInBounds with the query and current user', async () => {
    const query = { minLat: 22.5, minLng: 72.0, maxLat: 23.5, maxLng: 73.0 };
    const pins = [{ cameraId: 'cam-1' }];
    service.getCamerasInBounds.mockResolvedValue(pins);

    const result = await controller.getCamerasInBounds(query as any, currentUser);

    expect(service.getCamerasInBounds).toHaveBeenCalledWith(query, currentUser);
    expect(result).toEqual(pins);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gis.controller.spec.ts`
Expected: FAIL — `Cannot find module './gis.controller'`

- [ ] **Step 3: Write `gis.controller.ts`**

Create `src/gis/gis.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { GisService } from './gis.service';
import { MapBoundsQueryDto } from './dto/map-bounds-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

@Controller('gis')
export class GisController {
  constructor(private readonly gisService: GisService) {}

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get('cameras-in-bounds')
  async getCamerasInBounds(
    @Query() query: MapBoundsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.gisService.getCamerasInBounds(query, currentUser);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gis.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Create `gis.module.ts`**

Create `src/gis/gis.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { GisController } from './gis.controller';
import { GisService } from './gis.service';

@Module({
  controllers: [GisController],
  providers: [GisService],
})
export class GisModule {}
```

- [ ] **Step 6: Register `GisModule` in `app.module.ts`**

Modify `src/app.module.ts` — add the import and add it to `imports`:

```typescript
import { GisModule } from './gis/gis.module';
```

```typescript
    HealthMonitoringModule,
    GisModule,
```

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`
Expected: all suites pass, including the new ones.

- [ ] **Step 8: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 9: Stop — do not commit**

---

## Task 4: `GisService.getGapAnalysis`

**Files:**
- Create: `src/gis/dto/gap-analysis-query.dto.ts`
- Modify: `src/gis/gis.service.ts`
- Modify: `src/gis/gis.service.spec.ts`

**Interfaces:**
- Produces: `GapAnalysisQueryDto`, `GisService.getGapAnalysis(query): Promise<{ gridSize: number; gaps: Bounds[] }>`.

- [ ] **Step 1: Write `gap-analysis-query.dto.ts`**

Create `src/gis/dto/gap-analysis-query.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MapBoundsQueryDto } from './map-bounds-query.dto';

export class GapAnalysisQueryDto extends MapBoundsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  gridSize?: number;
}
```

- [ ] **Step 2: Write the failing tests**

Add to `src/gis/gis.service.spec.ts`:

```typescript
  describe('getGapAnalysis', () => {
    it('returns gaps for cells with zero cameras, using the default grid size when not specified', async () => {
      // A 2x2 grid over a 2x2-degree box: cell width/height = 1 degree
      // each. One camera occupies cell (0,0) (bottom-left quadrant); the
      // other three cells should come back as gaps.
      prisma.$queryRaw.mockResolvedValue([{ col: 0, row: 0, cameraCount: 1n }]);
      (config.get as jest.Mock).mockImplementation((key: string) =>
        key === 'gis.gapAnalysisDefaultGridSize' ? 2 : undefined,
      );

      const result = await service.getGapAnalysis({
        minLat: 20.0,
        minLng: 70.0,
        maxLat: 22.0,
        maxLng: 72.0,
      });

      expect(result.gridSize).toBe(2);
      expect(result.gaps).toHaveLength(3);
      expect(result.gaps).not.toContainEqual(
        expect.objectContaining({ minLat: 20.0, minLng: 70.0, maxLat: 21.0, maxLng: 71.0 }),
      );
    });

    it('uses the explicitly provided gridSize over the configured default', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      (config.get as jest.Mock).mockImplementation((key: string) =>
        key === 'gis.gapAnalysisDefaultGridSize' ? 10 : undefined,
      );

      const result = await service.getGapAnalysis({
        minLat: 20.0,
        minLng: 70.0,
        maxLat: 22.0,
        maxLng: 72.0,
        gridSize: 4,
      });

      expect(result.gridSize).toBe(4);
      expect(result.gaps).toHaveLength(16); // 4x4, all empty
    });

    it('returns no gaps when every cell has at least one camera', async () => {
      const allCells = [];
      for (let col = 0; col < 2; col++) {
        for (let row = 0; row < 2; row++) {
          allCells.push({ col, row, cameraCount: 1n });
        }
      }
      prisma.$queryRaw.mockResolvedValue(allCells);

      const result = await service.getGapAnalysis({
        minLat: 20.0,
        minLng: 70.0,
        maxLat: 22.0,
        maxLng: 72.0,
        gridSize: 2,
      });

      expect(result.gaps).toHaveLength(0);
    });

    it('throws BadRequestException for an inverted bounding box, same as getCamerasInBounds', async () => {
      await expect(
        service.getGapAnalysis({ minLat: 23.5, minLng: 72.0, maxLat: 22.5, maxLng: 73.0, gridSize: 2 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- gis.service.spec.ts`
Expected: FAIL — `service.getGapAnalysis is not a function`

- [ ] **Step 4: Add `getGapAnalysis` to `gis.service.ts`**

Modify `src/gis/gis.service.ts` — add this method after `getCamerasInBounds`:

```typescript
  async getGapAnalysis(
    query: Bounds & { gridSize?: number },
  ): Promise<{ gridSize: number; gaps: Bounds[] }> {
    this.validateBounds(query);

    const gridSize =
      query.gridSize ?? this.config.get<number>('gis.gapAnalysisDefaultGridSize') ?? 10;

    const cellWidth = (query.maxLng - query.minLng) / gridSize;
    const cellHeight = (query.maxLat - query.minLat) / gridSize;

    // One grouped query assigns every active camera in the box to a cell
    // (floor((coord - min) / cellSize), clamped to gridSize - 1 for a
    // camera exactly on the max edge) and counts per cell in a single
    // pass — never gridSize² separate queries.
    const occupiedCells = await this.prisma.$queryRaw<
      Array<{ col: number; row: number; cameraCount: bigint }>
    >(Prisma.sql`
      SELECT
        LEAST(floor((ST_X(location_geo::geometry) - ${query.minLng}) / ${cellWidth})::int, ${gridSize - 1}) AS col,
        LEAST(floor((ST_Y(location_geo::geometry) - ${query.minLat}) / ${cellHeight})::int, ${gridSize - 1}) AS row,
        count(*) AS "cameraCount"
      FROM camera
      WHERE ST_Within(location_geo::geometry, ST_MakeEnvelope(${query.minLng}, ${query.minLat}, ${query.maxLng}, ${query.maxLat}, 4326))
        AND is_active = true
      GROUP BY col, row
    `);

    const occupiedSet = new Set(occupiedCells.map((cell) => `${cell.col},${cell.row}`));

    const gaps: Bounds[] = [];
    for (let col = 0; col < gridSize; col++) {
      for (let row = 0; row < gridSize; row++) {
        if (occupiedSet.has(`${col},${row}`)) continue;
        gaps.push({
          minLng: query.minLng + col * cellWidth,
          maxLng: query.minLng + (col + 1) * cellWidth,
          minLat: query.minLat + row * cellHeight,
          maxLat: query.minLat + (row + 1) * cellHeight,
        });
      }
    }

    return { gridSize, gaps };
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- gis.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Stop — do not commit**

---

## Task 5: `GET /gis/gap-analysis` Endpoint

**Files:**
- Modify: `src/gis/gis.controller.ts`
- Modify: `src/gis/gis.controller.spec.ts`

**Interfaces:**
- Consumes: `GisService.getGapAnalysis` (Task 4).
- Produces: `GET /gis/gap-analysis` → `200`, `{ gridSize, gaps }`.

- [ ] **Step 1: Write the failing test**

Add to `src/gis/gis.controller.spec.ts` — extend the `service` mock with `getGapAnalysis: jest.fn()`, then add:

```typescript
  it('getGapAnalysis delegates to GisService.getGapAnalysis with the query', async () => {
    const query = { minLat: 22.5, minLng: 72.0, maxLat: 23.5, maxLng: 73.0, gridSize: 5 };
    const result = { gridSize: 5, gaps: [] };
    service.getGapAnalysis.mockResolvedValue(result);

    const response = await controller.getGapAnalysis(query as any);

    expect(service.getGapAnalysis).toHaveBeenCalledWith(query);
    expect(response).toEqual(result);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gis.controller.spec.ts`
Expected: FAIL — `controller.getGapAnalysis is not a function`

- [ ] **Step 3: Add the endpoint**

Modify `src/gis/gis.controller.ts` — add the import and method:

```typescript
import { GapAnalysisQueryDto } from './dto/gap-analysis-query.dto';
```

```typescript
  @Roles('admin', 'field_officer')
  @Get('gap-analysis')
  async getGapAnalysis(@Query() query: GapAnalysisQueryDto) {
    return this.gisService.getGapAnalysis(query);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gis.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 6: Stop — do not commit**

---

## Task 6: `GET /gis/heatmap` — Static Sample Data Endpoint

**Files:**
- Create: `src/gis/heatmap-sample-data.ts`
- Modify: `src/gis/gis.service.ts`
- Modify: `src/gis/gis.service.spec.ts`
- Modify: `src/gis/gis.controller.ts`
- Modify: `src/gis/gis.controller.spec.ts`

**Interfaces:**
- Produces: `HEATMAP_SAMPLE_POINTS: HeatmapPoint[]`, `GisService.getHeatmap(): { beta: true; label: string; points: HeatmapPoint[] }`, `GET /gis/heatmap`.

- [ ] **Step 1: Write `heatmap-sample-data.ts`**

Create `src/gis/heatmap-sample-data.ts`:

```typescript
export interface HeatmapPoint {
  latitude: number;
  longitude: number;
  weight: number;
}

// Static, hand-picked sample data standing in for a real incident-tracking
// system that doesn't exist in this project (see FR-3 design's "PRD
// Corrections" precedent for documenting a deliberate scope boundary).
// Points are placed at real Gujarat coordinates so the overlay renders
// sensibly if actually plotted, but weight values are illustrative only —
// not derived from any real incident record.
export const HEATMAP_SAMPLE_POINTS: HeatmapPoint[] = [
  { latitude: 23.0225, longitude: 72.5714, weight: 8 }, // Ahmedabad
  { latitude: 22.3072, longitude: 73.1812, weight: 5 }, // Vadodara
  { latitude: 21.1702, longitude: 72.8311, weight: 6 }, // Surat
  { latitude: 22.4707, longitude: 70.0577, weight: 3 }, // Rajkot
  { latitude: 23.2156, longitude: 72.6369, weight: 4 }, // Gandhinagar
  { latitude: 21.6417, longitude: 69.6293, weight: 2 }, // Porbandar
];
```

- [ ] **Step 2: Write the failing test**

Add to `src/gis/gis.service.spec.ts`:

```typescript
  describe('getHeatmap', () => {
    it('returns the static sample points with a beta flag and label, without querying the database', () => {
      const result = service.getHeatmap();

      expect(result.beta).toBe(true);
      expect(result.label).toContain('Beta');
      expect(result.points.length).toBeGreaterThan(0);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- gis.service.spec.ts`
Expected: FAIL — `service.getHeatmap is not a function`

- [ ] **Step 4: Add `getHeatmap` to `gis.service.ts`**

Modify `src/gis/gis.service.ts` — add `import { HEATMAP_SAMPLE_POINTS, HeatmapPoint } from './heatmap-sample-data';` and this method after `getGapAnalysis`:

```typescript
  getHeatmap(): { beta: true; label: string; points: HeatmapPoint[] } {
    return {
      beta: true,
      label: 'Beta: Incident density overlay (sample data)',
      points: HEATMAP_SAMPLE_POINTS,
    };
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- gis.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Write the failing controller test**

Add to `src/gis/gis.controller.spec.ts` — extend the `service` mock with `getHeatmap: jest.fn()`, then add:

```typescript
  it('getHeatmap delegates to GisService.getHeatmap with no arguments', async () => {
    const result = { beta: true as const, label: 'Beta: Incident density overlay (sample data)', points: [] };
    service.getHeatmap.mockReturnValue(result);

    const response = await controller.getHeatmap();

    expect(service.getHeatmap).toHaveBeenCalledWith();
    expect(response).toEqual(result);
  });
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- gis.controller.spec.ts`
Expected: FAIL — `controller.getHeatmap is not a function`

- [ ] **Step 8: Add the endpoint**

Modify `src/gis/gis.controller.ts` — add:

```typescript
  @Roles('admin', 'field_officer')
  @Get('heatmap')
  getHeatmap() {
    return this.gisService.getHeatmap();
  }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- gis.controller.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 10: Run the full unit suite and `npx tsc --noEmit`**

Run: `npm test` then `npx tsc --noEmit -p tsconfig.build.json`
Expected: all suites pass, zero compiler errors.

- [ ] **Step 11: Stop — do not commit**

---

## Task 7: End-to-End Tests

**Files:**
- Create: `test/gis.e2e-spec.ts`

**Interfaces:**
- Consumes: the full GIS flow (Tasks 1-6). Real PostGIS spatial correctness is only meaningfully verifiable against the live database — this suite seeds real cameras at known coordinates.

- [ ] **Step 1: Write the e2e test**

Create `test/gis.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('GIS (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-gis-admin@sentinel.local';
  const viewerEmail = 'e2e-gis-viewer@sentinel.local';
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
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E GIS Camera' } } });
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

    // Two cameras inside the test bounding box (20.0-22.0 lat, 70.0-72.0 lng):
    // one per department, at known coordinates for grid-cell assertions.
    await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E GIS Camera Inside A',
        departmentId: DEPARTMENT_A_ID,
        latitude: 20.5,
        longitude: 70.5,
        cameraType: 'ip',
      });
    await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E GIS Camera Inside B',
        departmentId: DEPARTMENT_B_ID,
        latitude: 20.5,
        longitude: 70.5,
        cameraType: 'ip',
      });
    // Outside the test bounding box entirely.
    await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E GIS Camera Outside',
        departmentId: DEPARTMENT_A_ID,
        latitude: 30.0,
        longitude: 80.0,
        cameraType: 'ip',
      });
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('cameras-in-bounds returns only cameras inside the box, excluding ones outside it', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/cameras-in-bounds')
      .query({ minLat: 20.0, minLng: 70.0, maxLat: 22.0, maxLng: 72.0 })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const names = response.body.map((pin: any) => pin.name);
    expect(names).toContain('E2E GIS Camera Inside A');
    expect(names).toContain('E2E GIS Camera Inside B');
    expect(names).not.toContain('E2E GIS Camera Outside');
  });

  it("cameras-in-bounds scopes results to a dept_viewer's own department", async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/cameras-in-bounds')
      .query({ minLat: 20.0, minLng: 70.0, maxLat: 22.0, maxLng: 72.0 })
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(200);
    const names = response.body.map((pin: any) => pin.name);
    expect(names).toContain('E2E GIS Camera Inside A');
    expect(names).not.toContain('E2E GIS Camera Inside B');
  });

  it('cameras-in-bounds rejects an inverted bounding box with 400', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/cameras-in-bounds')
      .query({ minLat: 22.0, minLng: 70.0, maxLat: 20.0, maxLng: 72.0 })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });

  it('gap-analysis flags empty cells and excludes the occupied one', async () => {
    // 2x2 grid over 20.0-22.0/70.0-72.0: both test cameras sit at
    // (20.5, 70.5), which falls in the same cell (0,0) — the other 3
    // cells should be reported as gaps.
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/gap-analysis')
      .query({ minLat: 20.0, minLng: 70.0, maxLat: 22.0, maxLng: 72.0, gridSize: 2 })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.gridSize).toBe(2);
    expect(response.body.gaps).toHaveLength(3);
  });

  it('gap-analysis rejects a dept_viewer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/gap-analysis')
      .query({ minLat: 20.0, minLng: 70.0, maxLat: 22.0, maxLng: 72.0 })
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(403);
  });

  it('heatmap returns beta-flagged static sample points', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/heatmap')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.beta).toBe(true);
    expect(response.body.points.length).toBeGreaterThan(0);
  });

  it('heatmap rejects a dept_viewer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/heatmap')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npm run test:e2e -- gis.e2e-spec.ts`
Expected: PASS, all 7 tests green.

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

Expected: all e2e suites pass, including the new one from Task 7.

- [ ] **Step 3: Run the TypeScript compiler**

```bash
npx tsc --noEmit -p tsconfig.build.json
```

Expected: zero errors.

- [ ] **Step 4: Manually verify against a live server**

```bash
npm run start:dev
```

Create 2-3 test cameras at known coordinates via psql or the API. Call `cameras-in-bounds` with a box that includes some and excludes others, confirm the right subset comes back. Call `gap-analysis` with a small grid and confirm empty cells are correctly identified. Call `heatmap` and confirm the static sample data comes back with `beta: true`. Clean up all test data (cameras, audit_log rows, test users) afterward via psql. Stop the dev server.

**Note:** like health-monitoring, GIS has no external API dependency — this manual pass should be complete, not partial.

- [ ] **Step 5: Stop — do not commit. Report completion to the user.**

Summarize: what was built (viewport pin queries with dept_viewer scoping, grid-based gap analysis with a single grouped spatial query, a static beta-labeled heatmap endpoint), what passed (exact test counts), and confirm `overlap-detection` and pin clustering remain explicitly deferred per the user's direction, not silently dropped.
