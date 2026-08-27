import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  function makeContext() {
    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  it('bypasses authentication (returns true) when the route is marked @Public()', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = makeContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('delegates to the parent AuthGuard when the route is not public', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = makeContext();
    const parentCanActivateSpy = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(true);

    const result = guard.canActivate(context);

    expect(parentCanActivateSpy).toHaveBeenCalled();
    expect(result).toBe(true);
    parentCanActivateSpy.mockRestore();
  });
});
