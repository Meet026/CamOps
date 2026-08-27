import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DepartmentLookupService {
  constructor(private readonly prisma: PrismaService) {}

  // Loaded once per bulk-upload job (not once per row) — departments don't
  // change mid-job, so re-querying per row would be wasted round trips at
  // a 10,000-row scale.
  async loadCodeToIdMap(): Promise<Map<string, string>> {
    const departments = await this.prisma.department.findMany({
      select: { departmentId: true, code: true },
    });
    return new Map(departments.map((d) => [d.code, d.departmentId]));
  }
}
