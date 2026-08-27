import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Audit trail — before/after capture (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const adminEmail = 'e2e-audit-admin@sentinel.local';
  const targetEmail = 'e2e-audit-target@sentinel.local';
  const password = 'CorrectHorseBatteryStaple123!';
  let adminAccessToken: string;
  let targetUserId: string;

  async function cleanupTestUsers() {
    const users = await prisma.appUser.findMany({
      where: { email: { in: [adminEmail, targetEmail] } },
    });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, targetEmail] } } });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    await cleanupTestUsers();

    await prisma.appUser.create({
      data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 10), role: 'admin' },
    });
    const targetUser = await prisma.appUser.create({
      data: {
        email: targetEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'field_officer',
      },
    });
    targetUserId = targetUser.userId;

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminAccessToken = loginResponse.body.accessToken;
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await app.close();
  });

  it('records the correct before/after role values in audit_log when an admin changes a user role', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/users/${targetUserId}/role`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ role: 'admin' });

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('admin');

    const admin = await prisma.appUser.findUnique({ where: { email: adminEmail } });
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'update_role', entityType: 'app_user', userId: admin!.userId },
      orderBy: { createdAt: 'desc' },
    });

    expect(auditRow).not.toBeNull();
    expect(auditRow!.metadata).toMatchObject({
      before: { role: 'field_officer' },
      after: { role: 'admin' },
    });
  });

  it('rejects the role-update endpoint for a non-admin caller', async () => {
    // log in as the target user (now admin from the previous test — use a
    // fresh field_officer instead so this test is independent of ordering)
    const nonAdminEmail = 'e2e-audit-nonadmin@sentinel.local';
    await prisma.appUser.deleteMany({ where: { email: nonAdminEmail } });
    await prisma.appUser.create({
      data: {
        email: nonAdminEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'field_officer',
      },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: nonAdminEmail, password });

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/users/${targetUserId}/role`)
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
      .send({ role: 'admin' });

    expect(response.status).toBe(403);

    await prisma.appUser.deleteMany({ where: { email: nonAdminEmail } });
  });
});
