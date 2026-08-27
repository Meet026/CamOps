import { Test, TestingModule } from '@nestjs/testing';
import { GisController } from './gis.controller';
import { GisService } from './gis.service';
import { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

describe('GisController', () => {
  let controller: GisController;
  let service: Record<string, jest.Mock>;

  const currentUser: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };

  beforeEach(async () => {
    service = { getCamerasInBounds: jest.fn(), getGapAnalysis: jest.fn(), getHeatmap: jest.fn() };

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

  it('getGapAnalysis delegates to GisService.getGapAnalysis with the query', async () => {
    const query = { minLat: 22.5, minLng: 72.0, maxLat: 23.5, maxLng: 73.0, gridSize: 5 };
    const result = { gridSize: 5, gaps: [] };
    service.getGapAnalysis.mockResolvedValue(result);

    const response = await controller.getGapAnalysis(query as any);

    expect(service.getGapAnalysis).toHaveBeenCalledWith(query);
    expect(response).toEqual(result);
  });

  it('getHeatmap delegates to GisService.getHeatmap with no arguments', async () => {
    const result = { beta: true as const, label: 'Beta: Incident density overlay (sample data)', points: [] };
    service.getHeatmap.mockReturnValue(result);

    const response = await controller.getHeatmap();

    expect(service.getHeatmap).toHaveBeenCalledWith();
    expect(response).toEqual(result);
  });
});
