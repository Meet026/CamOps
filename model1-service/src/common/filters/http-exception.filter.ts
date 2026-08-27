import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
  correlationId?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = request?.correlationId;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        message = (bodyObj.message as string | string[]) ?? exception.message;
        error = (bodyObj.error as string) ?? error;
      }
      if (statusCode >= 500) {
        error = 'Internal Server Error';
      } else {
        error = HttpStatus[statusCode] ?? error;
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled exception [${correlationId}]: ${exception.message}`,
        exception.stack,
      );
    }

    const responseBody: ErrorResponseBody = {
      statusCode,
      message,
      error,
      correlationId,
    };

    response.status(statusCode).json(responseBody);
  }
}
