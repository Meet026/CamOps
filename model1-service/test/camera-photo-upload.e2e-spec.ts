import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { STORAGE_PROVIDER } from '../src/storage/storage-provider.token';
import { StorageProvider } from '../src/storage/storage-provider.interface';
import { AI_PROVIDER } from '../src/scoring/providers/ai-provider.token';
import { AiProvider } from '../src/scoring/providers/ai-provider.interface';

describe('Camera Photo Upload (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-photo-admin@sentinel.local';
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME

  let adminToken: string;
  let fakeStorageProvider: jest.Mocked<StorageProvider>;
  let fakeAiProvider: jest.Mocked<AiProvider>;

  async function cleanup() {
    const users = await prisma.appUser.findMany({ where: { email: adminEmail } });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Photo Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: adminEmail } });
  }

  beforeAll(async () => {
    fakeStorageProvider = { save: jest.fn() };
    fakeAiProvider = { guessOnvifSupport: jest.fn(), identifyFromPhoto: jest.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(STORAGE_PROVIDER)
      .useValue(fakeStorageProvider)
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

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('uploads a photo, sets camera.photo_url, and the photo is then usable by the OCR lookup endpoint', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Photo Camera 1',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });
    const cameraId = createResponse.body.cameraId;

    fakeStorageProvider.save.mockResolvedValue('https://res.cloudinary.com/fake/cam.jpg');

    const uploadResponse = await request(app.getHttpServer())
      .post(`/api/v1/cameras/${cameraId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('fake image bytes'), 'label.jpg');

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.photoUrl).toBe('https://res.cloudinary.com/fake/cam.jpg');

    fakeAiProvider.identifyFromPhoto.mockResolvedValue({ brand: 'Hikvision', model: 'DS-2CD2143G2-I' });

    const ocrResponse = await request(app.getHttpServer())
      .post('/api/v1/scoring/lookup/photo')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cameraId });

    expect(ocrResponse.status).toBe(201);
    expect(ocrResponse.body.identified).toBe(true);
    expect(ocrResponse.body.brand).toBe('Hikvision');
  });

  it('rejects OCR lookup with 400 when the camera has no photo yet', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Photo Camera No Photo',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });

    const response = await request(app.getHttpServer())
      .post('/api/v1/scoring/lookup/photo')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cameraId: createResponse.body.cameraId });

    expect(response.status).toBe(400);
  });
});
