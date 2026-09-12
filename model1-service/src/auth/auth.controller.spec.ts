import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuditContextService } from '../common/context/audit-context.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    getProfile: jest.Mock;
    changePassword: jest.Mock;
  };
  let auditContext: { setChanges: jest.Mock };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getProfile: jest.fn(),
      changePassword: jest.fn(),
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
});
