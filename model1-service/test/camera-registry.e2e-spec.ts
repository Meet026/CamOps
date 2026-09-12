import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { waitForAuditWritesToSettle } from './wait-for-audit-writes';

describe('Camera Registry (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-camera-admin@sentinel.local';
  const deptAViewerEmail = 'e2e-camera-deptA-viewer@sentinel.local';

  // Real department_id values from the live sentinel_model1_db (HOME, RTO).
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME
  const DEPARTMENT_B_ID = '1de2e83f-ab28-4d0a-8825-05fdc9e008c3'; // RTO

  let adminToken: string;
  let deptAViewerToken: string;
  let createdCameraIdInDeptB: string;

  // The audit log write is fire-and-forget (AuditLogInterceptor never awaits
  // it, by design — see writeAuditLogEntry) so it can still be in flight
  // against the live DB the instant supertest's response resolves. Poll
  // briefly rather than reading once immediately after the HTTP call.
  async function waitForAuditRow(
    where: Parameters<PrismaService['auditLog']['findFirst']>[0]['where'],
  ) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const row = await prisma.auditLog.findFirst({ where, orderBy: { createdAt: 'desc' } });
      if (row) return row;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  async function cleanup() {
    const users = await prisma.appUser.findMany({
      where: { email: { in: [adminEmail, deptAViewerEmail] } },
    });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Test Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, deptAViewerEmail] } } });
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
        email: deptAViewerEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'dept_viewer',
        departmentId: DEPARTMENT_A_ID,
      },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;

    const deptAViewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: deptAViewerEmail, password });
    deptAViewerToken = deptAViewerLogin.body.accessToken;
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

  it('completes the full create -> list -> get -> update -> soft-delete lifecycle', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Test Camera Lifecycle',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0225,
        longitude: 72.5714,
        cameraType: 'ip',
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.latitude).toBe(23.0225);
    expect(createResponse.body.longitude).toBe(72.5714);
    expect(createResponse.body.integrationScore).toBe('needs_verification');
    const cameraId = createResponse.body.cameraId;

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((c: any) => c.cameraId === cameraId)).toBe(true);

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.name).toBe('E2E Test Camera Lifecycle');

    const updateResponse = await request(app.getHttpServer())
      .patch(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'E2E Test Camera Renamed', latitude: 24.0, longitude: 73.0 });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.name).toBe('E2E Test Camera Renamed');
    expect(updateResponse.body.latitude).toBe(24.0);
    expect(updateResponse.body.longitude).toBe(73.0);

    // Scoped by entityId (now populated — see writeAuditLogEntry), not just
    // action/entityType: without this, a concurrently-running e2e spec's own
    // update_camera row can be the most recent one and this assertion would
    // flakily check the wrong camera's audit entry.
    const auditRow = await waitForAuditRow({
      action: 'update_camera',
      entityType: 'camera',
      entityId: cameraId,
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow!.metadata).toMatchObject({
      before: { name: 'E2E Test Camera Lifecycle' },
      after: { name: 'E2E Test Camera Renamed' },
    });

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteResponse.status).toBe(204);

    const listAfterDeleteActiveOnly = await request(app.getHttpServer())
      .get('/api/v1/cameras?isActive=true')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAfterDeleteActiveOnly.body.some((c: any) => c.cameraId === cameraId)).toBe(false);

    const listAfterDeleteUnfiltered = await request(app.getHttpServer())
      .get('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`);
    const deletedCamera = listAfterDeleteUnfiltered.body.find((c: any) => c.cameraId === cameraId);
    expect(deletedCamera).toBeDefined();
    expect(deletedCamera.isActive).toBe(false);
  });

  it('PATCH /cameras/:id can set ipAddress, rtspPort, and streamPath, readable back via GET', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Test Camera Network Fields',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });
    expect(createResponse.status).toBe(201);
    const cameraId = createResponse.body.cameraId;

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ipAddress: '10.0.0.5', rtspPort: 554, streamPath: '/stream1' });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.ipAddress).toBe('10.0.0.5');
    expect(patchResponse.body.rtspPort).toBe(554);
    expect(patchResponse.body.streamPath).toBe('/stream1');

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getResponse.body.ipAddress).toBe('10.0.0.5');
    expect(getResponse.body.rtspPort).toBe(554);
    expect(getResponse.body.streamPath).toBe('/stream1');

    await request(app.getHttpServer())
      .delete(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });

  it('GET /cameras?search= filters by name substring', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Test Camera Searchable Unique',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });
    expect(createResponse.status).toBe(201);

    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras?search=Searchable Unique')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.some((c: any) => c.name === 'E2E Test Camera Searchable Unique')).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/v1/cameras/${createResponse.body.cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });

  it('prevents a dept_viewer from seeing or fetching a camera in a different department', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Test Camera Dept B Only',
        departmentId: DEPARTMENT_B_ID,
        latitude: 22.0,
        longitude: 71.0,
        cameraType: 'analog',
      });
    expect(createResponse.status).toBe(201);
    createdCameraIdInDeptB = createResponse.body.cameraId;

    const listAsDeptAViewer = await request(app.getHttpServer())
      .get('/api/v1/cameras')
      .set('Authorization', `Bearer ${deptAViewerToken}`);
    expect(listAsDeptAViewer.status).toBe(200);
    expect(
      listAsDeptAViewer.body.some((c: any) => c.cameraId === createdCameraIdInDeptB),
    ).toBe(false);

    const getAsDeptAViewer = await request(app.getHttpServer())
      .get(`/api/v1/cameras/${createdCameraIdInDeptB}`)
      .set('Authorization', `Bearer ${deptAViewerToken}`);
    expect(getAsDeptAViewer.status).toBe(404);

    const updateAsDeptAViewer = await request(app.getHttpServer())
      .patch(`/api/v1/cameras/${createdCameraIdInDeptB}`)
      .set('Authorization', `Bearer ${deptAViewerToken}`)
      .send({ name: 'Attempted Hijack' });
    // dept_viewer isn't in the PATCH allowlist (admin, field_officer only)
    // — RolesGuard rejects before the service's own 404 scoping ever runs.
    expect(updateAsDeptAViewer.status).toBe(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/cameras/${createdCameraIdInDeptB}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });

  it('rejects camera creation for a non-admin/field_officer role', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${deptAViewerToken}`)
      .send({
        name: 'E2E Test Camera Should Not Be Created',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });

    expect(response.status).toBe(403);
  });

  it('rejects a departmentId that does not correspond to a real department', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Test Camera Bad Department',
        departmentId: '00000000-0000-0000-0000-000000000000',
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });

    expect(response.status).toBe(400);
  });
});
