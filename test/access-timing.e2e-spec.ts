import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { Attempt } from '../src/attempts/schemas/attempt.schema.js';

describe('Exam passwords and per-question timing (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let instructor: string;
  let student: string;
  let categoryId: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const attempts = () => app.get<Model<Attempt>>(getModelToken(Attempt.name));

  async function register(email: string, role: 'student' | 'instructor') {
    const res = await http()
      .post('/api/auth/register')
      .send({ firstName: 'T', lastName: 'U', email, password: 'password123', role })
      .expect(201);
    return res.body.token as string;
  }

  /** Three single-answer questions; the correct answer is always option 1. */
  async function createExam(title: string, extra: Record<string, unknown> = {}, timeLimits = [30, 30, 30]) {
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
        questions: timeLimits.map((timeLimit, i) => ({
          text: `Question ${i + 1}`,
          options: ['a', 'b', 'c'],
          correctIndex: 1,
          timeLimit,
        })),
      })
      .expect(201);
    await http().post(`/api/exams/${id}/publish`).set(auth(instructor)).expect(200);
    return id;
  }

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
    const cat = await http().post('/api/categories').set(auth(instructor)).send({ name: 'Maths' }).expect(201);
    categoryId = cat.body.data.category._id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await mongod?.stop();
  });

  describe('password-protected exams', () => {
    let examId: string;
    let publicId: string;

    beforeAll(async () => {
      examId = await createExam('Secret quiz', { accessPassword: '  open-sesame ' });
      publicId = await createExam('Open quiz');
    });

    it('hides them from the catalog and never exposes the password publicly', async () => {
      const list = await http().get('/api/exams').expect(200);
      const ids = list.body.data.exams.map((e: { _id: string }) => e._id);
      expect(ids).toContain(publicId);
      expect(ids).not.toContain(examId);

      const detail = await http().get(`/api/exams/${examId}`).expect(200);
      expect(detail.body.data.exam.requiresPassword).toBe(true);
      expect(JSON.stringify(detail.body)).not.toContain('open-sesame');

      const mine = await http().get('/api/instructor/exams').set(auth(instructor)).expect(200);
      expect(JSON.stringify(mine.body)).not.toContain('open-sesame');
      // The owner sees it (trimmed) in the editor so it can be shared
      const edit = await http().get(`/api/instructor/exams/${examId}`).set(auth(instructor)).expect(200);
      expect(edit.body.data.exam.accessPassword).toBe('open-sesame');
    });

    it('requires the password from logged-in students, but not from the owner', async () => {
      const none = await http().post(`/api/exams/${examId}/start`).set(auth(student)).send({}).expect(403);
      expect(none.body.message).toBe('This exam requires a password');
      const wrong = await http().post(`/api/exams/${examId}/start`).set(auth(student)).send({ password: 'nope' }).expect(403);
      expect(wrong.body.message).toBe('Incorrect exam password');
      const ok = await http().post(`/api/exams/${examId}/start`).set(auth(student)).send({ password: 'open-sesame' }).expect(200);
      // Resuming doesn't ask again
      const resumed = await http().post(`/api/exams/${examId}/start`).set(auth(student)).send({}).expect(200);
      expect(resumed.body.data.attempt._id).toBe(ok.body.data.attempt._id);

      await http().post(`/api/exams/${examId}/start`).set(auth(instructor)).send({}).expect(200);
    });

    it('lets guests join with their name and the password', async () => {
      await http()
        .post(`/api/exams/${examId}/join`)
        .send({ firstName: 'Ann', lastName: 'Lee', password: 'wrong' })
        .expect(403);
      await http().post(`/api/exams/${examId}/join`).send({ password: 'open-sesame' }).expect(400);

      const join = await http()
        .post(`/api/exams/${examId}/join`)
        .send({ firstName: ' Ann ', lastName: 'Lee', password: 'open-sesame' })
        .expect(200);
      const guest = join.body.token as string;
      expect(join.body.data.user).toMatchObject({ firstName: 'Ann', lastName: 'Lee', isGuest: true });

      const start = await http().post(`/api/exams/${examId}/start`).set(auth(guest)).send({}).expect(200);
      const attemptId = start.body.data.attempt._id;
      const submit = await http()
        .post(`/api/attempts/${attemptId}/submit`)
        .set(auth(guest))
        .send({ answers: [0, 1, 2].map((questionIndex) => ({ questionIndex, selectedIndex: 1 })) })
        .expect(200);
      expect(submit.body.data.attempt.score).toBe(100);

      // The teacher sees the guest's name
      const list = await http().get(`/api/instructor/exams/${examId}/attempts`).set(auth(instructor)).expect(200);
      const row = list.body.data.attempts.find((a: { _id: string }) => a._id === attemptId);
      expect(row.user).toMatchObject({ firstName: 'Ann', lastName: 'Lee', isGuest: true });

      // Guest access is limited to this exam, and guests can't log in
      await http().post(`/api/exams/${publicId}/start`).set(auth(guest)).send({}).expect(403);
      await http()
        .post('/api/auth/login')
        .send({ email: join.body.data.user.email, password: '' })
        .expect(401);
    });

    it('refuses guest join for exams without a password', async () => {
      await http()
        .post(`/api/exams/${publicId}/join`)
        .send({ firstName: 'A', lastName: 'B', password: 'x' })
        .expect(400);
    });
  });

  describe('per-question timing', () => {
    let examId: string;

    beforeAll(async () => {
      examId = await createExam('Speed round', { perQuestionTiming: true }, [30, 45, 100]);
    });

    it('derives the exam duration from question times', async () => {
      const detail = await http().get(`/api/exams/${examId}`).expect(200);
      expect(detail.body.data.exam.duration).toBe(3); // 175s rounded up
    });

    it('shows one question at a time, locks earlier answers and finishes after the last', async () => {
      const start = await http().post(`/api/exams/${examId}/start`).set(auth(student)).send({}).expect(200);
      const v = start.body.data;
      const attemptId = v.attempt._id;
      expect(v.attempt).toMatchObject({ perQuestionTiming: true, currentQuestion: 0 });
      expect(new Date(v.attempt.questionDeadline).getTime() - new Date(v.attempt.startedAt).getTime()).toBe(30_000);
      expect(v.exam.questions[0].text).toBe('Question 1');
      expect(v.exam.questions[1]).toMatchObject({ text: '', options: [], timeLimit: 45 });

      // Answers to other questions are ignored
      await http()
        .patch(`/api/attempts/${attemptId}/answers`)
        .set(auth(student))
        .send({ answers: [{ questionIndex: 0, selectedIndex: 1 }, { questionIndex: 1, selectedIndex: 1 }] })
        .expect(200);
      const next = await http()
        .post(`/api/attempts/${attemptId}/next`)
        .set(auth(student))
        .send({ index: 0, answers: [{ questionIndex: 0, selectedIndex: 1 }] })
        .expect(200);
      expect(next.body.data.attempt.currentQuestion).toBe(1);
      expect(next.body.data.attempt.answers).toEqual([expect.objectContaining({ questionIndex: 0, selectedIndex: 1 })]);
      expect(next.body.data.exam.questions[1].text).toBe('Question 2');

      // Question 1 is locked now; a repeated "next" for it changes nothing
      await http()
        .patch(`/api/attempts/${attemptId}/answers`)
        .set(auth(student))
        .send({ answers: [{ questionIndex: 0, selectedIndex: 2 }, { questionIndex: 1, selectedIndex: 1 }] })
        .expect(200);
      const stale = await http()
        .post(`/api/attempts/${attemptId}/next`)
        .set(auth(student))
        .send({ index: 0, answers: [] })
        .expect(200);
      expect(stale.body.data.attempt.currentQuestion).toBe(1);

      await http()
        .post(`/api/attempts/${attemptId}/next`)
        .set(auth(student))
        .send({ index: 1, answers: [{ questionIndex: 1, selectedIndex: 1 }] })
        .expect(200);
      const done = await http()
        .post(`/api/attempts/${attemptId}/next`)
        .set(auth(student))
        .send({ index: 2, answers: [{ questionIndex: 2, selectedIndex: 0 }] })
        .expect(200);
      expect(done.body.data.attempt).toMatchObject({ status: 'submitted', correctCount: 2 });
      expect(done.body.data.review).toHaveLength(3);
    });

    it('skips questions whose time ran out, ignoring late answers', async () => {
      const start = await http().post(`/api/exams/${examId}/start`).set(auth(student)).send({}).expect(200);
      const attemptId = start.body.data.attempt._id;
      // 40s ago: question 1 (30s) is over, question 2 (45s) is 10s in
      await attempts().updateOne(
        { _id: attemptId },
        { startedAt: new Date(Date.now() - 40_000), questionStartedAt: new Date(Date.now() - 40_000) },
      );

      const late = await http()
        .post(`/api/attempts/${attemptId}/next`)
        .set(auth(student))
        .send({ index: 0, answers: [{ questionIndex: 0, selectedIndex: 1 }] })
        .expect(200);
      expect(late.body.data.attempt.currentQuestion).toBe(1);
      expect(late.body.data.attempt.answers).toEqual([]);
      const left = new Date(late.body.data.attempt.questionDeadline).getTime() - Date.now();
      expect(left).toBeGreaterThan(30_000);
      expect(left).toBeLessThanOrEqual(35_000);

      // Long after every question ended, the attempt is closed as timed out
      await attempts().updateOne({ _id: attemptId }, { questionStartedAt: new Date(Date.now() - 600_000) });
      const res = await http().get(`/api/attempts/${attemptId}`).set(auth(student)).expect(200);
      expect(res.body.data.attempt.status).toBe('timed_out');
    });

    it('rejects next for normally timed exams', async () => {
      const id = await createExam('Normal');
      const start = await http().post(`/api/exams/${id}/start`).set(auth(student)).send({}).expect(200);
      await http()
        .post(`/api/attempts/${start.body.data.attempt._id}/next`)
        .set(auth(student))
        .send({ index: 0, answers: [] })
        .expect(400);
    });
  });
});
