import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttemptsService } from './attempts.service.js';
import { SaveAnswersDto, SubmitAttemptDto } from './dto/answers.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import type { JwtUser } from '../common/types.js';

/** Every role can take exams, so there is no @Roles here. */
@ApiTags('attempts')
@ApiBearerAuth()
@Controller()
export class AttemptsController {
  constructor(private service: AttemptsService) {}

  @HttpCode(200)
  @Post('exams/:id/start')
  start(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.start(id, u.sub);
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
  ) {
    return this.service.saveAnswers(id, u.sub, dto);
  }

  @HttpCode(200)
  @Post('attempts/:id/submit')
  submit(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SubmitAttemptDto,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.submit(id, u.sub, dto);
  }
}
