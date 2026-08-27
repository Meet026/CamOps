import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/livez (GET) returns 200 with status ok when the database is reachable', async () => {
    const response = await request(app.getHttpServer()).get('/livez');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBe('ok');
  });

  it('/livez (GET) does not require authentication', async () => {
    const response = await request(app.getHttpServer()).get('/livez');
    expect(response.status).not.toBe(401);
  });
});
