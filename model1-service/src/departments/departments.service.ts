import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DepartmentSummary {
  departmentId: string;
  name: string;
  code: string;
}

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<DepartmentSummary[]> {
    return this.prisma.department.findMany({
      select: { departmentId: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }
}
