import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { Attempt } from '../src/attempts/schemas/attempt.schema.js';
import { ExamViolation } from '../src/proctoring/schemas/exam-violation.schema.js';

describe('Proctoring API (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let attempts: Model<Attempt>;
  let violations: Model<ExamViolation>;
  let instructor: string;
  let otherInstructor: string;
  let student: string;
  let otherStudent: string;
  let categoryId: string;
  let proctoredExam: string;
  let plainExam: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const now = () => new Date().toISOString();

  async function register(email: string, role: 'student' | 'instructor') {
    const res = await http()
      .post('/api/auth/register')
      .send({ firstName: 'T', lastName: 'U', email, password: 'password123', role })
      .expect(201);
    return res.body.token as string;
  }

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
          { text: '1+1?', options: ['1', '2', '3'], correctIndex: 1 },
          { text: '2+2?', options: ['3', '4'], correctIndex: 1 },
        ],
      })
      .expect(201);
    await http().post(`/api/exams/${id}/publish`).set(auth(instructor)).expect(200);
    return id;
  }

  async function start(examId: string, token = student) {
    const res = await http().post(`/api/exams/${examId}/start`).set(auth(token)).expect(200);
    return res.body.data.attempt._id as string;
  }

  const violation = (attemptId: string, type: string, token = student, durationMs?: number) =>
    http()
      .post('/api/exam/violation')
      .set(auth(token))
      .send({ attemptId, type, at: now(), ...(durationMs !== undefined && { durationMs }) });

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = 'test-secret';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    attempts = app.get(getModelToken(Attempt.name));
    violations = app.get(getModelToken(ExamViolation.name));

    instructor = await register('teacher@test.com', 'instructor');
    otherInstructor = await register('teacher2@test.com', 'instructor');
    student = await register('student@test.com', 'student');
    otherStudent = await register('student2@test.com', 'student');
    const cat = await http().post('/api/categories').set(auth(instructor)).send({ name: 'Math' }).expect(201);
    categoryId = cat.body.data.category._id;

    proctoredExam = await createExam('Proctored', {
      proctoring: { enabled: true, maxViolations: 3, requireFullscreen: true },
    });
    plainExam = await createExam('Plain');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await mongod?.stop();
  });

  afterEach(async () => {
    // Fresh attempts per test
    await attempts.deleteMany({});
    await violations.deleteMany({});
  });

  it('validates the exam proctoring setting', async () => {
    const res = await http()
      .post('/api/exams')
      .set(auth(instructor))
      .send({
        title: 'Bad', category: categoryId, difficulty: 'Beginner', duration: 10, passingScore: 50,
        proctoring: { enabled: true, maxViolations: 0, requireFullscreen: true },
      })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('snapshots proctoring settings into the taking view', async () => {
    const res = await http().post(`/api/exams/${proctoredExam}/start`).set(auth(student)).expect(200);
    expect(res.body.data.attempt.proctoring).toEqual({ enabled: true, maxViolations: 3, requireFullscreen: true });
    expect(res.body.data.attempt.violationCount).toBe(0);
  });

  it('requires authentication', async () => {
    const attemptId = await start(proctoredExam);
    await http().post('/api/exam/violation').send({ attemptId, type: 'tab_hidden', at: now() }).expect(401);
    await http().post('/api/exam/heartbeat').send({ attemptId }).expect(401);
  });

  it("returns 404 for another student's attempt and logs nothing", async () => {
    const attemptId = await start(proctoredExam);
    await violation(attemptId, 'tab_hidden', otherStudent).expect(404);
    await http().post('/api/exam/heartbeat').set(auth(otherStudent)).send({ attemptId }).expect(404);
    expect(await violations.countDocuments()).toBe(0);
  });

  it('rejects violations for exams without proctoring', async () => {
    const attemptId = await start(plainExam);
    await violation(attemptId, 'tab_hidden').expect(400);
  });

  it('rejects unknown and server-only violation types', async () => {
    const attemptId = await start(proctoredExam);
    await violation(attemptId, 'made_up').expect(400);
    await violation(attemptId, 'heartbeat_missed').expect(400);
  });

  it('counts on the server and stores request metadata', async () => {
    const attemptId = await start(proctoredExam);
    const res = await violation(attemptId, 'tab_hidden', student, 4200)
      .set('User-Agent', 'TestBrowser/1.0')
      .expect(200);
    expect(res.body.data).toEqual({ status: 'in_progress', violationCount: 1, maxViolations: 3 });

    const [logged] = await violations.find({ attempt: attemptId }).lean();
    expect(logged).toMatchObject({ type: 'tab_hidden', counted: true, durationMs: 4200, userAgent: 'TestBrowser/1.0' });
    expect(logged.ip).toBeTruthy();
    expect(logged.serverAt).toBeInstanceOf(Date);
  });

  it('logs blocked actions without counting them toward the limit', async () => {
    const attemptId = await start(proctoredExam);
    for (const type of ['copy', 'paste', 'context_menu', 'blocked_shortcut', 'devtools_shortcut']) {
      const res = await violation(attemptId, type).expect(200);
      expect(res.body.data.violationCount).toBe(0);
    }
    expect(await violations.countDocuments({ attempt: attemptId, counted: false })).toBe(5);
  });

  it('auto-submits at the limit, grading the autosaved answers, then locks the attempt', async () => {
    const attemptId = await start(proctoredExam);
    await http()
      .patch(`/api/attempts/${attemptId}/answers`)
      .set(auth(student))
      .send({ answers: [{ questionIndex: 0, selectedIndex: 1 }] })
      .expect(200);

    await violation(attemptId, 'tab_hidden').expect(200);
    await violation(attemptId, 'window_blur').expect(200);
    const last = await violation(attemptId, 'fullscreen_exit').expect(200);
    expect(last.body.data).toEqual({ status: 'auto_submitted', violationCount: 3, maxViolations: 3 });

    const saved = await attempts.findById(attemptId).lean();
    expect(saved).toMatchObject({ status: 'auto_submitted', correctCount: 1, score: 50 });
    expect(saved?.answers).toHaveLength(1);
    expect(saved?.submittedAt).toBeInstanceOf(Date);

    // Everything that could change the attempt is now rejected
    await violation(attemptId, 'tab_hidden').expect(409);
    await http().post('/api/exam/heartbeat').set(auth(student)).send({ attemptId }).expect(409);
    await http()
      .patch(`/api/attempts/${attemptId}/answers`)
      .set(auth(student))
      .send({ answers: [{ questionIndex: 1, selectedIndex: 1 }] })
      .expect(409);
    // Submit stays idempotent and can't overwrite the result
    const submit = await http()
      .post(`/api/attempts/${attemptId}/submit`)
      .set(auth(student))
      .send({ answers: [{ questionIndex: 0, selectedIndex: 1 }, { questionIndex: 1, selectedIndex: 1 }] })
      .expect(200);
    expect(submit.body.data.attempt).toMatchObject({ status: 'auto_submitted', score: 50 });
    expect((await attempts.findById(attemptId).lean())?.violationCount).toBe(3);
  });

  it('does not let concurrent reports skip past the limit', async () => {
    const attemptId = await start(proctoredExam);
    await Promise.all(Array.from({ length: 6 }, () => violation(attemptId, 'window_blur')));
    const saved = await attempts.findById(attemptId).lean();
    expect(saved?.status).toBe('auto_submitted');
    expect(saved?.violationCount).toBe(3);
  });

  describe('heartbeat', () => {
    const rewind = (attemptId: string, ms: number) =>
      attempts.updateOne({ _id: attemptId }, { $set: { lastHeartbeatAt: new Date(Date.now() - ms) } });
    const heartbeat = (attemptId: string) =>
      http().post('/api/exam/heartbeat').set(auth(student)).send({ attemptId });

    it('accepts regular pings without logging anything', async () => {
      const attemptId = await start(proctoredExam);
      const res = await heartbeat(attemptId).expect(200);
      expect(res.body.data).toEqual({ status: 'in_progress', violationCount: 0, maxViolations: 3 });
      expect(await violations.countDocuments()).toBe(0);
    });

    it('logs heartbeat_missed after more than 30s of silence, once', async () => {
      const attemptId = await start(proctoredExam);
      await rewind(attemptId, 60_000);
      const res = await heartbeat(attemptId).expect(200);
      expect(res.body.data.violationCount).toBe(1);
      const [logged] = await violations.find({ attempt: attemptId }).lean();
      expect(logged.type).toBe('heartbeat_missed');
      expect(logged.durationMs).toBeGreaterThanOrEqual(60_000);

      await heartbeat(attemptId).expect(200);
      expect(await violations.countDocuments()).toBe(1);
    });

    it('does not double-count a gap the client already reported', async () => {
      const attemptId = await start(proctoredExam);
      await rewind(attemptId, 45_000);
      // Back from a 40s tab switch: the client reports it, then resumes pinging
      const res = await violation(attemptId, 'tab_hidden', student, 40_000).expect(200);
      expect(res.body.data.violationCount).toBe(1);
      await heartbeat(attemptId).expect(200);
      expect(await violations.find({ attempt: attemptId }).distinct('type')).toEqual(['tab_hidden']);
    });

    it('still catches a gap a tiny unrelated report does not explain', async () => {
      const attemptId = await start(proctoredExam);
      await rewind(attemptId, 90_000);
      await violation(attemptId, 'window_blur', student, 500).expect(200);
      const types = await violations.find({ attempt: attemptId }).sort({ serverAt: 1 }).distinct('type');
      expect(types.sort()).toEqual(['heartbeat_missed', 'window_blur']);
    });

    it('catches students who disabled the heartbeat but keep saving answers', async () => {
      const attemptId = await start(proctoredExam);
      await attempts.updateOne({ _id: attemptId }, { $set: { violationCount: 2 } });
      await rewind(attemptId, 120_000);
      const res = await http()
        .patch(`/api/attempts/${attemptId}/answers`)
        .set(auth(student))
        .send({ answers: [{ questionIndex: 0, selectedIndex: 1 }, { questionIndex: 1, selectedIndex: 1 }] })
        .expect(200);
      expect(res.body.data.proctoring.status).toBe('auto_submitted');
      // The answers in that same request were saved before the auto-submit
      expect(await attempts.findById(attemptId).lean()).toMatchObject({ status: 'auto_submitted', score: 100 });
    });

    it('never runs for exams without proctoring', async () => {
      const attemptId = await start(plainExam);
      await rewind(attemptId, 120_000);
      await http()
        .patch(`/api/attempts/${attemptId}/answers`)
        .set(auth(student))
        .send({ answers: [] })
        .expect(200);
      await http().post(`/api/attempts/${attemptId}/submit`).set(auth(student)).send({ answers: [] }).expect(200);
      expect(await violations.countDocuments()).toBe(0);
      expect((await attempts.findById(attemptId).lean())?.status).toBe('submitted');
    });
  });

  describe('teacher view', () => {
    it("shows the exam's attempts and each attempt's timeline to its instructor", async () => {
      const attemptId = await start(proctoredExam);
      await violation(attemptId, 'tab_hidden', student, 3000).expect(200);
      await violation(attemptId, 'copy').expect(200);

      const list = await http().get(`/api/instructor/exams/${proctoredExam}/attempts`).set(auth(instructor)).expect(200);
      expect(list.body.data.attempts).toHaveLength(1);
      expect(list.body.data.attempts[0]).toMatchObject({ _id: attemptId, violationCount: 1, loggedEvents: 2 });
      expect(list.body.data.attempts[0].user.email).toBe('student@test.com');
      expect(JSON.stringify(list.body)).not.toContain('correctIndex');

      const timeline = await http().get(`/api/instructor/attempts/${attemptId}/violations`).set(auth(instructor)).expect(200);
      expect(timeline.body.data.violations.map((v: { type: string }) => v.type)).toEqual(['tab_hidden', 'copy']);
      expect(timeline.body.data.violations[0].durationMs).toBe(3000);
    });

    it('hides it from students and other instructors', async () => {
      const attemptId = await start(proctoredExam);
      await http().get(`/api/instructor/exams/${proctoredExam}/attempts`).set(auth(student)).expect(403);
      await http().get(`/api/instructor/attempts/${attemptId}/violations`).set(auth(student)).expect(403);
      await http().get(`/api/instructor/exams/${proctoredExam}/attempts`).set(auth(otherInstructor)).expect(403);
      await http().get(`/api/instructor/attempts/${attemptId}/violations`).set(auth(otherInstructor)).expect(403);
    });
  });
});
