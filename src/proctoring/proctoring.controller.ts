import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ProctoringService, type ClientInfo } from './proctoring.service.js';
import { HeartbeatDto, ReportViolationDto } from './dto/proctoring.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { Role } from '../users/schemas/user.schema.js';
import type { JwtUser } from '../common/types.js';

export const clientInfo = (req: Request): ClientInfo => ({
  ip: req.ip,
  userAgent: req.get('user-agent')?.slice(0, 500),
});

@ApiTags('proctoring')
@ApiBearerAuth()
@Controller()
export class ProctoringController {
  constructor(private service: ProctoringService) {}

  @HttpCode(200)
  @Post('exam/violation')
  report(
    @Body() dto: ReportViolationDto,
    @CurrentUser() u: JwtUser,
    @Req() req: Request,
  ) {
    return this.service.report(u.sub, dto, clientInfo(req));
  }

  @HttpCode(200)
  @Post('exam/heartbeat')
  heartbeat(
    @Body() dto: HeartbeatDto,
    @CurrentUser() u: JwtUser,
    @Req() req: Request,
  ) {
    return this.service.heartbeat(u.sub, dto, clientInfo(req));
  }

  @Roles(Role.Instructor, Role.Admin)
  @Get('instructor/exams/:id/attempts')
  attempts(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.listAttempts(id, u);
  }

  @Roles(Role.Instructor, Role.Admin)
  @Get('instructor/attempts/:id/violations')
  violations(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.attemptViolations(id, u);
  }
}
