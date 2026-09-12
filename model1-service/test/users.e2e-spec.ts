import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { waitForAuditWritesToSettle } from './wait-for-audit-writes';

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-users-admin@sentinel.local';
  const officerEmail = 'e2e-users-officer@sentinel.local';
  let adminToken: string;
  let officerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await prisma.appUser.create({ data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 10), role: 'admin' } });
    await prisma.appUser.create({ data: { email: officerEmail, passwordHash: await bcrypt.hash(password, 10), role: 'field_officer' } });

    const adminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;
    const officerLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: officerEmail, password });
    officerToken = officerLogin.body.accessToken;
  });

  afterAll(async () => {
    // Login's audit write is fire-and-forget (see writeAuditLogEntry) and
    // now records a real userId — give it a moment to land before deleting
    // the very user it references, or the write trips
    // audit_log_user_id_fkey (harmless, caught, but noisy in test output).
    await waitForAuditWritesToSettle();
    const users = await prisma.appUser.findMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map((u) => u.userId) } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await app.close();
  });

  it('admin can list users, never seeing passwordHash', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.some((u: any) => u.email === adminEmail)).toBe(true);
    expect(response.body[0]).not.toHaveProperty('passwordHash');
  });

  it('rejects a non-admin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(403);
  });
});
