import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyDeptScope, AuthenticatedUser } from '../common/scoping/dept-scope.helper';
import { HEATMAP_SAMPLE_POINTS, HeatmapPoint } from './heatmap-sample-data';

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

  getHeatmap(): { beta: true; label: string; points: HeatmapPoint[] } {
    return {
      beta: true,
      label: 'Beta: Incident density overlay (sample data)',
      points: HEATMAP_SAMPLE_POINTS,
    };
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
