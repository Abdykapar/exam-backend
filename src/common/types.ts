import type { Role } from '../users/schemas/user.schema.js';

export interface JwtUser {
  sub: string;
  role: Role;
}
