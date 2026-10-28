import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExamsService } from './exams.service.js';
import { CreateExamDto, ListExamsQueryDto, UpdateExamDto } from './dto/exam.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { Role } from '../users/schemas/user.schema.js';
import type { JwtUser } from '../common/types.js';

@ApiTags('exams')
@ApiBearerAuth()
@Controller()
export class ExamsController {
  constructor(private service: ExamsService) {}

  @Public()
  @Get('exams')
  list(@Query() q: ListExamsQueryDto) {
    return this.service.listPublished(q);
  }

  @Public()
  @Get('exams/:id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.getPublished(id);
  }

  @Roles(Role.Instructor, Role.Admin)
  @Get('instructor/exams')
  mine(@CurrentUser() u: JwtUser) {
    return this.service.listMine(u);
  }

  @Roles(Role.Instructor, Role.Admin)
  @Get('instructor/exams/:id')
  getForEdit(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.getForEdit(id, u);
  }

  @Roles(Role.Instructor, Role.Admin)
  @Post('exams')
  create(@Body() dto: CreateExamDto, @CurrentUser() u: JwtUser) {
    return this.service.create(dto, u);
  }

  @Roles(Role.Instructor, Role.Admin)
  @Patch('exams/:id')
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateExamDto,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.update(id, dto, u);
  }

  @Roles(Role.Instructor, Role.Admin)
  @Delete('exams/:id')
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.remove(id, u);
  }

  @Roles(Role.Instructor, Role.Admin)
  @HttpCode(200)
  @Post('exams/:id/publish')
  publish(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.setPublished(id, u, true);
  }

  @Roles(Role.Instructor, Role.Admin)
  @HttpCode(200)
  @Post('exams/:id/unpublish')
  unpublish(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.setPublished(id, u, false);
  }
}
