import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { Request, Response } from 'express';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  function makeReqRes(headers: Record<string, string> = {}) {
    const req = { headers } as unknown as Request;
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    return { req, res, setHeader };
  }

  it('generates a new correlation ID when none is provided', () => {
    const { req, res, setHeader } = makeReqRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect((req as any).correlationId).toEqual(expect.any(String));
    expect((req as any).correlationId.length).toBeGreaterThan(0);
    expect(setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      (req as any).correlationId,
    );
    expect(next).toHaveBeenCalled();
  });

  it('reuses an incoming x-correlation-id header instead of generating a new one', () => {
    const { req, res, setHeader } = makeReqRes({
      'x-correlation-id': 'existing-id-123',
    });
    const next = jest.fn();

    middleware.use(req, res, next);

    expect((req as any).correlationId).toBe('existing-id-123');
    expect(setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      'existing-id-123',
    );
    expect(next).toHaveBeenCalled();
  });
});
