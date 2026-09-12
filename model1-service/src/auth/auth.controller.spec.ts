import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuditContextService } from '../common/context/audit-context.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    login: jest.Mock;
    verifyTotpLogin: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    getProfile: jest.Mock;
    changePassword: jest.Mock;
    setupTotp: jest.Mock;
    confirmTotp: jest.Mock;
    disableTotp: jest.Mock;
    regenerateBackupCodes: jest.Mock;
    getTotpStatus: jest.Mock;
  };
  let auditContext: { setChanges: jest.Mock };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      verifyTotpLogin: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getProfile: jest.fn(),
      changePassword: jest.fn(),
      setupTotp: jest.fn(),
      confirmTotp: jest.fn(),
      disableTotp: jest.fn(),
      regenerateBackupCodes: jest.fn(),
      getTotpStatus: jest.fn(),
    };
    auditContext = { setChanges: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AuditContextService, useValue: auditContext },
      ],
    }).compile();

    controller = module.get(AuthController);
  });

  it('login delegates to AuthService.login with email and password, and never leaks userId into the response body', async () => {
    authService.login.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', userId: 'user-1' });
    const fakeRequest = {} as Request;

    const result = await controller.login(fakeRequest, { email: 'x@y.com', password: 'pw' });

    expect(authService.login).toHaveBeenCalledWith('x@y.com', 'pw');
    expect(result).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('login records the logged-in user as the audit entityId, for attribution on this @Public() route', async () => {
    authService.login.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', userId: 'user-1' });
    const fakeRequest = {} as Request;

    await controller.login(fakeRequest, { email: 'x@y.com', password: 'pw' });

    expect(auditContext.setChanges).toHaveBeenCalledWith(fakeRequest, {}, {}, 'user-1');
  });

  it('login stamps request.user with the logged-in userId, so AuditLogInterceptor records the real actor (not null) in audit_log.user_id', async () => {
    authService.login.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', userId: 'user-1' });
    const fakeRequest = {} as Request;

    await controller.login(fakeRequest, { email: 'x@y.com', password: 'pw' });

    expect((fakeRequest as any).user).toEqual({ userId: 'user-1' });
  });

  it('login returns an MFA challenge (not tokens) when AuthService.login says 2FA is required, still stamping the actor for audit', async () => {
    authService.login.mockResolvedValue({
      mfaRequired: true,
      mfaToken: 'challenge-token',
      userId: 'user-1',
    });
    const fakeRequest = {} as Request;

    const result = await controller.login(fakeRequest, { email: 'x@y.com', password: 'pw' });

    expect(result).toEqual({ mfaRequired: true, mfaToken: 'challenge-token' });
    expect((fakeRequest as any).user).toEqual({ userId: 'user-1' });
    expect(auditContext.setChanges).toHaveBeenCalledWith(fakeRequest, {}, {}, 'user-1');
  });

  it('verifyTotp delegates to AuthService.verifyTotpLogin and returns real tokens', async () => {
    authService.verifyTotpLogin.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', userId: 'user-1' });
    const fakeRequest = {} as Request;

    const result = await controller.verifyTotp(fakeRequest, { mfaToken: 'challenge-token', code: '123456' });

    expect(authService.verifyTotpLogin).toHaveBeenCalledWith('challenge-token', '123456');
    expect(result).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect((fakeRequest as any).user).toEqual({ userId: 'user-1' });
    expect(auditContext.setChanges).toHaveBeenCalledWith(fakeRequest, {}, {}, 'user-1');
  });

  it('refresh delegates to AuthService.refresh with the provided token', async () => {
    authService.refresh.mockResolvedValue({ accessToken: 'new-token' });

    const result = await controller.refresh({ refreshToken: 'old-token' });

    expect(authService.refresh).toHaveBeenCalledWith('old-token');
    expect(result).toEqual({ accessToken: 'new-token' });
  });

  it('logout delegates to AuthService.logout with the provided token, and records entityId as the current user', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    const fakeRequest = {} as Request;

    await controller.logout(fakeRequest, { refreshToken: 'token-to-revoke' }, currentUser);

    expect(authService.logout).toHaveBeenCalledWith('token-to-revoke');
    expect(auditContext.setChanges).toHaveBeenCalledWith(fakeRequest, {}, {}, 'user-1');
  });

  it('me delegates to AuthService.getProfile with the current user id', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    const profile = { userId: 'user-1', email: 'admin@sentinel.local', role: 'admin', departmentId: null };
    authService.getProfile.mockResolvedValue(profile);

    const result = await controller.me(currentUser);

    expect(authService.getProfile).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(profile);
  });

  it('changePassword delegates to AuthService.changePassword with the current user id and dto fields, and records entityId', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    const dto = { currentPassword: 'old', newPassword: 'new-password-123' };
    const fakeRequest = {} as Request;
    authService.changePassword.mockResolvedValue(undefined);

    await controller.changePassword(fakeRequest, currentUser, dto);

    expect(authService.changePassword).toHaveBeenCalledWith('user-1', 'old', 'new-password-123');
    expect(auditContext.setChanges).toHaveBeenCalledWith(fakeRequest, {}, {}, 'user-1');
  });

  it('totpSetup delegates to AuthService.setupTotp with the current user id', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    authService.setupTotp.mockResolvedValue({ secret: 'SECRET', otpauthUrl: 'otpauth://...' });

    const result = await controller.totpSetup(currentUser);

    expect(authService.setupTotp).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ secret: 'SECRET', otpauthUrl: 'otpauth://...' });
  });

  it('totpConfirm delegates to AuthService.confirmTotp and records entityId', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    const fakeRequest = {} as Request;
    authService.confirmTotp.mockResolvedValue({ backupCodes: ['AAAA-1111'] });

    const result = await controller.totpConfirm(fakeRequest, currentUser, { code: '123456' });

    expect(authService.confirmTotp).toHaveBeenCalledWith('user-1', '123456');
    expect(result).toEqual({ backupCodes: ['AAAA-1111'] });
    expect(auditContext.setChanges).toHaveBeenCalledWith(fakeRequest, {}, {}, 'user-1');
  });

  it('totpDisable delegates to AuthService.disableTotp and records entityId', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    const fakeRequest = {} as Request;
    authService.disableTotp.mockResolvedValue(undefined);

    await controller.totpDisable(fakeRequest, currentUser, { currentPassword: 'pw' });

    expect(authService.disableTotp).toHaveBeenCalledWith('user-1', 'pw');
    expect(auditContext.setChanges).toHaveBeenCalledWith(fakeRequest, {}, {}, 'user-1');
  });

  it('totpRegenerateBackupCodes delegates to AuthService.regenerateBackupCodes and records entityId', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    const fakeRequest = {} as Request;
    authService.regenerateBackupCodes.mockResolvedValue({ backupCodes: ['BBBB-2222'] });

    const result = await controller.totpRegenerateBackupCodes(fakeRequest, currentUser, { currentPassword: 'pw' });

    expect(authService.regenerateBackupCodes).toHaveBeenCalledWith('user-1', 'pw');
    expect(result).toEqual({ backupCodes: ['BBBB-2222'] });
    expect(auditContext.setChanges).toHaveBeenCalledWith(fakeRequest, {}, {}, 'user-1');
  });

  it('totpStatus delegates to AuthService.getTotpStatus with the current user id', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    authService.getTotpStatus.mockResolvedValue({ enabled: true, enabledAt: new Date('2026-09-01') });

    const result = await controller.totpStatus(currentUser);

    expect(authService.getTotpStatus).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ enabled: true, enabledAt: new Date('2026-09-01') });
  });
});
