import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  function makeHost(correlationId = 'test-correlation-id') {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const getResponse = jest.fn().mockReturnValue({ status });
    const getRequest = jest.fn().mockReturnValue({ correlationId });
    const host = {
      switchToHttp: () => ({ getResponse, getRequest }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  }

  it('formats an HttpException with its own status code and message', () => {
    const { host, status, json } = makeHost();
    const exception = new BadRequestException(
      'latitude must be between -90 and 90',
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'latitude must be between -90 and 90',
        correlationId: 'test-correlation-id',
      }),
    );
  });

  it('formats an unknown thrown error as a 500 without leaking its stack trace', () => {
    const { host, status, json } = makeHost();
    const exception = new Error(
      'database connection pool exhausted at internal-host:5432',
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const payload = json.mock.calls[0][0];
    expect(payload.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(payload.message).toBe('Internal server error');
    expect(JSON.stringify(payload)).not.toContain('internal-host');
    expect(payload).not.toHaveProperty('stack');
  });

  it('includes the correlation ID from the request even on a generic error', () => {
    const { host, json } = makeHost('abc-123');
    filter.catch(new Error('boom'), host);
    expect(json.mock.calls[0][0].correlationId).toBe('abc-123');
  });
});
