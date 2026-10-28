import { IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() @Length(1, 50) firstName?: string;
  @IsOptional() @IsString() @Length(1, 50) lastName?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
  @IsOptional() @IsUrl() avatar?: string;
}
