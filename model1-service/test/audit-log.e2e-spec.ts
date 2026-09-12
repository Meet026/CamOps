import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Audit Log (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-auditlog-admin@sentinel.local';
  const officerEmail = 'e2e-auditlog-officer@sentinel.local';
  let adminToken: string;
  let officerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    // Pre-clean any camera left behind by a previous failed run (the two
    // search/entityLabel tests below create one each and clean up inline,
    // but a mid-test failure skips that cleanup).
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Audit' } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await prisma.appUser.create({ data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 10), role: 'admin' } });
    await prisma.appUser.create({ data: { email: officerEmail, passwordHash: await bcrypt.hash(password, 10), role: 'field_officer' } });

    const adminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;
    const officerLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: officerEmail, password });
    officerToken = officerLogin.body.accessToken;
  });

  afterAll(async () => {
    const users = await prisma.appUser.findMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map((u) => u.userId) } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await app.close();
  });

  it('admin can list audit log entries, including the login events just generated', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit-log')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.some((row: any) => row.action === 'login')).toBe(true);
  });

  it('filters by action', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit-log?action=login')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.every((row: any) => row.action === 'login')).toBe(true);
  });

  it('search is a case-insensitive substring match, not an exact-match filter', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Audit Search Camera',
        departmentId: 'c4cedd68-5fca-4a1f-b6bd-b607e0840436', // HOME
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });
    expect(created.status).toBe(201);

    // "CAM" (uppercase, partial) should match "create_camera" — an exact
    // match on the literal filter text would find nothing. The write is
    // fire-and-forget, so poll briefly rather than reading once immediately.
    let response: any;
    for (let attempt = 0; attempt < 20; attempt++) {
      response = await request(app.getHttpServer())
        .get('/api/v1/audit-log?action=CAM')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(200);
      if (response.body.some((row: any) => row.action === 'create_camera')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(response.body.some((row: any) => row.action === 'create_camera')).toBe(true);
    expect(response.body.every((row: any) => row.action.toLowerCase().includes('cam'))).toBe(true);

    await prisma.camera.deleteMany({ where: { name: 'E2E Audit Search Camera' } });
  });

  it('resolves entityLabel to the real camera name for a camera-entity row', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Audit Label Camera',
        departmentId: 'c4cedd68-5fca-4a1f-b6bd-b607e0840436', // HOME
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });
    expect(created.status).toBe(201);
    const cameraId = created.body.cameraId;

    let row: any;
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/audit-log?action=create_camera&entityType=camera`)
        .set('Authorization', `Bearer ${adminToken}`);
      row = response.body.find((r: any) => r.entityId === cameraId);
      if (row) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(row).toBeDefined();
    expect(row.entityLabel).toBe('E2E Audit Label Camera');

    await prisma.camera.deleteMany({ where: { cameraId } });
  });

  it('rejects a field_officer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit-log')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(403);
  });

  it('includes a real actor (email/role) for the login just generated, and no entityId in the raw column when unset', async () => {
    const adminUserId = (await prisma.appUser.findUnique({ where: { email: adminEmail } }))!.userId;

    // The audit write is fire-and-forget (AuditLogInterceptor never awaits
    // it) — poll briefly rather than reading once immediately.
    let row: any;
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/audit-log?action=login&userId=${adminUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(200);
      if (response.body.length > 0) {
        row = response.body[0];
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(row).toBeDefined();
    expect(row.actor).toEqual({
      userId: adminUserId,
      email: adminEmail,
      role: 'admin',
      departmentName: null,
    });
    // login's own entityId is the logged-in user's id (see AuthController) —
    // not left null the way it was before entityId was ever populated.
    expect(row.entityId).toBe(adminUserId);
  });
});
