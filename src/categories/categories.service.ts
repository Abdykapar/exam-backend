import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category } from './schemas/category.schema.js';
import { Exam } from '../exams/schemas/exam.schema.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';
import { slugify } from '../common/utils.js';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name) private categories: Model<Category>,
    @InjectModel(Exam.name) private exams: Model<Exam>,
  ) {}

  async list() {
    const categories = await this.categories.aggregate([
      {
        $lookup: {
          from: 'exams',
          let: { id: '$_id' },
          pipeline: [
            {
              $match: { $expr: { $eq: ['$category', '$$id'] }, isPublished: true },
            },
            { $count: 'n' },
          ],
          as: 'counts',
        },
      },
      { $addFields: { examCount: { $ifNull: [{ $first: '$counts.n' }, 0] } } },
      { $project: { counts: 0, __v: 0 } },
      { $sort: { name: 1 } },
    ]);
    return { data: { categories } };
  }

  async create(dto: CreateCategoryDto, userId: string) {
    const category = await this.categories.create({
      ...dto,
      slug: slugify(dto.name),
      createdBy: userId,
    });
    return { data: { category } };
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const patch = dto.name ? { ...dto, slug: slugify(dto.name) } : dto;
    const category = await this.categories.findByIdAndUpdate(id, patch, {
      returnDocument: 'after',
      runValidators: true,
    });
    if (!category) throw new NotFoundException('Category not found');
    return { data: { category } };
  }

  async remove(id: string) {
    if (await this.exams.exists({ category: id })) {
      throw new ConflictException(
        'This category still has exams. Move or delete them first.',
      );
    }
    const res = await this.categories.deleteOne({ _id: id });
    if (!res.deletedCount) throw new NotFoundException('Category not found');
    return { data: {} };
  }
}
