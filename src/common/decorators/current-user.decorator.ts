import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtUser } from '../types.js';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtUser =>
    ctx.switchToHttp().getRequest().user,
);
