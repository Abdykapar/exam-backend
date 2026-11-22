import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { map } from 'rxjs';

/** Controllers return `{ data }` (or `{ token, data }`); this adds `success: true`. Files pass through untouched. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(
        map((body: unknown) =>
          body instanceof StreamableFile || body === null || typeof body !== 'object'
            ? body
            : { success: true, ...body },
        ),
      );
  }
}
