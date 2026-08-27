import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health Monitoring (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-health-admin@sentinel.local';
  const viewerEmail = 'e2e-health-viewer@sentinel.local';
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME
  const DEPARTMENT_B_ID = '1de2e83f-ab28-4d0a-8825-05fdc9e008c3'; // RTO

  let adminToken: string;
  let viewerToken: string;

  async function cleanup() {
    const users = await prisma.appUser.findMany({
      where: { email: { in: [adminEmail, viewerEmail] } },
    });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    const cameras = await prisma.camera.findMany({ where: { name: { startsWith: 'E2E Health Camera' } } });
    const cameraIds = cameras.map((c) => c.cameraId);
    if (cameraIds.length > 0) {
      await prisma.cameraStatusHistory.deleteMany({ where: { cameraId: { in: cameraIds } } });
    }
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Health Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, viewerEmail] } } });
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
      data: {
        email: viewerEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'dept_viewer',
        departmentId: DEPARTMENT_A_ID,
      },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;

    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: viewerEmail, password });
    viewerToken = viewerLogin.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function createTestCamera(name: string, departmentId: string, cameraType: 'ip' | 'analog') {
    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, departmentId, latitude: 23.0, longitude: 72.0, cameraType });
    return response.body.cameraId;
  }

  it('check-now records a manually-reported status for an analog camera and it appears in history/current', async () => {
    const cameraId = await createTestCamera('E2E Health Camera Analog', DEPARTMENT_A_ID, 'analog');

    const checkResponse = await request(app.getHttpServer())
      .post(`/api/v1/health/${cameraId}/check-now`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'offline' });

    expect(checkResponse.status).toBe(201);
    expect(checkResponse.body.status).toBe('offline');

    const currentResponse = await request(app.getHttpServer())
      .get(`/api/v1/health/${cameraId}/current`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(currentResponse.body.currentStatus).toBe('offline');

    const historyResponse = await request(app.getHttpServer())
      .get(`/api/v1/health/${cameraId}/history`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(historyResponse.body.some((row: any) => row.status === 'offline')).toBe(true);
  });

  it('check-now rejects a missing status for an analog camera with 400', async () => {
    const cameraId = await createTestCamera('E2E Health Camera Analog No Status', DEPARTMENT_A_ID, 'analog');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/health/${cameraId}/check-now`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it('check-now rejects a missing status for an IP camera with no ip_address set', async () => {
    const cameraId = await createTestCamera('E2E Health Camera IP No Address', DEPARTMENT_A_ID, 'ip');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/health/${cameraId}/check-now`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    // No ip_address was ever set on this camera (PATCH /cameras/:id does
    // not expose ip_address as an updatable field), so this exercises the
    // "IP camera with no ip_address" branch, requiring a manual status.
    expect(response.status).toBe(400);
  });

  it("dept_viewer can view history/current for their own department camera, but not another department's", async () => {
    const ownCameraId = await createTestCamera('E2E Health Camera Own Dept', DEPARTMENT_A_ID, 'analog');
    const otherCameraId = await createTestCamera('E2E Health Camera Other Dept', DEPARTMENT_B_ID, 'analog');

    const ownResponse = await request(app.getHttpServer())
      .get(`/api/v1/health/${ownCameraId}/current`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(ownResponse.status).toBe(200);

    const otherResponse = await request(app.getHttpServer())
      .get(`/api/v1/health/${otherCameraId}/current`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(otherResponse.status).toBe(404);
  });

  it('rejects at-risk access for a dept_viewer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/at-risk')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(403);
  });

  it('at-risk lists a camera with 3+ offline check-now events in the trailing window', async () => {
    const cameraId = await createTestCamera('E2E Health Camera At Risk', DEPARTMENT_A_ID, 'analog');

    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post(`/api/v1/health/${cameraId}/check-now`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'offline' });
    }

    const response = await request(app.getHttpServer())
      .get('/api/v1/health/at-risk')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.some((row: any) => row.cameraId === cameraId)).toBe(true);
  });
});
