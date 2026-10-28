import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { AppModule } from './app.module.js';
import { Role, User } from './users/schemas/user.schema.js';
import { Category } from './categories/schemas/category.schema.js';
import { Exam } from './exams/schemas/exam.schema.js';
import { slugify } from './common/utils.js';

const CATEGORIES = [
  ['Mathematics', '📐'],
  ['Sciences', '🔬'],
  ['Languages', '🗣️'],
  ['IT', '💻'],
  ['History', '🏛️'],
  ['Business', '📊'],
  ['Arts', '🎨'],
  ['Medicine', '🩺'],
];

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const users = app.get<Model<User>>(getModelToken(User.name));
  const categories = app.get<Model<Category>>(getModelToken(Category.name));
  const exams = app.get<Model<Exam>>(getModelToken(Exam.name));

  const password = await bcrypt.hash('password123', 10);
  const upsertUser = (email: string, firstName: string, role: Role) =>
    users.findOneAndUpdate(
      { email },
      { email, firstName, lastName: 'Demo', role, password },
      { upsert: true, returnDocument: 'after' },
    );

  await upsertUser('student@exampro.com', 'Student', Role.Student);
  const instructor = await upsertUser(
    'instructor@exampro.com',
    'Instructor',
    Role.Instructor,
  );
  await upsertUser('admin@exampro.com', 'Admin', Role.Admin);

  const cats: Record<string, Types.ObjectId> = {};
  for (const [name, emoji] of CATEGORIES) {
    const cat = await categories.findOneAndUpdate(
      { slug: slugify(name) },
      { name, slug: slugify(name), emoji },
      { upsert: true, returnDocument: 'after' },
    );
    cats[name] = cat._id;
  }

  const sample = [
    {
      title: 'Algebra Fundamentals',
      description: 'Linear equations, primes and powers.',
      category: cats.Mathematics,
      difficulty: 'Beginner',
      duration: 15,
      emoji: '➗',
      questions: [
        {
          text: 'Solve: 2x + 3 = 11',
          options: ['x = 3', 'x = 4', 'x = 5', 'x = 7'],
          correctIndex: 1,
          explanation: '2x = 8, so x = 4.',
        },
        {
          text: 'Which are prime numbers?',
          type: 'multiple',
          options: ['2', '9', '11', '15'],
          correctIndexes: [0, 2],
          explanation: '9 = 3×3 and 15 = 3×5 are composite.',
        },
        { text: 'What is 3²?', options: ['6', '9', '12'], correctIndex: 1 },
      ],
    },
    {
      title: 'Web Basics',
      description: 'HTML and HTTP essentials.',
      category: cats.IT,
      difficulty: 'Beginner',
      duration: 10,
      emoji: '🌐',
      questions: [
        {
          text: 'What does HTML stand for?',
          options: ['HyperText Markup Language', 'High Tech Modern Language'],
          correctIndex: 0,
        },
        {
          text: 'Which HTTP method is idempotent?',
          options: ['POST', 'PUT', 'PATCH'],
          correctIndex: 1,
          explanation: 'Repeating a PUT has the same effect.',
        },
      ],
    },
  ];
  for (const e of sample) {
    await exams.findOneAndUpdate(
      { title: e.title },
      { ...e, instructor: instructor._id, isPublished: true, passingScore: 60 },
      { upsert: true },
    );
  }

  console.log(
    'Seed complete. Users: student|instructor|admin @exampro.com / password123',
  );
  await app.close();
}
await seed();
