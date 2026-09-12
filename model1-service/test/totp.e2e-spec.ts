import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('TOTP two-factor authentication (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let throttlerStorage: ThrottlerStorageService;
  const testEmail = 'e2e-totp-test-user@sentinel.local';
  const testPassword = 'CorrectHorseBatteryStaple123!';

  // Same rationale as auth.e2e-spec.ts: this file makes more login/verify
  // calls than the 5/60s brute-force throttle allows across its own tests,
  // and login/totp/verify deliberately share that same throttle tier (both
  // are credential checks). Clearing between tests keeps them isolated
  // without weakening the real production limit.
  function resetLoginThrottle() {
    throttlerStorage.storage.clear();
  }

  async function cleanup() {
    const existingUser = await prisma.appUser.findUnique({ where: { email: testEmail } });
    if (existingUser) {
      await prisma.auditLog.deleteMany({ where: { userId: existingUser.userId } });
      await prisma.totpBackupCode.deleteMany({ where: { userId: existingUser.userId } });
    }
    await prisma.appUser.deleteMany({ where: { email: testEmail } });
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
    throttlerStorage = moduleFixture.get(ThrottlerStorage);

    await cleanup();
    await prisma.appUser.create({
      data: { email: testEmail, passwordHash: await bcrypt.hash(testPassword, 10), role: 'admin' },
    });
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function login(): Promise<string> {
    resetLoginThrottle();
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });
    return response.body.accessToken;
  }

  it('reports 2FA as disabled before any setup has happened', async () => {
    const accessToken = await login();

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/totp/status')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: false, enabledAt: null });
  });

  it('completes the full setup -> confirm -> enabled flow, and rejects a wrong confirm code first', async () => {
    const accessToken = await login();

    const setupResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(setupResponse.status).toBe(201);
    expect(setupResponse.body.secret).toEqual(expect.any(String));
    expect(setupResponse.body.otpauthUrl).toContain('otpauth://totp/');

    const { secret } = setupResponse.body;

    // A wrong code must not enable enforcement.
    const wrongConfirm = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '000000' });
    expect(wrongConfirm.status).toBe(401);

    const statusAfterWrongConfirm = await request(app.getHttpServer())
      .get('/api/v1/auth/totp/status')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(statusAfterWrongConfirm.body.enabled).toBe(false);

    // The real code, generated the same way a real authenticator app would.
    const realCode = authenticator.generate(secret);
    const confirmResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: realCode });

    expect(confirmResponse.status).toBe(201);
    expect(confirmResponse.body.backupCodes).toHaveLength(10);
    expect(new Set(confirmResponse.body.backupCodes).size).toBe(10);

    const statusAfterConfirm = await request(app.getHttpServer())
      .get('/api/v1/auth/totp/status')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(statusAfterConfirm.body.enabled).toBe(true);
    expect(statusAfterConfirm.body.enabledAt).toEqual(expect.any(String));

    // Clean up this test's own enrollment so later tests in this file
    // start from a known "2FA disabled" state again.
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: testPassword });
  });

  it('once enabled, login returns an MFA challenge instead of tokens, and the challenge completes with a real TOTP code', async () => {
    const accessToken = await login();
    const setupResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    const { secret } = setupResponse.body;
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: authenticator.generate(secret) });

    resetLoginThrottle();
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    expect(loginResponse.status).toBe(201);
    expect(loginResponse.body).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
    // Real tokens must never be present alongside a challenge.
    expect(loginResponse.body.accessToken).toBeUndefined();

    const verifyResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/verify')
      .send({ mfaToken: loginResponse.body.mfaToken, code: authenticator.generate(secret) });

    expect(verifyResponse.status).toBe(201);
    expect(verifyResponse.body.accessToken).toEqual(expect.any(String));
    expect(verifyResponse.body.refreshToken).toEqual(expect.any(String));

    // Clean up.
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${verifyResponse.body.accessToken}`)
      .send({ currentPassword: testPassword });
  });

  it('rejects an MFA challenge completed with a wrong code, and never issues tokens', async () => {
    const accessToken = await login();
    const setupResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    const { secret } = setupResponse.body;
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: authenticator.generate(secret) });

    resetLoginThrottle();
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    const verifyResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/verify')
      .send({ mfaToken: loginResponse.body.mfaToken, code: '000000' });

    expect(verifyResponse.status).toBe(401);
    expect(verifyResponse.body.accessToken).toBeUndefined();

    // Clean up — re-authenticate for real to disable.
    resetLoginThrottle();
    const secondLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });
    const cleanupVerify = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/verify')
      .send({ mfaToken: secondLogin.body.mfaToken, code: authenticator.generate(secret) });
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${cleanupVerify.body.accessToken}`)
      .send({ currentPassword: testPassword });
  });

  it('accepts a backup code in place of a TOTP code, and that same code cannot be reused', async () => {
    const accessToken = await login();
    const setupResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    const { secret } = setupResponse.body;
    const confirmResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: authenticator.generate(secret) });
    const [backupCode] = confirmResponse.body.backupCodes;

    resetLoginThrottle();
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    const firstUse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/verify')
      .send({ mfaToken: loginResponse.body.mfaToken, code: backupCode });
    expect(firstUse.status).toBe(201);
    expect(firstUse.body.accessToken).toEqual(expect.any(String));

    // Reusing the same backup code on a fresh login attempt must fail.
    resetLoginThrottle();
    const secondLoginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });
    const secondUse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/verify')
      .send({ mfaToken: secondLoginResponse.body.mfaToken, code: backupCode });
    expect(secondUse.status).toBe(401);

    // Clean up.
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${firstUse.body.accessToken}`)
      .send({ currentPassword: testPassword });
  });

  it('disable requires the current password, and clears enforcement + backup codes on success', async () => {
    const accessToken = await login();
    const setupResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    const { secret } = setupResponse.body;
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: authenticator.generate(secret) });

    const wrongPasswordDisable = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'wrong-password' });
    expect(wrongPasswordDisable.status).toBe(401);

    const statusStillEnabled = await request(app.getHttpServer())
      .get('/api/v1/auth/totp/status')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(statusStillEnabled.body.enabled).toBe(true);

    const correctPasswordDisable = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: testPassword });
    expect(correctPasswordDisable.status).toBe(204);

    const statusAfterDisable = await request(app.getHttpServer())
      .get('/api/v1/auth/totp/status')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(statusAfterDisable.body).toEqual({ enabled: false, enabledAt: null });

    // Login must go back to the plain (non-MFA) flow immediately.
    resetLoginThrottle();
    const loginAfterDisable = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });
    expect(loginAfterDisable.body.accessToken).toEqual(expect.any(String));
    expect(loginAfterDisable.body.mfaRequired).toBeUndefined();
  });

  it('regenerating backup codes requires the current password and invalidates the old codes', async () => {
    const accessToken = await login();
    const setupResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    const { secret } = setupResponse.body;
    const confirmResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: authenticator.generate(secret) });
    const [oldBackupCode] = confirmResponse.body.backupCodes;

    const wrongPasswordRegenerate = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/backup-codes/regenerate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'wrong-password' });
    expect(wrongPasswordRegenerate.status).toBe(401);

    const regenerateResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/backup-codes/regenerate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: testPassword });
    expect(regenerateResponse.status).toBe(201);
    expect(regenerateResponse.body.backupCodes).toHaveLength(10);
    expect(regenerateResponse.body.backupCodes).not.toContain(oldBackupCode);

    // The old backup code must no longer work.
    resetLoginThrottle();
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });
    const oldCodeAttempt = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/verify')
      .send({ mfaToken: loginResponse.body.mfaToken, code: oldBackupCode });
    expect(oldCodeAttempt.status).toBe(401);

    // But a NEW code from the regenerated batch works.
    resetLoginThrottle();
    const secondLoginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });
    const newCodeAttempt = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/verify')
      .send({ mfaToken: secondLoginResponse.body.mfaToken, code: regenerateResponse.body.backupCodes[0] });
    expect(newCodeAttempt.status).toBe(201);

    // Clean up.
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${newCodeAttempt.body.accessToken}`)
      .send({ currentPassword: testPassword });
  });

  it('records real audit_log entries for enable and disable', async () => {
    const accessToken = await login();
    const setupResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    const { secret } = setupResponse.body;
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: authenticator.generate(secret) });
    await request(app.getHttpServer())
      .post('/api/v1/auth/totp/disable')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: testPassword });

    // The audit write is fire-and-forget — poll briefly rather than
    // reading once immediately, same pattern as the existing audit specs.
    const user = await prisma.appUser.findUnique({ where: { email: testEmail } });
    let enableRow: unknown = null;
    let disableRow: unknown = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      enableRow = await prisma.auditLog.findFirst({
        where: { userId: user!.userId, action: 'enable_totp' },
      });
      disableRow = await prisma.auditLog.findFirst({
        where: { userId: user!.userId, action: 'disable_totp' },
      });
      if (enableRow && disableRow) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(enableRow).not.toBeNull();
    expect(disableRow).not.toBeNull();
  });
});
