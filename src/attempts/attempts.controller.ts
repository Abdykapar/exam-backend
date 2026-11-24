import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AttemptsService } from './attempts.service.js';
import {
  JoinExamDto,
  NextQuestionDto,
  SaveAnswersDto,
  StartAttemptDto,
  SubmitAttemptDto,
} from './dto/answers.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import type { JwtUser } from '../common/types.js';
import { clientInfo } from '../proctoring/proctoring.controller.js';

/** Every role can take exams, so there is no @Roles here. */
@ApiTags('attempts')
@ApiBearerAuth()
@Controller()
export class AttemptsController {
  constructor(private service: AttemptsService) {}

  /** Guests enter a password-protected exam with their name; returns a token for this exam only. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('exams/:id/join')
  join(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: JoinExamDto,
  ) {
    return this.service.join(id, dto);
  }

  // Tighter than the default limit: it checks exam passwords
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('exams/:id/start')
  start(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: StartAttemptDto,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.start(id, u, dto.password);
  }

  @Get('attempts')
  list(@CurrentUser() u: JwtUser) {
    return this.service.listMine(u.sub);
  }

  @Get('attempts/:id')
  get(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() u: JwtUser) {
    return this.service.findOne(id, u.sub);
  }

  @Patch('attempts/:id/answers')
  save(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SaveAnswersDto,
    @CurrentUser() u: JwtUser,
    @Req() req: Request,
  ) {
    return this.service.saveAnswers(id, u.sub, dto, clientInfo(req));
  }

  @HttpCode(200)
  @Post('attempts/:id/next')
  next(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: NextQuestionDto,
    @CurrentUser() u: JwtUser,
    @Req() req: Request,
  ) {
    return this.service.next(id, u.sub, dto, clientInfo(req));
  }

  @HttpCode(200)
  @Post('attempts/:id/submit')
  submit(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SubmitAttemptDto,
    @CurrentUser() u: JwtUser,
    @Req() req: Request,
  ) {
    return this.service.submit(id, u.sub, dto, clientInfo(req));
  }
}
