import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as
        | string
        | { message?: string | string[] };
      const raw =
        typeof body === 'string' ? body : (body.message ?? exception.message);
      message = Array.isArray(raw) ? raw.join(', ') : raw;
    } else if ((exception as { code?: number })?.code === 11000) {
      status = 409;
      message = 'A record with this value already exists';
    } else {
      this.logger.error(exception);
    }
    res.status(status).json({ success: false, message });
  }
}
