import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    getProfile: jest.Mock;
    changePassword: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getProfile: jest.fn(),
      changePassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get(AuthController);
  });

  it('login delegates to AuthService.login with email and password', async () => {
    authService.login.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    const result = await controller.login({ email: 'x@y.com', password: 'pw' });

    expect(authService.login).toHaveBeenCalledWith('x@y.com', 'pw');
    expect(result).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('refresh delegates to AuthService.refresh with the provided token', async () => {
    authService.refresh.mockResolvedValue({ accessToken: 'new-token' });

    const result = await controller.refresh({ refreshToken: 'old-token' });

    expect(authService.refresh).toHaveBeenCalledWith('old-token');
    expect(result).toEqual({ accessToken: 'new-token' });
  });

  it('logout delegates to AuthService.logout with the provided token', async () => {
    await controller.logout({ refreshToken: 'token-to-revoke' });
    expect(authService.logout).toHaveBeenCalledWith('token-to-revoke');
  });

  it('me delegates to AuthService.getProfile with the current user id', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    const profile = { userId: 'user-1', email: 'admin@sentinel.local', role: 'admin', departmentId: null };
    authService.getProfile.mockResolvedValue(profile);

    const result = await controller.me(currentUser);

    expect(authService.getProfile).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(profile);
  });

  it('changePassword delegates to AuthService.changePassword with the current user id and dto fields', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    const dto = { currentPassword: 'old', newPassword: 'new-password-123' };
    authService.changePassword.mockResolvedValue(undefined);

    await controller.changePassword(currentUser, dto);

    expect(authService.changePassword).toHaveBeenCalledWith('user-1', 'old', 'new-password-123');
  });
});
