import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Exam, ExamDocument } from './schemas/exam.schema.js';
import { questionError } from './schemas/question.schema.js';
import { Category } from '../categories/schemas/category.schema.js';
import { Attempt } from '../attempts/schemas/attempt.schema.js';
import { CreateExamDto, ListExamsQueryDto, UpdateExamDto } from './dto/exam.dto.js';
import { toPublicExam } from './exam.mapper.js';
import { escapeRegex } from '../common/utils.js';
import { Role } from '../users/schemas/user.schema.js';
import type { JwtUser } from '../common/types.js';

const PAGE_SIZE = 12;

@Injectable()
export class ExamsService {
  constructor(
    @InjectModel(Exam.name) private exams: Model<Exam>,
    @InjectModel(Category.name) private categories: Model<Category>,
    @InjectModel(Attempt.name) private attempts: Model<Attempt>,
  ) {}

  // ---------- public ----------

  async listPublished(q: ListExamsQueryDto) {
    const page = q.page ?? 1;
    const filter: Record<string, unknown> = { isPublished: true };
    if (q.category) {
      const cat = await this.categories.findOne({ slug: q.category }).select('_id');
      if (!cat) return { data: { exams: [], total: 0, pages: 1, page } };
      filter.category = cat._id;
    }
    if (q.difficulty) filter.difficulty = q.difficulty;
    if (q.search) filter.title = { $regex: escapeRegex(q.search), $options: 'i' };

    const [docs, total] = await Promise.all([
      this.exams
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .populate('category', 'name slug emoji')
        .populate('instructor', 'firstName lastName')
        .lean(),
      this.exams.countDocuments(filter),
    ]);
    return {
      data: {
        exams: docs.map(toPublicExam),
        total,
        pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        page,
      },
    };
  }

  async getPublished(id: string) {
    const exam = await this.exams
      .findOne({ _id: id, isPublished: true })
      .populate('category', 'name slug emoji')
      .populate('instructor', 'firstName lastName bio avatar')
      .lean();
    if (!exam) throw new NotFoundException('Exam not found');
    return { data: { exam: toPublicExam(exam) } };
  }

  // ---------- instructor ----------

  async listMine(user: JwtUser) {
    const filter = user.role === Role.Admin ? {} : { instructor: user.sub };
    const docs = await this.exams
      .find(filter)
      .sort({ updatedAt: -1 })
      .populate('category', 'name slug emoji')
      .lean();
    return { data: { exams: docs.map(toPublicExam) } };
  }

  async getForEdit(id: string, user: JwtUser) {
    const exam = await this.getEditable(id, user);
    await exam.populate('category', 'name slug emoji');
    return { data: { exam } }; // full exam including correct answers (owner only)
  }

  async create(dto: CreateExamDto, user: JwtUser) {
    await this.assertCategory(dto.category);
    const exam = await this.exams.create({
      ...dto,
      instructor: user.sub,
      isPublished: false,
    });
    return { data: { exam } };
  }

  async update(id: string, dto: UpdateExamDto, user: JwtUser) {
    const exam = await this.getEditable(id, user);
    if (dto.category) await this.assertCategory(dto.category);
    exam.set(dto);
    await exam.save();
    return { data: { exam } };
  }

  async remove(id: string, user: JwtUser) {
    const exam = await this.getEditable(id, user);
    if (await this.attempts.exists({ exam: exam._id })) {
      throw new ConflictException(
        'Students have already taken this exam. Unpublish it instead.',
      );
    }
    await exam.deleteOne();
    return { data: {} };
  }

  async setPublished(id: string, user: JwtUser, publish: boolean) {
    const exam = await this.getEditable(id, user);
    if (publish) {
      if (!exam.questions.length) {
        throw new BadRequestException('Add at least one question before publishing');
      }
      exam.questions.forEach((q, i) => {
        const err = questionError(q);
        if (err) throw new BadRequestException(`Question ${i + 1}: ${err}`);
      });
    }
    exam.isPublished = publish;
    await exam.save();
    return { data: { exam } };
  }

  /** Loads an exam the user may edit: its instructor, or any admin. */
  async getEditable(id: string, user: JwtUser): Promise<ExamDocument> {
    const exam = await this.exams.findById(id);
    if (!exam) throw new NotFoundException('Exam not found');
    if (user.role !== Role.Admin && !exam.instructor.equals(user.sub)) {
      throw new ForbiddenException('You can only edit your own exams');
    }
    return exam;
  }

  private async assertCategory(id: string) {
    if (!(await this.categories.exists({ _id: id }))) {
      throw new BadRequestException('Category does not exist');
    }
  }
}
