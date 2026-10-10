import { Test, TestingModule } from '@nestjs/testing';
import { WantedListController } from './wanted-list.controller';
import { WantedListService } from './wanted-list.service';
import { WantedNotificationService } from './wanted-notification.service';

describe('WantedListController', () => {
  let controller: WantedListController;
  let wantedListService: { checkPlate: jest.Mock; listWanted: jest.Mock; createWanted: jest.Mock; resolveWanted: jest.Mock };
  let notificationService: { createManualSearchNotification: jest.Mock };

  beforeEach(async () => {
    wantedListService = { checkPlate: jest.fn(), listWanted: jest.fn(), createWanted: jest.fn(), resolveWanted: jest.fn() };
    notificationService = { createManualSearchNotification: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WantedListController],
      providers: [
        { provide: WantedListService, useValue: wantedListService },
        { provide: WantedNotificationService, useValue: notificationService },
      ],
    }).compile();

    controller = module.get(WantedListController);
  });

  describe('checkPlate', () => {
    it('creates a notification when the plate matches an active wanted vehicle', async () => {
      wantedListService.checkPlate.mockResolvedValueOnce({
        matched: true,
        wantedVehicle: { wantedVehicleId: 'wv-1', plateNumber: 'GJ01AB1234' },
      });

      const result = await controller.checkPlate({ plate: 'GJ01AB1234' });

      expect(notificationService.createManualSearchNotification).toHaveBeenCalledWith(
        'wv-1',
        'GJ01AB1234',
      );
      expect(result.matched).toBe(true);
    });

    it('does not create a notification when the plate has no match', async () => {
      wantedListService.checkPlate.mockResolvedValueOnce({ matched: false, wantedVehicle: null });

      const result = await controller.checkPlate({ plate: 'GJ99ZZ9999' });

      expect(notificationService.createManualSearchNotification).not.toHaveBeenCalled();
      expect(result.matched).toBe(false);
    });
  });

  describe('wanted list management', () => {
    const request = {} as never;

    it('lists by the requested status', async () => {
      wantedListService.listWanted.mockResolvedValueOnce([{ wantedVehicleId: 'wv-1' }]);
      await expect(controller.list({ status: 'active' })).resolves.toEqual([{ wantedVehicleId: 'wv-1' }]);
      expect(wantedListService.listWanted).toHaveBeenCalledWith('active');
    });

    it('creates with the request (for auditing) and the body', async () => {
      const dto = { plateNumber: 'GJ01AB1234', personName: 'A', crimeDetails: 'B' };
      wantedListService.createWanted.mockResolvedValueOnce({ wantedVehicleId: 'wv-1', lookbackAlerts: 0 });
      await expect(controller.create(request, dto)).resolves.toMatchObject({ lookbackAlerts: 0 });
      expect(wantedListService.createWanted).toHaveBeenCalledWith(request, dto);
    });

    it('resolves by id', async () => {
      wantedListService.resolveWanted.mockResolvedValueOnce({ wantedVehicleId: 'wv-1', status: 'resolved' });
      await controller.resolve(request, 'wv-1');
      expect(wantedListService.resolveWanted).toHaveBeenCalledWith(request, 'wv-1');
    });
  });
});
