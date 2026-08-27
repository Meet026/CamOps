import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditContextService } from '../context/audit-context.service';

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let prisma: { auditLog: { create: jest.Mock } };
  let reflector: Reflector;
  let auditContext: AuditContextService;

  function makeContext(user: any, correlationId = 'corr-1') {
    // Built once and returned by reference on every getRequest() call, so
    // AuditContextService.setChanges(request, ...) in a test and the
    // interceptor's own request.getRequest() call see the SAME object —
    // matching how a real Express request object works within one request.
    const request = { user, correlationId, body: { email: 'x@y.com' } };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  function makeCallHandler(response: unknown) {
    return { handle: () => of(response) } as CallHandler;
  }

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
    reflector = new Reflector();
    auditContext = new AuditContextService();
    interceptor = new AuditLogInterceptor(
      prisma as unknown as PrismaService,
      reflector,
      auditContext,
    );
  });

  it('writes an audit_log row when the route is decorated with @Audit and the user is known', (done) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue({ action: 'login', entityType: 'app_user' });
    const context = makeContext({ userId: 'user-1' });
    const handler = makeCallHandler({ accessToken: 'abc' });

    interceptor.intercept(context, handler).subscribe(() => {
      setImmediate(() => {
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            userId: 'user-1',
            action: 'login',
            entityType: 'app_user',
            metadata: expect.objectContaining({ correlationId: 'corr-1' }),
          }),
        });
        done();
      });
    });
  });

  it('does nothing when the route has no @Audit metadata', (done) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = makeContext({ userId: 'user-1' });
    const handler = makeCallHandler({ ok: true });

    interceptor.intercept(context, handler).subscribe(() => {
      setImmediate(() => {
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
        done();
      });
    });
  });

  it('writes a row with a null userId for an unauthenticated action (e.g. login itself has no user yet before success)', (done) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue({ action: 'login', entityType: 'app_user' });
    const context = makeContext(undefined);
    const handler = makeCallHandler({ accessToken: 'abc' });

    interceptor.intercept(context, handler).subscribe(() => {
      setImmediate(() => {
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ userId: null }),
        });
        done();
      });
    });
  });

  it('does not block or fail the response if the audit write itself throws', (done) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue({ action: 'login', entityType: 'app_user' });
    prisma.auditLog.create.mockRejectedValue(new Error('db write failed'));
    const context = makeContext({ userId: 'user-1' });
    const handler = makeCallHandler({ accessToken: 'abc' });

    interceptor.intercept(context, handler).subscribe((response) => {
      expect(response).toEqual({ accessToken: 'abc' });
      done();
    });
  });

  it('includes before/after values in metadata when the service method recorded a change', (done) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue({ action: 'update_role', entityType: 'app_user' });
    const context = makeContext({ userId: 'user-1' });
    const request = context.switchToHttp().getRequest();
    auditContext.setChanges(request, { role: 'field_officer' }, { role: 'admin' });
    const handler = makeCallHandler({ userId: 'target-user', role: 'admin' });

    interceptor.intercept(context, handler).subscribe(() => {
      setImmediate(() => {
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              correlationId: 'corr-1',
              before: { role: 'field_officer' },
              after: { role: 'admin' },
            }),
          }),
        });
        done();
      });
    });
  });

  it('omits before/after keys entirely when no change was recorded (e.g. login)', (done) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue({ action: 'login', entityType: 'app_user' });
    const context = makeContext({ userId: 'user-1' });
    const handler = makeCallHandler({ accessToken: 'abc' });

    interceptor.intercept(context, handler).subscribe(() => {
      setImmediate(() => {
        const call = prisma.auditLog.create.mock.calls[0][0];
        expect(call.data.metadata).not.toHaveProperty('before');
        expect(call.data.metadata).not.toHaveProperty('after');
        done();
      });
    });
  });
});
