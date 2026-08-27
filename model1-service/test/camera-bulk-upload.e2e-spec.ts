import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Camera Bulk Upload (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-bulk-admin@sentinel.local';
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME
  const DEPARTMENT_B_ID = '1de2e83f-ab28-4d0a-8825-05fdc9e008c3'; // RTO

  let adminToken: string;

  async function cleanup() {
    const users = await prisma.appUser.findMany({ where: { email: adminEmail } });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.bulkUploadJob.deleteMany({ where: { createdBy: { in: userIds } } });
    }
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Bulk Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: adminEmail } });
  }

  async function waitForJobCompletion(jobId: string, token: string, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/cameras/bulk/${jobId}`)
        .set('Authorization', `Bearer ${token}`);
      if (response.body.status === 'completed' || response.body.status === 'failed') {
        return response.body;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
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

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('uploads a CSV with mixed valid/invalid rows, processes in the background, and reports correct results', async () => {
    const csvContent = [
      'name,departmentCode,latitude,longitude,cameraType,brand,model,addressText,installedAt',
      'E2E Bulk Camera 1,HOME,23.01,72.51,ip,,,,',
      'E2E Bulk Camera 2,RTO,22.51,71.51,analog,,,,',
      'E2E Bulk Camera Bad Dept,ZZZZ,23.0,72.0,ip,,,,',
      ',HOME,23.0,72.0,ip,,,,', // missing name
    ].join('\n');

    const uploadResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csvContent), 'test-cameras.csv');

    expect(uploadResponse.status).toBe(202);
    expect(uploadResponse.body.jobId).toEqual(expect.any(String));

    const finalStatus = await waitForJobCompletion(uploadResponse.body.jobId, adminToken);

    expect(finalStatus.status).toBe('completed');
    expect(finalStatus.totalRows).toBe(4);
    expect(finalStatus.succeededCount).toBe(2);
    expect(finalStatus.failedCount).toBe(2);
    expect(finalStatus.rowErrors).toHaveLength(2);
    expect(finalStatus.rowErrors.some((e: any) => e.row === 4 && e.error.includes('ZZZZ'))).toBe(
      true,
    );

    const createdCameras = await prisma.camera.findMany({
      where: { name: { in: ['E2E Bulk Camera 1', 'E2E Bulk Camera 2'] } },
    });
    expect(createdCameras).toHaveLength(2);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'create_camera', entityType: 'camera' },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(2);
  });

  it('re-uploading the same CSV updates existing rows instead of creating duplicates', async () => {
    const csvContent = [
      'name,departmentCode,latitude,longitude,cameraType,brand,model,addressText,installedAt',
      'E2E Bulk Camera 1,HOME,25.0,75.0,ip,NewBrand,,,',
    ].join('\n');

    const uploadResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csvContent), 'test-cameras-2.csv');

    const finalStatus = await waitForJobCompletion(uploadResponse.body.jobId, adminToken);
    expect(finalStatus.succeededCount).toBe(1);

    const matchingCameras = await prisma.camera.findMany({
      where: { name: 'E2E Bulk Camera 1' },
    });
    expect(matchingCameras).toHaveLength(1); // still just one, not two
    expect(matchingCameras[0].brand).toBe('NewBrand');

    const updateAuditRows = await prisma.auditLog.findMany({
      where: { action: 'update_camera', entityType: 'camera' },
    });
    expect(updateAuditRows.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a bulk upload for a non-admin/field_officer role', async () => {
    const viewerEmail = 'e2e-bulk-viewer@sentinel.local';
    await prisma.appUser.deleteMany({ where: { email: viewerEmail } });
    await prisma.appUser.create({
      data: {
        email: viewerEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'dept_viewer',
        departmentId: DEPARTMENT_A_ID,
      },
    });
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: viewerEmail, password });

    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras/bulk')
      .set('Authorization', `Bearer ${viewerLogin.body.accessToken}`)
      .attach('file', Buffer.from('name,departmentCode\n'), 'test.csv');

    expect(response.status).toBe(403);

    await prisma.appUser.deleteMany({ where: { email: viewerEmail } });
  });

  it('rejects a CSV with missing required headers before creating any job', async () => {
    const badCsv = 'name,departmentCode\nCamera,HOME\n';

    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(badCsv), 'bad.csv');

    expect(response.status).toBe(400);
  });

  it('returns 404 for a nonexistent job ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras/bulk/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});
