import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let throttlerStorage: ThrottlerStorageService;
  const testEmail = 'e2e-auth-test-user@sentinel.local';
  const testPassword = 'CorrectHorseBatteryStaple123!';

  // This file alone makes more POST /auth/login calls than login's own
  // brute-force throttle (5/60s) allows — a real security control we must
  // not weaken. Clearing the in-memory throttle counter between tests
  // keeps every test isolated from how many logins ran before it, without
  // touching the production limit at all.
  function resetLoginThrottle() {
    throttlerStorage.storage.clear();
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
    // ThrottlerStorageService is registered under the ThrottlerStorage
    // symbol token, not its own class — see @nestjs/throttler's provider.
    throttlerStorage = moduleFixture.get(ThrottlerStorage);

    // Same audit_log FK cleanup as afterAll below, in case a previous run
    // was interrupted before its own cleanup ran.
    const existingUser = await prisma.appUser.findUnique({ where: { email: testEmail } });
    if (existingUser) {
      await prisma.auditLog.deleteMany({ where: { userId: existingUser.userId } });
    }
    await prisma.appUser.deleteMany({ where: { email: testEmail } });
    await prisma.appUser.create({
      data: {
        email: testEmail,
        passwordHash: await bcrypt.hash(testPassword, 10),
        role: 'admin',
      },
    });
  });

  afterAll(async () => {
    // Task 12's AuditLogInterceptor writes audit_log rows referencing this
    // test user's userId on login/logout (audit_log.user_id has a FK to
    // app_user with no cascade — intentionally, so real audit trails are
    // never silently lost). Clean those up first, or deleting the user
    // below violates the FK constraint.
    const testUser = await prisma.appUser.findUnique({ where: { email: testEmail } });
    if (testUser) {
      await prisma.auditLog.deleteMany({ where: { userId: testUser.userId } });
    }
    await prisma.appUser.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  it('rejects login with wrong password', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: 'wrong-password' });

    expect(response.status).toBe(401);
  });

  it('rejects login with unknown email', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody-at-all@sentinel.local', password: testPassword });

    expect(response.status).toBe(401);
  });

  it('logs in successfully and returns an access token and refresh token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
  });

  it('rejects a protected route with no token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/');
    expect(response.status).toBe(401);
  });

  it('completes the full login -> refresh -> logout -> refresh-fails cycle', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    const { refreshToken, accessToken } = loginResponse.body;

    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshResponse.status).toBe(201);
    expect(refreshResponse.body.accessToken).toEqual(expect.any(String));

    // logout is a protected route (not @Public()) — a caller must be
    // authenticated to revoke their own session, so the access token from
    // login is attached here. (Plan text's original test omitted this,
    // which would have made the endpoint's own protection break the test —
    // see ledger ruling for Task 11.)
    const logoutResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });

    expect(logoutResponse.status).toBe(204);

    const refreshAfterLogout = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshAfterLogout.status).toBe(401);
  });

  it('rejects an invalid/garbage refresh token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'this-is-not-a-real-token' });

    expect(response.status).toBe(401);
  });

  it('GET /auth/me returns the current user profile including email', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(testEmail);
    expect(response.body.role).toBe('admin');
  });

  it('GET /auth/me rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
  });

  it('POST /auth/change-password updates the password and revokes existing refresh tokens', async () => {
    const email = 'e2e-change-password@sentinel.local';
    await prisma.appUser.deleteMany({ where: { email } });
    await prisma.appUser.create({
      data: { email, passwordHash: await bcrypt.hash('OldPassword123!', 10), role: 'admin' },
    });

    resetLoginThrottle();
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'OldPassword123!' });
    const { accessToken, refreshToken } = login.body;

    const changeResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword456!' });
    expect(changeResponse.status).toBe(204);

    // The old refresh token must now be dead.
    const refreshAfterChange = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(refreshAfterChange.status).toBe(401);

    // The new password must actually work for a fresh login.
    resetLoginThrottle();
    const reLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'NewPassword456!' });
    expect(reLogin.status).toBe(201);

    const testUser = await prisma.appUser.findUnique({ where: { email } });
    if (testUser) {
      await prisma.auditLog.deleteMany({ where: { userId: testUser.userId } });
    }
    await prisma.appUser.deleteMany({ where: { email } });
  });

  it('POST /auth/change-password rejects an incorrect current password', async () => {
    const email = 'e2e-change-password-wrong@sentinel.local';
    await prisma.appUser.deleteMany({ where: { email } });
    await prisma.appUser.create({
      data: { email, passwordHash: await bcrypt.hash('OldPassword123!', 10), role: 'admin' },
    });
    resetLoginThrottle();
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'OldPassword123!' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: 'WrongPassword', newPassword: 'NewPassword456!' });

    expect(response.status).toBe(401);

    const testUser = await prisma.appUser.findUnique({ where: { email } });
    if (testUser) {
      await prisma.auditLog.deleteMany({ where: { userId: testUser.userId } });
    }
    await prisma.appUser.deleteMany({ where: { email } });
  });
});
