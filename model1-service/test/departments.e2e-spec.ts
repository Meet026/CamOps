import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Departments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const email = 'e2e-departments-viewer@sentinel.local';
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await prisma.appUser.deleteMany({ where: { email } });
    await prisma.appUser.create({
      data: { email, passwordHash: await bcrypt.hash(password, 10), role: 'dept_viewer', departmentId: 'c4cedd68-5fca-4a1f-b6bd-b607e0840436' },
    });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await prisma.appUser.deleteMany({ where: { email } });
    await app.close();
  });

  it('returns all departments for any authenticated role, including dept_viewer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/departments')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThanOrEqual(3);
    expect(response.body[0]).toHaveProperty('departmentId');
    expect(response.body[0]).toHaveProperty('name');
    expect(response.body[0]).toHaveProperty('code');
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/departments');
    expect(response.status).toBe(401);
  });
});
