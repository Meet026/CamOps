import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Server } from 'http';
import { AppModule } from './../src/app.module';

describe('Throttling (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    await app.init();

    // Put the underlying HTTP server into a listening state up front.
    // supertest lazily calls `server.listen(0)` on first use and reads
    // `server.address()` synchronously right after — fine for a single
    // sequential request, but when many `request(...)` calls fire in the
    // same tick (as in the burst test below), they race on that same
    // lazy listen and the losers get connection resets instead of real
    // HTTP responses. Binding the port once here avoids that race.
    await new Promise<void>((resolve) => {
      (app.getHttpServer() as Server).listen(0, resolve);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests under the global limit', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/');
    expect(response.status).not.toBe(429);
  });

  it('returns 429 after exceeding the global per-minute limit on a single route', async () => {
    const requests = Array.from({ length: 105 }, () =>
      request(app.getHttpServer()).get('/api/v1/'),
    );
    const responses = await Promise.all(requests);
    const tooManyRequests = responses.filter((r) => r.status === 429);
    expect(tooManyRequests.length).toBeGreaterThan(0);
  });
});
