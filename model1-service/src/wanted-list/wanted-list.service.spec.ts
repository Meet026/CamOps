import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WantedListService } from './wanted-list.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';
import { WantedNotificationService } from './wanted-notification.service';

describe('WantedListService', () => {
  let service: WantedListService;
  let prisma: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
  let auditContext: { setChanges: jest.Mock };
  let notificationService: { createLookbackNotifications: jest.Mock };

  const fakeRow = {
    wanted_vehicle_id: 'wv-1',
    person_name: 'Ramesh Patel',
    plate_number: 'GJ01AB1234',
    crime_details: 'Theft (IPC 379)',
    status: 'active',
    department_id: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    resolved_at: null,
  };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
    auditContext = { setChanges: jest.fn() };
    notificationService = { createLookbackNotifications: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WantedListService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditContextService, useValue: auditContext },
        { provide: WantedNotificationService, useValue: notificationService },
      ],
    }).compile();

    service = await module.resolve(WantedListService);
  });

  describe('checkPlate', () => {
    it('returns matched: true with the wanted vehicle when an active entry has that plate', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([fakeRow]);

      const result = await service.checkPlate('gj 01 ab 1234');

      expect(result.matched).toBe(true);
      expect(result.wantedVehicle?.plateNumber).toBe('GJ01AB1234');
      expect(result.wantedVehicle?.crimeDetails).toBe('Theft (IPC 379)');
      expect(result.wantedVehicle?.personName).toBe('Ramesh Patel');
    });

    it('normalizes the input plate before comparing', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([fakeRow]);

      await service.checkPlate('GJ-01-AB-1234');

      const [sql] = prisma.$queryRaw.mock.calls[0];
      // Prisma.sql template produces a tagged-template object with .values —
      // assert the normalized (no hyphens/spaces, uppercased) plate was
      // what actually got bound, not the raw user input.
      expect(sql.values).toContain('GJ01AB1234');
    });

    it('only matches active entries — resolved rows are excluded by the query', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.checkPlate('GJ01AB1234');

      const [sql] = prisma.$queryRaw.mock.calls[0];
      const sqlText = sql.strings.join('');
      expect(sqlText).toContain("status = 'active'");
    });

    it('returns matched: false with a null wantedVehicle when no active entry matches', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.checkPlate('GJ99ZZ9999');

      expect(result.matched).toBe(false);
      expect(result.wantedVehicle).toBeNull();
    });

    it('rejects an empty plate before ever querying the database', async () => {
      await expect(service.checkPlate('   ')).rejects.toThrow(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('listWanted', () => {
    it('filters by status when given', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([fakeRow]);
      const result = await service.listWanted('active');
      expect(result[0].plateNumber).toBe('GJ01AB1234');
      expect(prisma.$queryRaw.mock.calls[0][0].values).toContain('active');
    });

    it('returns every entry when no status is given', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([fakeRow, { ...fakeRow, wanted_vehicle_id: 'wv-2', status: 'resolved' }]);
      const result = await service.listWanted();
      expect(result).toHaveLength(2);
      expect(prisma.$queryRaw.mock.calls[0][0].values).toEqual([]);
    });
  });

  describe('createWanted', () => {
    const request = {} as never;
    const dto = { plateNumber: 'gj-01 ab 1234', personName: ' Ramesh Patel ', crimeDetails: 'Theft (IPC 379)' };

    it('stores the plate normalized and the names trimmed', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([fakeRow]);
      await service.createWanted(request, dto);
      const values = prisma.$queryRaw.mock.calls[0][0].values;
      expect(values).toContain('GJ01AB1234');
      expect(values).toContain('Ramesh Patel');
    });

    it('runs the look-back and returns how many earlier sightings it alerted on', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([fakeRow]);
      notificationService.createLookbackNotifications.mockResolvedValueOnce(2);
      const result = await service.createWanted(request, dto);
      expect(notificationService.createLookbackNotifications).toHaveBeenCalledWith('wv-1', 'GJ01AB1234');
      expect(result).toMatchObject({ wantedVehicleId: 'wv-1', lookbackAlerts: 2 });
    });

    it('records the audit change against the new id', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([fakeRow]);
      await service.createWanted(request, dto);
      expect(auditContext.setChanges).toHaveBeenCalledWith(request, null, expect.objectContaining({ plateNumber: 'GJ01AB1234' }), 'wv-1');
    });

    it('maps a duplicate active plate to 409 and does not run the look-back', async () => {
      prisma.$queryRaw.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2010', meta: { code: '23505' } }));
      await expect(service.createWanted(request, dto)).rejects.toBeInstanceOf(ConflictException);
      expect(notificationService.createLookbackNotifications).not.toHaveBeenCalled();
    });

    it('rejects a plate that is empty after normalization', async () => {
      await expect(service.createWanted(request, { ...dto, plateNumber: ' - ' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('still succeeds and audits when the look-back fails, reporting lookbackAlerts as null', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([fakeRow]);
      notificationService.createLookbackNotifications.mockRejectedValueOnce(new Error('statement timeout'));
      const result = await service.createWanted(request, dto);
      expect(result).toMatchObject({ wantedVehicleId: 'wv-1', lookbackAlerts: null });
      expect(auditContext.setChanges).toHaveBeenCalled();
    });

    it('rethrows other database errors unchanged', async () => {
      const boom = new Error('connection reset');
      prisma.$queryRaw.mockRejectedValueOnce(boom);
      await expect(service.createWanted(request, dto)).rejects.toBe(boom);
    });
  });

  describe('resolveWanted', () => {
    const request = {} as never;

    it('marks an active vehicle resolved and audits the status change', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([fakeRow])
        .mockResolvedValueOnce([{ ...fakeRow, status: 'resolved', resolved_at: new Date() }]);
      const result = await service.resolveWanted(request, 'wv-1');
      expect(result.status).toBe('resolved');
      expect(auditContext.setChanges).toHaveBeenCalledWith(request, { status: 'active' }, { status: 'resolved' }, 'wv-1');
    });

    it('404s an unknown id', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await expect(service.resolveWanted(request, 'wv-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s an already-resolved vehicle without updating it', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ ...fakeRow, status: 'resolved' }]);
      await expect(service.resolveWanted(request, 'wv-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});
