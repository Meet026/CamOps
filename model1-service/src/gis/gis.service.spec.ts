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

  describe('getHeatmap', () => {
    it('returns the static sample points with a beta flag and label, without querying the database', () => {
      const result = service.getHeatmap();

      expect(result.beta).toBe(true);
      expect(result.label).toContain('Beta');
      expect(result.points.length).toBeGreaterThan(0);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
