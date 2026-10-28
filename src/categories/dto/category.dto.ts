import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString() @Length(2, 50) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsString() @MaxLength(8) emoji?: string;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
