import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  function makeContext(user: { role: string } | undefined) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows access when no @Roles() decorator is present on the route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = makeContext({ role: 'field_officer' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when the user role is in the required roles list', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin', 'field_officer']);
    const context = makeContext({ role: 'field_officer' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when the user role is not in the required roles list', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = makeContext({ role: 'dept_viewer' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when there is no authenticated user at all', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = makeContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
