import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('GIS (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-gis-admin@sentinel.local';
  const viewerEmail = 'e2e-gis-viewer@sentinel.local';
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
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E GIS Camera' } } });
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

    // Two cameras inside the test bounding box (20.0-22.0 lat, 70.0-72.0 lng):
    // one per department, at known coordinates for grid-cell assertions.
    await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E GIS Camera Inside A',
        departmentId: DEPARTMENT_A_ID,
        latitude: 20.5,
        longitude: 70.5,
        cameraType: 'ip',
      });
    await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E GIS Camera Inside B',
        departmentId: DEPARTMENT_B_ID,
        latitude: 20.5,
        longitude: 70.5,
        cameraType: 'ip',
      });
    // Outside the test bounding box entirely.
    await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E GIS Camera Outside',
        departmentId: DEPARTMENT_A_ID,
        latitude: 30.0,
        longitude: 80.0,
        cameraType: 'ip',
      });
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('cameras-in-bounds returns only cameras inside the box, excluding ones outside it', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/cameras-in-bounds')
      .query({ minLat: 20.0, minLng: 70.0, maxLat: 22.0, maxLng: 72.0 })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const names = response.body.map((pin: any) => pin.name);
    expect(names).toContain('E2E GIS Camera Inside A');
    expect(names).toContain('E2E GIS Camera Inside B');
    expect(names).not.toContain('E2E GIS Camera Outside');
  });

  it("cameras-in-bounds scopes results to a dept_viewer's own department", async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/cameras-in-bounds')
      .query({ minLat: 20.0, minLng: 70.0, maxLat: 22.0, maxLng: 72.0 })
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(200);
    const names = response.body.map((pin: any) => pin.name);
    expect(names).toContain('E2E GIS Camera Inside A');
    expect(names).not.toContain('E2E GIS Camera Inside B');
  });

  it('cameras-in-bounds rejects an inverted bounding box with 400', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/cameras-in-bounds')
      .query({ minLat: 22.0, minLng: 70.0, maxLat: 20.0, maxLng: 72.0 })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });

  it('gap-analysis flags empty cells and excludes the occupied one', async () => {
    // 2x2 grid over 20.0-22.0/70.0-72.0: both test cameras sit at
    // (20.5, 70.5), which falls in the same cell (0,0) — the other 3
    // cells should be reported as gaps.
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/gap-analysis')
      .query({ minLat: 20.0, minLng: 70.0, maxLat: 22.0, maxLng: 72.0, gridSize: 2 })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.gridSize).toBe(2);
    expect(response.body.gaps).toHaveLength(3);
  });

  it('gap-analysis rejects a dept_viewer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/gap-analysis')
      .query({ minLat: 20.0, minLng: 70.0, maxLat: 22.0, maxLng: 72.0 })
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(403);
  });

  it('heatmap returns beta-flagged static sample points', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/heatmap')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.beta).toBe(true);
    expect(response.body.points.length).toBeGreaterThan(0);
  });

  it('heatmap rejects a dept_viewer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/gis/heatmap')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(403);
  });
});
