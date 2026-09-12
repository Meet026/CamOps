import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { WantedNotificationService } from './wanted-notification.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: {
    listNotifications: jest.Mock;
    getUnreadCount: jest.Mock;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listNotifications: jest.fn(),
      getUnreadCount: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: WantedNotificationService, useValue: service }],
    }).compile();

    controller = module.get(NotificationsController);
  });

  it('list delegates to the service with the query', async () => {
    service.listNotifications.mockResolvedValueOnce([]);
    await controller.list({ page: 1, limit: 25 });
    expect(service.listNotifications).toHaveBeenCalledWith({ page: 1, limit: 25 });
  });

  it('unreadCount wraps the service result in { count }', async () => {
    service.getUnreadCount.mockResolvedValueOnce(4);
    const result = await controller.unreadCount();
    expect(result).toEqual({ count: 4 });
  });

  it('markRead delegates to the service with the id', async () => {
    await controller.markRead('notif-1');
    expect(service.markRead).toHaveBeenCalledWith('notif-1');
  });

  it('markAllRead delegates to the service', async () => {
    await controller.markAllRead();
    expect(service.markAllRead).toHaveBeenCalledTimes(1);
  });
});
