import { Test, TestingModule } from '@nestjs/testing';
import { WantedListController } from './wanted-list.controller';
import { WantedListService } from './wanted-list.service';
import { WantedNotificationService } from './wanted-notification.service';

describe('WantedListController', () => {
  let controller: WantedListController;
  let wantedListService: { checkPlate: jest.Mock };
  let notificationService: { createManualSearchNotification: jest.Mock };

  beforeEach(async () => {
    wantedListService = { checkPlate: jest.fn() };
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
});
