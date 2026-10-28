import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Route works without a token; if a valid token is sent, req.user is still set. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
