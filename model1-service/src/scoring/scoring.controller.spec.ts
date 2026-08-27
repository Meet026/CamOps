import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

describe('ScoringController', () => {
  let controller: ScoringController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = { lookupByBrandModel: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScoringController],
      providers: [{ provide: ScoringService, useValue: service }],
    }).compile();

    controller = module.get(ScoringController);
  });

  it('lookup delegates to ScoringService.lookupByBrandModel with cameraId, brand, model, and request', async () => {
    const fakeRequest = {} as Request;
    const dto = { cameraId: 'cam-1', brand: 'Hikvision', model: 'DS-2CD' };
    const scoringResult = {
      onvifStatus: 'yes',
      integrationScore: 'easy',
      onvifSource: 'lookup_table',
      dataConfidence: 'verified_api',
    };
    service.lookupByBrandModel.mockResolvedValue(scoringResult);

    const result = await controller.lookup(fakeRequest, dto);

    expect(service.lookupByBrandModel).toHaveBeenCalledWith('cam-1', 'Hikvision', 'DS-2CD', fakeRequest);
    expect(result).toEqual(scoringResult);
  });

  it('listPendingVerifications delegates to ScoringService.listPendingVerifications with the query', async () => {
    const query = { page: 1, limit: 25 };
    const rows = [{ verificationId: 'ver-1' }];
    service.listPendingVerifications = jest.fn().mockResolvedValue(rows);

    const result = await controller.listPendingVerifications(query as any);

    expect(service.listPendingVerifications).toHaveBeenCalledWith(query);
    expect(result).toEqual(rows);
  });

  it('verify delegates to ScoringService.verifyScoring with all fields', async () => {
    const fakeRequest = {} as Request;
    const currentUser = { userId: 'admin-1', role: 'admin' as const, departmentId: null };
    const dto = { decision: 'confirm' as const, finalOnvifStatus: 'yes' as const };
    const verifyResult = { verificationId: 'ver-1', status: 'confirmed' };
    service.verifyScoring = jest.fn().mockResolvedValue(verifyResult);

    const result = await controller.verify(fakeRequest, 'ver-1', dto, currentUser);

    expect(service.verifyScoring).toHaveBeenCalledWith(
      'ver-1',
      'confirm',
      'yes',
      currentUser,
      fakeRequest,
    );
    expect(result).toEqual(verifyResult);
  });

  it('lookupByPhoto delegates to ScoringService.lookupByPhoto with cameraId and request', async () => {
    const fakeRequest = {} as Request;
    const dto = { cameraId: 'cam-1' };
    const lookupResult = { identified: true, brand: 'Hikvision', model: 'DS-2CD', onvifStatus: 'yes' as const };
    service.lookupByPhoto = jest.fn().mockResolvedValue(lookupResult);

    const result = await controller.lookupByPhoto(fakeRequest, dto);

    expect(service.lookupByPhoto).toHaveBeenCalledWith('cam-1', fakeRequest);
    expect(result).toEqual(lookupResult);
  });

  it('listBrands delegates to ScoringService.listKnownBrands', async () => {
    service.listKnownBrands = jest.fn().mockResolvedValue(['Hikvision']);

    const result = await controller.listBrands();

    expect(service.listKnownBrands).toHaveBeenCalledWith();
    expect(result).toEqual(['Hikvision']);
  });
});
