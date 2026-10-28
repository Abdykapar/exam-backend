import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExamsService } from './exams.service.js';
import { ExamDocument } from './schemas/exam.schema.js';
import { QuestionFields, questionError } from './schemas/question.schema.js';
import { QuestionDto, UpdateQuestionDto } from './dto/question.dto.js';
import type { JwtUser } from '../common/types.js';

/** Every method returns the whole updated exam, so the editor can re-render from one response. */
@Injectable()
export class QuestionsService {
  constructor(private exams: ExamsService) {}

  async add(examId: string, dto: QuestionDto, user: JwtUser) {
    const exam = await this.exams.getEditable(examId, user);
    this.validate(dto);
    exam.questions.push(dto);
    return this.save(exam);
  }

  async update(
    examId: string,
    qid: string,
    dto: UpdateQuestionDto,
    user: JwtUser,
  ) {
    const exam = await this.exams.getEditable(examId, user);
    const q = exam.questions.id(qid);
    if (!q) throw new NotFoundException('Question not found');
    this.validate({ ...q.toObject(), ...dto });
    q.set(dto);
    return this.save(exam);
  }

  async remove(examId: string, qid: string, user: JwtUser) {
    const exam = await this.exams.getEditable(examId, user);
    const q = exam.questions.id(qid);
    if (!q) throw new NotFoundException('Question not found');
    await q.deleteOne();
    return this.save(exam);
  }

  async reorder(examId: string, order: string[], user: JwtUser) {
    const exam = await this.exams.getEditable(examId, user);
    const byId = new Map(
      exam.questions.map((q) => [q._id.toString(), q.toObject()]),
    );
    if (
      order.length !== byId.size ||
      new Set(order).size !== order.length ||
      !order.every((id) => byId.has(id))
    ) {
      throw new BadRequestException(
        'order must list every question id exactly once',
      );
    }
    exam.set(
      'questions',
      order.map((id) => byId.get(id)),
    );
    return this.save(exam);
  }

  async bulk(examId: string, questions: QuestionDto[], user: JwtUser) {
    const exam = await this.exams.getEditable(examId, user);
    const errors = questions
      .map((q, i) => {
        const err = questionError(q);
        return err && `Row ${i + 1}: ${err}`;
      })
      .filter(Boolean);
    if (errors.length) throw new BadRequestException(errors.join('; '));
    exam.questions.push(...questions);
    return this.save(exam);
  }

  private validate(q: QuestionFields) {
    const err = questionError(q);
    if (err) throw new BadRequestException(err);
  }

  private async save(exam: ExamDocument) {
    await exam.save();
    return { data: { exam } };
  }
}
