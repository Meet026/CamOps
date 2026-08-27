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
