import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AI_PROVIDER } from '../src/scoring/providers/ai-provider.token';
import { AiProvider } from '../src/scoring/providers/ai-provider.interface';

describe('Scoring (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-scoring-admin@sentinel.local';
  const officerEmail = 'e2e-scoring-officer@sentinel.local';
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME

  let adminToken: string;
  let officerToken: string;
  let fakeAiProvider: jest.Mocked<AiProvider>;

  async function cleanup() {
    const users = await prisma.appUser.findMany({
      where: { email: { in: [adminEmail, officerEmail] } },
    });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    const cameras = await prisma.camera.findMany({ where: { name: { startsWith: 'E2E Scoring Camera' } } });
    const cameraIds = cameras.map((c) => c.cameraId);
    if (cameraIds.length > 0) {
      await prisma.scoringVerification.deleteMany({ where: { cameraId: { in: cameraIds } } });
    }
    await prisma.vendorLookup.deleteMany({ where: { brand: 'E2ETestBrand' } });
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Scoring Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, officerEmail] } } });
  }

  beforeAll(async () => {
    fakeAiProvider = {
      guessOnvifSupport: jest.fn(),
      identifyFromPhoto: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_PROVIDER)
      .useValue(fakeAiProvider)
      .compile();

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
      data: { email: officerEmail, passwordHash: await bcrypt.hash(password, 10), role: 'field_officer' },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;

    const officerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: officerEmail, password });
    officerToken = officerLogin.body.accessToken;
  });

  afterEach(() => {
    fakeAiProvider.guessOnvifSupport.mockReset();
    fakeAiProvider.identifyFromPhoto.mockReset();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function createTestCamera(name: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, departmentId: DEPARTMENT_A_ID, latitude: 23.0, longitude: 72.0, cameraType: 'ip' });
    return response.body.cameraId;
  }

  it('uses the vendor_lookup fast path when a matching row exists, without calling the AI provider', async () => {
    await prisma.vendorLookup.create({
      data: { brand: 'E2ETestBrand', modelPattern: 'FastPath%', onvifStatus: 'yes', sdkAvailable: true },
    });
    const cameraId = await createTestCamera('E2E Scoring Camera Fast Path');

    const response = await request(app.getHttpServer())
      .post('/api/v1/scoring/lookup')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ cameraId, brand: 'E2ETestBrand', model: 'FastPath-100' });

    expect(response.status).toBe(201);
    expect(response.body.onvifStatus).toBe('yes');
    expect(response.body.integrationScore).toBe('easy');
    expect(response.body.onvifSource).toBe('lookup_table');
    expect(fakeAiProvider.guessOnvifSupport).not.toHaveBeenCalled();
  });

  it('falls back to the AI provider and creates a pending verification when no vendor_lookup match exists', async () => {
    const cameraId = await createTestCamera('E2E Scoring Camera AI Path');
    fakeAiProvider.guessOnvifSupport.mockResolvedValue({ onvifSupported: 'no', reasoning: 'Not a known ONVIF line' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/scoring/lookup')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ cameraId, brand: 'SomeUnknownBrand', model: 'X1' });

    expect(response.status).toBe(201);
    expect(response.body.onvifStatus).toBe('no');
    expect(response.body.onvifSource).toBe('ai_guess');

    const pending = await prisma.scoringVerification.findMany({ where: { cameraId } });
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
  });

  it('admin can list pending verifications and confirm one, writing a new vendor_lookup row', async () => {
    const cameraId = await createTestCamera('E2E Scoring Camera Confirm Flow');
    fakeAiProvider.guessOnvifSupport.mockResolvedValue({ onvifSupported: 'yes', reasoning: 'Confident guess' });
    await request(app.getHttpServer())
      .post('/api/v1/scoring/lookup')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ cameraId, brand: 'E2ETestBrand', model: 'ConfirmFlow-1' });

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/scoring/pending-verification')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    const entry = listResponse.body.find((v: any) => v.cameraId === cameraId);
    expect(entry).toBeDefined();

    const verifyResponse = await request(app.getHttpServer())
      .post(`/api/v1/scoring/verify/${entry.verificationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'confirm', finalOnvifStatus: 'yes' });

    expect(verifyResponse.status).toBe(201);
    expect(verifyResponse.body.status).toBe('confirmed');

    const camera = await prisma.camera.findUnique({ where: { cameraId } });
    expect(camera?.onvifSource).toBe('user_confirmed');

    const vendorLookupRow = await prisma.vendorLookup.findFirst({
      where: { brand: 'E2ETestBrand', modelPattern: 'ConfirmFlow-1' },
    });
    expect(vendorLookupRow).toBeDefined();
    expect(vendorLookupRow?.source).toBe('ai_verified');
  });

  it('rejects pending-verification list access for a field_officer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/scoring/pending-verification')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(403);
  });

  it('GET /scoring/vendor-lookup/brands returns distinct known brands', async () => {
    await prisma.vendorLookup.create({
      data: { brand: 'E2ETestBrandUnique', modelPattern: 'X%', onvifStatus: 'yes', sdkAvailable: true },
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/scoring/vendor-lookup/brands')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toContain('E2ETestBrandUnique');

    await prisma.vendorLookup.deleteMany({ where: { brand: 'E2ETestBrandUnique' } });
  });
});
