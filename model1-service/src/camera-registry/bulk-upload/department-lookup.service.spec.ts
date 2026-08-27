import { Test, TestingModule } from '@nestjs/testing';
import { DepartmentLookupService } from './department-lookup.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DepartmentLookupService', () => {
  let service: DepartmentLookupService;
  let prisma: { department: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { department: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DepartmentLookupService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DepartmentLookupService);
  });

  it('returns a Map from department code to departmentId', async () => {
    prisma.department.findMany.mockResolvedValue([
      { departmentId: 'dept-1', code: 'HOME' },
      { departmentId: 'dept-2', code: 'RTO' },
    ]);

    const map = await service.loadCodeToIdMap();

    expect(map.get('HOME')).toBe('dept-1');
    expect(map.get('RTO')).toBe('dept-2');
    expect(map.size).toBe(2);
  });

  it('returns an empty Map when there are no departments', async () => {
    prisma.department.findMany.mockResolvedValue([]);

    const map = await service.loadCodeToIdMap();

    expect(map.size).toBe(0);
  });
});
