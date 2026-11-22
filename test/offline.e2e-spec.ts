import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

/** Minimal stand-in for the exam-omr service: records payloads, returns a fake PDF. */
function startOmrStub() {
  const payloads: { kind: string; variants: { letter: string; questions: { correct?: number[] }[] }[] }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      payloads.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/pdf' }).end('%PDF-1.4 stub');
    });
  });
  return new Promise<{ server: Server; url: string; payloads: typeof payloads }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, payloads, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    ),
  );
}

interface VariantQ { _id: string; type: string; correctIndex?: number; correctIndexes?: number[] }

describe('Offline sessions (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let omr: Awaited<ReturnType<typeof startOmrStub>>;
  let teacher: string;
  let student: string;
  let examId: string;
  let sessionId: string;
  let variants: { letter: string; questions: VariantQ[] }[];

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const register = async (email: string, role: string) =>
    (await http().post('/api/auth/register')
      .send({ firstName: 'T', lastName: 'U', email, password: 'password123', role }).expect(201)).body.token as string;

  /** Answers that are fully correct for the given version. */
  const correctFor = (letter: string) =>
    variants.find((v) => v.letter === letter)!.questions.map((q, i) =>
      q.type === 'multiple'
        ? { questionIndex: i, selectedIndexes: q.correctIndexes }
        : { questionIndex: i, selectedIndex: q.correctIndex },
    );

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    omr = await startOmrStub();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = 'test-secret';
    process.env.OMR_URL = omr.url;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    teacher = await register('teacher@test.com', 'instructor');
    student = await register('student@test.com', 'student');
    const cat = await http().post('/api/categories').set(auth(teacher)).send({ name: 'Math' }).expect(201);
    const exam = await http().post('/api/exams').set(auth(teacher))
      .send({ title: 'Paper exam', category: cat.body.data.category._id, difficulty: 'Beginner', duration: 30, passingScore: 50 })
      .expect(201);
    examId = exam.body.data.exam._id;
    await http().post(`/api/exams/${examId}/questions/bulk`).set(auth(teacher)).send({
      questions: [
        { text: '1+1', options: ['1', '2', '3', '4'], correctIndex: 1 },
        { text: 'Primes', type: 'multiple', options: ['2', '4', '5', '6'], correctIndexes: [0, 2] },
        { text: '3*3', options: ['6', '9', '12'], correctIndex: 1 },
      ],
    }).expect(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    omr?.server.close();
    await mongod?.stop();
  });

  it('creates a session with shuffled versions sharing the same questions', async () => {
    const res = await http().post('/api/offline-sessions').set(auth(teacher))
      .send({ exam: examId, name: 'Midterm 9B', date: '2026-11-10', variants: 2 }).expect(201);
    sessionId = res.body.data.session._id;
    expect(res.body.data.session).toMatchObject({ versions: ['A', 'B'], questionCount: 3, sheetCount: 0 });

    const full = await http().get(`/api/offline-sessions/${sessionId}`).set(auth(teacher)).expect(200);
    variants = full.body.data.session.variants;
    const ids = (l: number) => variants[l].questions.map((q) => q._id).sort();
    expect(ids(1)).toEqual(ids(0));
  });

  it('is limited to the session owner', async () => {
    await http().get('/api/offline-sessions').set(auth(student)).expect(403);
    const other = await register('other@test.com', 'instructor');
    await http().get(`/api/offline-sessions/${sessionId}`).set(auth(other)).expect(403);
  });

  it('grades manually entered sheets per version and numbers them', async () => {
    const a = await http().post(`/api/offline-sessions/${sessionId}/sheets`).set(auth(teacher))
      .send({ variant: 'A', studentName: 'Aibek', answers: correctFor('A') }).expect(201);
    const b = await http().post(`/api/offline-sessions/${sessionId}/sheets`).set(auth(teacher))
      .send({ variant: 'B', studentName: 'Айгерим', answers: correctFor('B') }).expect(201);
    const blank = await http().post(`/api/offline-sessions/${sessionId}/sheets`).set(auth(teacher))
      .send({ variant: 'A', answers: [] }).expect(201);

    expect(a.body.data.sheet).toMatchObject({ number: 1, score: 100, passed: true });
    expect(b.body.data.sheet).toMatchObject({ number: 2, score: 100, passed: true });
    expect(blank.body.data.sheet).toMatchObject({ number: 3, score: 0, passed: false });

    await http().post(`/api/offline-sessions/${sessionId}/sheets`).set(auth(teacher))
      .send({ variant: 'C', answers: [] }).expect(400);

    const fixed = await http().patch(`/api/offline-sessions/${sessionId}/sheets/${blank.body.data.sheet._id}`)
      .set(auth(teacher)).send({ studentName: '=HYPERLINK("x")', answers: correctFor('A').slice(0, 1) }).expect(200);
    expect(fixed.body.data.sheet.score).toBe(33); // 1 of 3 points

    const list = await http().get('/api/offline-sessions').set(auth(teacher)).expect(200);
    expect(list.body.data.sessions[0]).toMatchObject({ sheetCount: 3, passedCount: 2, avgScore: 78 });
  });

  it('exports CSV with per-question columns aligned across versions', async () => {
    const res = await http().get(`/api/offline-sessions/${sessionId}/results.csv`).set(auth(teacher)).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('Sheet,Name,Version,Score %,Correct,Total,Passed,Q1,Q2,Q3');
    expect(lines[1]).toBe('1,Aibek,A,100,3,3,yes,1,1,1');
    expect(lines[2]).toBe('2,Айгерим,B,100,3,3,yes,1,1,1');
    expect(lines[3]).toBe(`3,"'=HYPERLINK(""x"")",A,33,1,3,no,1,0,0`);
  });

  it('asks the PDF service for sheets, never leaking answers outside the answer key', async () => {
    const sheet = await http().get(`/api/offline-sessions/${sessionId}/pdf/answer-sheet`).set(auth(teacher)).expect(200);
    expect(sheet.headers['content-type']).toBe('application/pdf');
    expect(sheet.headers['content-disposition']).toContain('midterm-9b-answer-sheet.pdf');
    await http().get(`/api/offline-sessions/${sessionId}/pdf/booklet?variant=B`).set(auth(teacher)).expect(200);
    await http().get(`/api/offline-sessions/${sessionId}/pdf/answer-key`).set(auth(teacher)).expect(200);
    await http().get(`/api/offline-sessions/${sessionId}/pdf/nonsense`).set(auth(teacher)).expect(400);

    const [answerSheet, booklet, key] = omr.payloads;
    expect(answerSheet.variants.map((v) => v.letter)).toEqual(['A', 'B']);
    expect(booklet.variants.map((v) => v.letter)).toEqual(['B']);
    expect(JSON.stringify(answerSheet)).not.toContain('correct');
    expect(JSON.stringify(booklet)).not.toContain('correct');
    expect(key.variants[0].questions[1].correct).toEqual([0, 2]);
  });

  it('rejects exams that do not fit on one answer sheet', async () => {
    const cat = await http().post('/api/categories').set(auth(teacher)).send({ name: 'Big' }).expect(201);
    const big = await http().post('/api/exams').set(auth(teacher))
      .send({ title: 'Huge exam', category: cat.body.data.category._id, difficulty: 'Beginner', duration: 90, passingScore: 50 })
      .expect(201);
    await http().post(`/api/exams/${big.body.data.exam._id}/questions/bulk`).set(auth(teacher)).send({
      questions: Array.from({ length: 91 }, (_, i) => ({ text: `Q${i}`, options: ['a', 'b'], correctIndex: 0 })),
    }).expect(201);
    const res = await http().post('/api/offline-sessions').set(auth(teacher))
      .send({ exam: big.body.data.exam._id, name: 'Too big', variants: 1 }).expect(400);
    expect(res.body.message).toContain('up to 90 questions');
  });

  it('reports a clear error when the PDF service is down, and deletes sessions with their sheets', async () => {
    await new Promise((r) => omr.server.close(r));
    const res = await http().get(`/api/offline-sessions/${sessionId}/pdf/booklet`).set(auth(teacher)).expect(503);
    expect(res.body.message).toContain('exam-omr');

    await http().delete(`/api/offline-sessions/${sessionId}`).set(auth(teacher)).expect(200);
    await http().get(`/api/offline-sessions/${sessionId}/sheets`).set(auth(teacher)).expect(404);
  });
});
