import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { parse } from 'csv-parse/sync';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { waitForAuditWritesToSettle } from './wait-for-audit-writes';

describe('Camera Export (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-export-admin@sentinel.local';
  const auditorEmail = 'e2e-export-auditor@sentinel.local';
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME

  let adminToken: string;
  let auditorToken: string;

  async function cleanup() {
    const users = await prisma.appUser.findMany({
      where: { email: { in: [adminEmail, auditorEmail] } },
    });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Export Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, auditorEmail] } } });
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
    await cleanup();

    await prisma.appUser.create({
      data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 10), role: 'admin' },
    });
    await prisma.appUser.create({
      data: { email: auditorEmail, passwordHash: await bcrypt.hash(password, 10), role: 'auditor' },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;

    const auditorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: auditorEmail, password });
    auditorToken = auditorLogin.body.accessToken;

    await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Export Camera A',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });
  });

  afterAll(async () => {
    // Login's audit write is fire-and-forget (see writeAuditLogEntry) and
    // now records a real userId — give it a moment to land before cleanup()
    // deletes the very user it references, or the write trips
    // audit_log_user_id_fkey (harmless, caught, but noisy in test output).
    await waitForAuditWritesToSettle();
    await cleanup();
    await app.close();
  });

  it('exports a CSV containing the created camera, accessible to an admin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');

    const records = parse(response.text, { columns: true });
    expect(records.some((r: any) => r.name === 'E2E Export Camera A')).toBe(true);
  });

  it('is accessible to an auditor', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras/export')
      .set('Authorization', `Bearer ${auditorToken}`);

    expect(response.status).toBe(200);
  });

  it('respects filters, e.g. cameraType=analog returning none of the ip test cameras', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras/export?cameraType=analog')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const records = parse(response.text, { columns: true });
    expect(records.some((r: any) => r.name === 'E2E Export Camera A')).toBe(false);
  });

  it('rejects export for a field_officer (not in the admin/auditor role pair)', async () => {
    const fieldOfficerEmail = 'e2e-export-field-officer@sentinel.local';
    await prisma.appUser.deleteMany({ where: { email: fieldOfficerEmail } });
    await prisma.appUser.create({
      data: {
        email: fieldOfficerEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'field_officer',
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fieldOfficerEmail, password });

    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras/export')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(response.status).toBe(403);

    await prisma.appUser.deleteMany({ where: { email: fieldOfficerEmail } });
  });
});
