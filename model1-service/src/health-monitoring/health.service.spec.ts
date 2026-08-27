import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthMonitoringService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { CameraRegistryService } from '../camera-registry/camera-registry.service';
import { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

jest.mock('./jobs/tcp-port-check', () => ({
  attemptTcpPortCheck: jest.fn(),
}));
import { attemptTcpPortCheck } from './jobs/tcp-port-check';

describe('HealthMonitoringService', () => {
  let service: HealthMonitoringService;
  let prisma: {
    cameraStatusHistory: { findMany: jest.Mock; create: jest.Mock };
    camera: { findUnique: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let cameraRegistryService: { getCameraById: jest.Mock };
  let config: ConfigService;

  const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };

  beforeEach(async () => {
    prisma = {
      cameraStatusHistory: { findMany: jest.fn(), create: jest.fn() },
      camera: { findUnique: jest.fn(), update: jest.fn() },
      $queryRaw: jest.fn(),
    };
    (attemptTcpPortCheck as jest.Mock).mockReset();
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

    it('converts the bigint id column to a plain number so the response is JSON-serializable', async () => {
      cameraRegistryService.getCameraById.mockResolvedValue({ cameraId: 'cam-1' });
      prisma.cameraStatusHistory.findMany.mockResolvedValue([
        { id: 42n, cameraId: 'cam-1', status: 'online', checkedAt: new Date(), responseTimeMs: 12 },
      ]);

      const result = await service.getHistory('cam-1', { page: 1, limit: 25 }, admin);

      expect(typeof result[0].id).toBe('number');
      expect(result[0].id).toBe(42);
      expect(() => JSON.stringify(result)).not.toThrow();
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
});
