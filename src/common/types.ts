import type { Role } from '../users/schemas/user.schema.js';

export interface JwtUser {
  sub: string;
  role: Role;
  /** Set for guests: the only exam they may take. */
  exam?: string;
}
