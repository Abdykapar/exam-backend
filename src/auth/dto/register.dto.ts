import { IsEmail, IsIn, IsString, Length, MinLength } from 'class-validator';
import { Role } from '../../users/schemas/user.schema.js';

export class RegisterDto {
  @IsString() @Length(1, 50) firstName: string;
  @IsString() @Length(1, 50) lastName: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  // Admins are never self-registered; create them via the seed script or the DB
  @IsIn([Role.Student, Role.Instructor]) role: Role;
}
