import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { Attempt } from '../src/attempts/schemas/attempt.schema.js';
import { Role, User } from '../src/users/schemas/user.schema.js';

describe('ExamPro API (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let instructor: string;
  let student: string;
  let admin: string;
  let categoryId: string;
  let examId: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(email: string, role: 'student' | 'instructor') {
    const res = await http()
      .post('/api/auth/register')
      .send({ firstName: 'T', lastName: 'U', email, password: 'password123', role })
      .expect(201);
    return res.body.token as string;
  }

  /** Creates and publishes an exam with one single and one multiple question. */
  async function createExam(title: string, extra: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/exams')
      .set(auth(instructor))
      .send({ title, category: categoryId, difficulty: 'Beginner', duration: 10, passingScore: 50, ...extra })
      .expect(201);
    const id = res.body.data.exam._id as string;
    await http()
      .post(`/api/exams/${id}/questions/bulk`)
      .set(auth(instructor))
      .send({
        questions: [
          { text: '1+1?', options: ['1', '2', '3'], correctIndex: 1, explanation: 'Basic sum' },
          { text: 'Even numbers?', type: 'multiple', options: ['2', '3', '4'], correctIndexes: [0, 2] },
        ],
      })
      .expect(201);
    await http().post(`/api/exams/${id}/publish`).set(auth(instructor)).expect(200);
    return id;
  }

  const correctAnswers = [
    { questionIndex: 0, selectedIndex: 1 },
    { questionIndex: 1, selectedIndexes: [0, 2] },
  ];

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = 'test-secret';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    instructor = await register('teacher@test.com', 'instructor');
    student = await register('student@test.com', 'student');
    await register('admin@test.com', 'student');
    await app.get<Model<User>>(getModelToken(User.name)).updateOne({ email: 'admin@test.com' }, { role: Role.Admin });
    const login = await http()
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'password123' })
      .expect(200);
    admin = login.body.token;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await mongod?.stop();
  });

  it('registers without exposing the password hash', async () => {
    const res = await http().get('/api/auth/me').set(auth(student)).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('lets an instructor build and publish an exam', async () => {
    const cat = await http().post('/api/categories').set(auth(instructor)).send({ name: 'Physics' }).expect(201);
    categoryId = cat.body.data.category._id;
    expect(cat.body.data.category.slug).toBe('physics');
    examId = await createExam('Physics 101');
  });

  it('enforces roles: 401 without a token, 403 for students', async () => {
    await http().post('/api/categories').send({ name: 'X' }).expect(401);
    const res = await http().post('/api/categories').set(auth(student)).send({ name: 'X' }).expect(403);
    expect(res.body).toEqual({ success: false, message: expect.any(String) });
    await http().post('/api/exams').set(auth(student)).send({}).expect(403);
  });

  it('never sends answers to students before submission', async () => {
    const detail = await http().get(`/api/exams/${examId}`).expect(200);
    expect(detail.body.data.exam.questionCount).toBe(2);
    const start = await http().post(`/api/exams/${examId}/start`).set(auth(student)).expect(200);
    for (const body of [detail.body, start.body]) {
      const json = JSON.stringify(body);
      expect(json).not.toContain('correctIndex');
      expect(json).not.toContain('explanation');
    }
  });

  it('filters the public list by category slug', async () => {
    const res = await http().get('/api/exams?category=physics').expect(200);
    expect(res.body.data.total).toBe(1);
    const none = await http().get('/api/exams?category=nope').expect(200);
    expect(none.body.data.total).toBe(0);
  });

  it('resumes an attempt with autosaved answers, then grades on submit', async () => {
    const first = await http().post(`/api/exams/${examId}/start`).set(auth(student)).expect(200);
    const attemptId = first.body.data.attempt._id;
    await http()
      .patch(`/api/attempts/${attemptId}/answers`)
      .set(auth(student))
      .send({ answers: [{ questionIndex: 0, selectedIndex: 1, isFlagged: true }] })
      .expect(200);

    const resumed = await http().post(`/api/exams/${examId}/start`).set(auth(student)).expect(200);
    expect(resumed.body.data.attempt._id).toBe(attemptId);
    expect(resumed.body.data.attempt.answers[0]).toMatchObject({ selectedIndex: 1, isFlagged: true });

    const submit = await http()
      .post(`/api/attempts/${attemptId}/submit`)
      .set(auth(student))
      .send({ answers: correctAnswers })
      .expect(200);
    expect(submit.body.data.attempt).toMatchObject({ score: 100, passed: true, status: 'submitted' });
    expect(submit.body.data.review[0].explanation).toBe('Basic sum');

    const again = await http().post(`/api/attempts/${attemptId}/submit`).set(auth(student)).send({ answers: [] }).expect(200);
    expect(again.body.data.attempt.score).toBe(100);

    const dash = await http().get('/api/dashboard').set(auth(student)).expect(200);
    expect(dash.body.data.stats).toMatchObject({ examsTaken: 1, avgScore: 100, certificates: 1 });
    expect(dash.body.data.recentAttempts[0].category).toBe('Physics');
  });

  it('blocks starting beyond maxAttempts', async () => {
    const id = await createExam('One shot', { maxAttempts: 1 });
    const start = await http().post(`/api/exams/${id}/start`).set(auth(student)).expect(200);
    await http()
      .post(`/api/attempts/${start.body.data.attempt._id}/submit`)
      .set(auth(student))
      .send({ answers: [] })
      .expect(200);
    await http().post(`/api/exams/${id}/start`).set(auth(student)).expect(403);
  });

  it('grades only the autosave when submitted after time is up', async () => {
    const id = await createExam('Timed');
    const start = await http().post(`/api/exams/${id}/start`).set(auth(student)).expect(200);
    const attemptId = start.body.data.attempt._id;
    await http()
      .patch(`/api/attempts/${attemptId}/answers`)
      .set(auth(student))
      .send({ answers: [{ questionIndex: 0, selectedIndex: 1 }] })
      .expect(200);
    await app
      .get<Model<Attempt>>(getModelToken(Attempt.name))
      .updateOne({ _id: attemptId }, { expiresAt: new Date(Date.now() - 60_000) });

    const res = await http()
      .post(`/api/attempts/${attemptId}/submit`)
      .set(auth(student))
      .send({ answers: correctAnswers })
      .expect(200);
    expect(res.body.data.attempt.status).toBe('timed_out');
    expect(res.body.data.attempt.correctCount).toBe(1);
  });

  it('returns 409 when deleting a category or exam that is in use', async () => {
    await http().delete(`/api/categories/${categoryId}`).set(auth(admin)).expect(409);
    await http().delete(`/api/exams/${examId}`).set(auth(instructor)).expect(409);
  });

  it('refuses to publish an exam without questions', async () => {
    const res = await http()
      .post('/api/exams')
      .set(auth(instructor))
      .send({ title: 'Empty', category: categoryId, difficulty: 'Beginner', duration: 5, passingScore: 50 })
      .expect(201);
    await http().post(`/api/exams/${res.body.data.exam._id}/publish`).set(auth(instructor)).expect(400);
  });

  it("stops instructors from editing someone else's exam", async () => {
    const other = await register('other@test.com', 'instructor');
    await http().patch(`/api/exams/${examId}`).set(auth(other)).send({ title: 'Hijack' }).expect(403);
    await http().patch(`/api/exams/${examId}`).set(auth(admin)).send({ title: 'Physics 101 (edited)' }).expect(200);
  });
});
