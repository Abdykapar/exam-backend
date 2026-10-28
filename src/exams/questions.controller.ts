import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { QuestionsService } from './questions.service.js';
import {
  BulkQuestionsDto,
  QuestionDto,
  ReorderQuestionsDto,
  UpdateQuestionDto,
} from './dto/question.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe.js';
import { Role } from '../users/schemas/user.schema.js';
import type { JwtUser } from '../common/types.js';

@ApiTags('questions')
@ApiBearerAuth()
@Roles(Role.Instructor, Role.Admin)
@Controller('exams/:id/questions')
export class QuestionsController {
  constructor(private service: QuestionsService) {}

  @Post()
  add(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: QuestionDto,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.add(id, dto, u);
  }

  @Post('bulk')
  bulk(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: BulkQuestionsDto,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.bulk(id, dto.questions, u);
  }

  @Put('reorder')
  reorder(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ReorderQuestionsDto,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.reorder(id, dto.order, u);
  }

  @Patch(':qid')
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('qid', ParseObjectIdPipe) qid: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.update(id, qid, dto, u);
  }

  @Delete(':qid')
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('qid', ParseObjectIdPipe) qid: string,
    @CurrentUser() u: JwtUser,
  ) {
    return this.service.remove(id, qid, u);
  }
}
