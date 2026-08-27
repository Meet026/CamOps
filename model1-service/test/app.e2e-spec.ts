import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  // As of Task 11, JwtAuthGuard is registered globally, so every route
  // requires a valid JWT unless explicitly marked @Public(). The root
  // AppController route is not public, so an unauthenticated request now
  // correctly gets 401 — this matches auth.e2e-spec.ts's own assertion
  // ("rejects a protected route with no token") for the same route.
  it('/ (GET) requires authentication', () => {
    return request(app.getHttpServer()).get('/').expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
