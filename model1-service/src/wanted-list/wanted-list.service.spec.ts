import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WantedListService } from './wanted-list.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WantedListService', () => {
  let service: WantedListService;
  let prisma: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [WantedListService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(WantedListService);
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
});
