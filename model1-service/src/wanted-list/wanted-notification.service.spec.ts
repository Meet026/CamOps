import { Test, TestingModule } from '@nestjs/testing';
import { WantedNotificationService } from './wanted-notification.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WantedNotificationService', () => {
  let service: WantedNotificationService;
  let prisma: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };

  const fakeRow = {
    notification_id: 'notif-1',
    wanted_vehicle_id: 'wv-1',
    source: 'manual_search',
    matched_plate_number: 'GJ01AB1234',
    is_read: false,
    created_at: new Date('2026-01-01T00:00:00Z'),
    person_name: 'Ramesh Patel',
    plate_number: 'GJ01AB1234',
    crime_details: 'Theft (IPC 379)',
  };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [WantedNotificationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(WantedNotificationService);
  });

  describe('createManualSearchNotification', () => {
    it('inserts a notification row with source manual_search', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ notification_id: 'notif-1' }]);

      await service.createManualSearchNotification('wv-1', 'GJ01AB1234');

      // Tagged-template calls: [strings, ...values] — 'manual_search' is a
      // literal baked into the SQL text (not user input), so it appears in
      // strings; the actual bound values are wanted_vehicle_id and the plate.
      const callArgs = prisma.$queryRaw.mock.calls[0];
      const sqlText = callArgs[0].join('');
      expect(sqlText).toContain('manual_search');
      expect(callArgs).toContain('wv-1');
      expect(callArgs).toContain('GJ01AB1234');
    });
  });

  describe('listNotifications', () => {
    it('maps rows to camelCase records', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([fakeRow]);

      const results = await service.listNotifications({ page: 1, limit: 25 });

      expect(results).toEqual([
        {
          notificationId: 'notif-1',
          wantedVehicleId: 'wv-1',
          source: 'manual_search',
          matchedPlateNumber: 'GJ01AB1234',
          isRead: false,
          createdAt: fakeRow.created_at,
          personName: 'Ramesh Patel',
          plateNumber: 'GJ01AB1234',
          crimeDetails: 'Theft (IPC 379)',
        },
      ]);
    });

    it('filters to unread only when unreadOnly is true', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.listNotifications({ page: 1, limit: 25, unreadOnly: true });

      const [sql] = prisma.$queryRaw.mock.calls[0];
      const sqlText = sql.strings.join('');
      expect(sqlText).toContain('is_read');
    });
  });

  describe('getUnreadCount', () => {
    it('returns the unread count as a number', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(3) }]);

      const count = await service.getUnreadCount();

      expect(count).toBe(3);
    });
  });

  describe('markRead', () => {
    it('sets is_read = true for the given notification id', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(1);

      await service.markRead('notif-1');

      // markRead uses Prisma.sql(...) (a single tagged-sql object), not a
      // tagged-template call — bound values live on .values.
      const [sql] = prisma.$executeRaw.mock.calls[0];
      expect(sql.values).toContain('notif-1');
    });
  });

  describe('markAllRead', () => {
    it('marks every unread notification as read', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(5);

      await service.markAllRead();

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });
});
