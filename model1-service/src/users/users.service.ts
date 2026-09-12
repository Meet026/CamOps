import { Injectable, NotFoundException } from '@nestjs/common';
import { AppUser } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';

export interface UserSummary {
  userId: string;
  email: string;
  role: string;
  departmentId: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContextService,
  ) {}

  async findByEmail(email: string): Promise<AppUser | null> {
    return this.prisma.appUser.findUnique({ where: { email } });
  }

  async findById(userId: string): Promise<AppUser | null> {
    return this.prisma.appUser.findUnique({ where: { userId } });
  }

  /**
   * Reference example for how a service method should record a before/after
   * change for the audit log: read the old value first, apply the update,
   * then hand {before, after} to AuditContextService — the AuditLogInterceptor
   * picks it up automatically when the route is decorated with @Audit(...).
   * Future modules (camera-registry, etc.) should follow this same pattern.
   */
  async updateRole(request: Request, userId: string, newRole: string): Promise<AppUser> {
    const existingUser = await this.prisma.appUser.findUnique({ where: { userId } });
    if (!existingUser) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const updatedUser = await this.prisma.appUser.update({
      where: { userId },
      data: { role: newRole },
    });

    if (existingUser.role !== newRole) {
      this.auditContext.setChanges(request, { role: existingUser.role }, { role: newRole }, userId);
    }

    return updatedUser;
  }

  async list(query: { page: number; limit: number }): Promise<UserSummary[]> {
    return this.prisma.appUser.findMany({
      select: { userId: true, email: true, role: true, departmentId: true },
      orderBy: { email: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }

  // Used by AuthService.changePassword — kept here rather than direct
  // Prisma access from AuthService, consistent with this project's module
  // boundary discipline (modules only interact through exported service
  // methods).
  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.appUser.update({ where: { userId }, data: { passwordHash } });
  }

  // Writes an (already-encrypted) TOTP secret without turning on
  // enforcement — totpEnabled only flips true once AuthService.confirmTotp
  // verifies a real code against this pending secret. See
  // docs/superpowers/specs/2026-09-12-totp-two-factor-auth-design.md §4.
  async setPendingTotpSecret(userId: string, encryptedSecret: string): Promise<void> {
    await this.prisma.appUser.update({ where: { userId }, data: { totpSecret: encryptedSecret } });
  }

  async enableTotp(userId: string): Promise<void> {
    await this.prisma.appUser.update({
      where: { userId },
      data: { totpEnabled: true, totpEnabledAt: new Date() },
    });
  }

  async disableTotp(userId: string): Promise<void> {
    await this.prisma.appUser.update({
      where: { userId },
      data: { totpSecret: null, totpEnabled: false, totpEnabledAt: null },
    });
  }
}
