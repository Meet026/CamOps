import { Test, TestingModule } from '@nestjs/testing';
import { DepartmentsService } from './departments.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DepartmentsService', () => {
  let service: DepartmentsService;
  let prisma: { department: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { department: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DepartmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DepartmentsService);
  });

  it('returns departmentId, name, code for every department, no pagination', async () => {
    prisma.department.findMany.mockResolvedValue([
      { departmentId: 'dept-1', name: 'Home Department (Police)', code: 'HOME' },
    ]);

    const result = await service.list();

    expect(prisma.department.findMany).toHaveBeenCalledWith({
      select: { departmentId: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    expect(result).toEqual([{ departmentId: 'dept-1', name: 'Home Department (Police)', code: 'HOME' }]);
  });
});
