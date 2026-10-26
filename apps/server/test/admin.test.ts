import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type {
  AdminCategory,
  AdminErrorResponse,
  AdminQuestion,
  CategoryNode,
  QuestionInput,
  QuestionListResponse,
  SaveQuestionResponse,
} from '@tension/shared';
import { importPack, parsePack, type QuestionPack } from '../src/content/importer';
import { createPrisma } from '../src/db';
import { createAdminApi } from '../src/http/admin';
import { createTensionServer } from '../src/server';

// Spaces and accents too: the browser sends the password URI-encoded.
const PASSWORD = 'open sesame, ünïcode';

const serverRoot = resolve(import.meta.dir, '..');
const tempDir = mkdtempSync(join(tmpdir(), 'tension-admin-test-'));
const databaseUrl = `file:${join(tempDir, 'test.db')}`;

let prisma: PrismaClient;
let server: ReturnType<typeof createTensionServer>;
let baseUrl: string;
let starter: QuestionPack;

async function api<T>(path: string, init: RequestInit = {}, password = PASSWORD) {
  const response = await fetch(`${baseUrl}/api/admin${path}`, {
    ...init,
    headers: { authorization: `Bearer ${encodeURIComponent(password)}`, 'content-type': 'application/json' },
  });
  return { status: response.status, body: (response.status === 204 ? null : await response.json()) as T & AdminErrorResponse };
}

const list = (query = '') => api<QuestionListResponse>(`/questions${query}`);
const save = (question: QuestionInput, id?: string) =>
  api<SaveQuestionResponse>(id ? `/questions/${id}` : '/questions', { method: id ? 'PUT' : 'POST', body: JSON.stringify(question) });
const setActive = (id: string, active: unknown) =>
  api<{ question: AdminQuestion }>(`/questions/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
const remove = (id: string) => api<null>(`/questions/${id}`, { method: 'DELETE' });

const ELEMENTS = ['Hydrogen', 'Helium', 'Lithium', 'Beryllium', 'Boron', 'Carbon', 'Nitrogen', 'Oxygen', 'Fluorine', 'Neon', 'Sodium', 'Magnesium'];

/** A valid question: `cutoff` scoring answers, then three tension answers. */
function element(overrides: Partial<QuestionInput> = {}): QuestionInput {
  const cutoff = overrides.cutoff ?? 5;
  return {
    category: 'science/elements',
    question: `Top ${cutoff} lightest elements`,
    cutoff,
    difficulty: 2,
    tags: ['chemistry'],
    answers: ELEMENTS.slice(0, cutoff + 3).map((answer, i) => ({ answer, display: `${i + 1}`, aliases: [] })),
    ...overrides,
  };
}

const gameCategories = async () =>
  ((await (await fetch(`${baseUrl}/api/categories`)).json()) as { categories: CategoryNode[] }).categories;

beforeAll(async () => {
  const migrate = Bun.spawnSync([process.execPath, 'x', 'prisma', 'migrate', 'deploy'], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (migrate.exitCode !== 0) throw new Error(`migrate failed: ${migrate.stderr.toString()}`);

  prisma = createPrisma(databaseUrl);
  const parsed = parsePack(await Bun.file(join(serverRoot, 'data/questions.json')).json());
  if (!parsed.ok) throw new Error(parsed.errors);
  starter = parsed.pack;
  await importPack(prisma, starter);

  server = createTensionServer({ prisma, adminPassword: PASSWORD });
  await new Promise<void>((done) => server.httpServer.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.close();
  await new Promise((done) => server.httpServer.close(done));
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('access', () => {
  test('is off when no password is configured', async () => {
    const response = await createAdminApi(prisma).request('/questions');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: expect.stringContaining('ADMIN_PASSWORD') });
  });

  test('needs the password', async () => {
    expect((await api('/questions', {}, 'guess')).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/admin/questions`)).status).toBe(401);
    expect((await list()).status).toBe(200);
  });
});

describe('browsing', () => {
  test('lists every category that holds questions, with counts', async () => {
    const { body } = await api<{ categories: AdminCategory[] }>('/categories');
    const geography = body.categories.find((c) => c.id === 'geography')!;
    expect(geography).toMatchObject({ name: 'Geography', active: true, questions: 3 });
    expect(geography.children.map((c) => c.name)).toEqual(['Cities', 'Countries', 'Mountains']);
    expect(body.categories.reduce((sum, c) => sum + c.questions, 0)).toBe(7);
  });

  test('pages through questions with their answers', async () => {
    const { body } = await list();
    expect(body).toMatchObject({ total: 7, page: 1, pageSize: 20 });
    expect(body.questions.map((q) => q.category)).toEqual([
      'geography/cities',
      'geography/countries',
      'geography/mountains',
      'history',
      'movies',
      'sports/baseball',
      'sports/basketball',
    ]);

    const mountains = body.questions[2];
    expect(mountains).toMatchObject({ question: 'Top 10 highest mountains in the world', cutoff: 10, active: true, games: 0 });
    expect(mountains.answers).toHaveLength(15);
    expect(mountains.answers[0]).toMatchObject({ answer: 'Mount Everest', aliases: ['everest', 'sagarmatha', 'chomolungma'] });

    expect((await list('?page=2')).body).toMatchObject({ total: 7, page: 2, questions: [] });
  });

  test('filters by category, text, difficulty and tag', async () => {
    const texts = async (query: string) => (await list(query)).body.questions.map((q) => q.question);

    expect(await texts('?category=geography')).toHaveLength(3);
    expect(await texts('?category=geography/mountains')).toEqual(['Top 10 highest mountains in the world']);
    expect(await texts('?category=geo')).toEqual([]); // whole slugs only

    expect(await texts('?q=youngest')).toEqual(['Top 10 youngest US presidents when they took office']);
    expect(await texts('?q=EVEREST')).toEqual(['Top 10 highest mountains in the world']);
    expect(await texts('?q=sagarmatha')).toEqual(['Top 10 highest mountains in the world']); // an alias

    expect(await texts('?difficulty=3')).toHaveLength(3);
    expect(await texts('?tag=box office')).toEqual(['Top 10 highest-grossing movies of all time (as of the end of 2023)']);
    expect(await texts('?tag=box')).toEqual([]); // whole tags only
    expect(await texts('?category=sports&difficulty=3&q=nba')).toEqual(['Top 8 NBA franchises by championships (through 2025)']);

    expect((await list('?sort=random')).status).toBe(400);
  });

  test('exports matching questions as a pack the importer accepts', async () => {
    const { body } = await api<unknown>('/export');
    const parsed = parsePack(body);
    if (!parsed.ok) throw new Error(parsed.errors);

    const byText = (pack: QuestionPack) => pack.questions.toSorted((a, b) => a.question.localeCompare(b.question));
    expect(byText(parsed.pack)).toEqual(byText(starter));
    expect(parsed.pack.categories).toEqual([]); // every used category is named after its slug
  });
});

describe('editing', () => {
  test('rejects an invalid question and points at each problem', async () => {
    const tooMany = await save(element({ answers: element({ cutoff: 9 }).answers }));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.issues).toEqual([{ path: ['answers'], message: expect.stringContaining('needs 8–10') }]);

    const ambiguous = element();
    ambiguous.answers[3].aliases = ['hydrogen'];
    expect((await save(ambiguous)).body.issues).toEqual([
      { path: ['answers', 3], message: '"hydrogen" also matches answer #1 (Hydrogen)' },
    ]);

    const misfiled = await save(element({ category: 'Science/Elements' }));
    expect(misfiled.body.issues?.map((issue) => issue.path)).toEqual([['category']]);
    expect((await list('?q=lightest')).body.total).toBe(0);
  });

  let added: AdminQuestion;

  test('adds a question, creating its category, and the game can draw it', async () => {
    const { status, body } = await save(element());
    expect(status).toBe(201);
    expect(body.warnings).toEqual([]);
    added = body.question;
    expect(added).toMatchObject({ category: 'science/elements', cutoff: 5, active: true, usageCount: 0, games: 0 });
    expect(added.answers.map((a) => a.answer)).toEqual(ELEMENTS.slice(0, 8));

    const categories = (await api<{ categories: AdminCategory[] }>('/categories')).body.categories;
    expect(categories.find((c) => c.id === 'science')?.children).toEqual([
      { id: 'science/elements', name: 'Elements', active: true, questions: 1, children: [] },
    ]);
    expect((await gameCategories()).find((c) => c.id === 'science')?.totalQuestions).toBe(1);

    expect((await save(element())).status).toBe(409); // same text in the same category
  });

  test('edits a question and replaces its answers in their new order', async () => {
    const reordered = element({ question: 'Top 5 lightest elements (by atomic number)' });
    reordered.answers = reordered.answers.toReversed().map((a, i) => ({ ...a, display: `${i + 1}` }));
    const { status, body } = await save(reordered, added.id);
    expect(status).toBe(200);
    expect(body.question.question).toBe('Top 5 lightest elements (by atomic number)');
    expect(body.question.answers[0].answer).toBe('Oxygen');

    const ranks = await prisma.answer.findMany({ where: { questionId: added.id }, orderBy: { rank: 'asc' } });
    expect(ranks.map((a) => `${a.rank}. ${a.answerText}`).slice(0, 2)).toEqual(['1. Oxygen', '2. Nitrogen']);

    expect((await save(reordered, 'no-such-id')).status).toBe(404);
    const clash = await save(element({ question: 'Top 5 noble gases' }));
    expect((await save(element({ question: 'Top 5 lightest elements (by atomic number)' }), clash.body.question.id)).status).toBe(409);
    expect((await remove(clash.body.question.id)).status).toBe(204);
  });

  test('saves look-alike answers with a warning', async () => {
    const countries = ['Poland', 'Holland', 'Spain', 'France', 'Italy', 'Greece', 'Turkey', 'Sweden'];
    const { status, body } = await save(
      element({ question: 'Top 5 test countries', answers: countries.map((answer) => ({ answer, aliases: [] })) }),
    );
    expect(status).toBe(201);
    expect(body.warnings).toEqual([expect.stringContaining('"Poland" (#1) and "Holland" (#2) look alike')]);
    await remove(body.question.id);
  });

  test('deactivates a question so games stop drawing it', async () => {
    const { body } = await setActive(added.id, false);
    expect(body.question.active).toBe(false);
    expect((await gameCategories()).find((c) => c.id === 'science')).toBeUndefined();
    expect((await list('?status=inactive')).body.questions.map((q) => q.id)).toEqual([added.id]);
    expect((await list('?status=active')).body.total).toBe(7);

    expect((await setActive(added.id, true)).body.question.active).toBe(true);
    expect((await setActive(added.id, 'no')).status).toBe(400);
    expect((await setActive('no-such-id', true)).status).toBe(404);
  });

  test('deletes a question only if no game has used it', async () => {
    const game = await prisma.game.create({ data: { code: 'TEST', hostToken: 'token' } });
    const played = (await list('?q=highest mountains')).body.questions[0];
    await prisma.gameQuestion.create({ data: { gameId: game.id, questionId: played.id, roundNumber: 1 } });

    const refused = await remove(played.id);
    expect(refused).toMatchObject({ status: 409, body: { error: expect.stringContaining('played in 1 game') } });
    expect((await list('?q=highest mountains')).body.questions[0].games).toBe(1);

    expect((await remove(added.id)).status).toBe(204);
    expect((await list('?category=science')).body.total).toBe(0);
    expect((await remove(added.id)).status).toBe(404);
  });

  test('exports the display names of categories that need them', async () => {
    const { body } = await save(element({ category: 'geography/uk-ireland', question: 'Top 5 elements in Ireland' }));
    const exported = await api<QuestionPack>('/export?category=geography/uk-ireland');
    expect(exported.body.categories).toEqual([{ path: 'geography/uk-ireland', name: 'UK & Ireland' }]);
    expect(exported.body.questions.map((q) => q.question)).toEqual(['Top 5 elements in Ireland']);
    await remove(body.question.id);
  });
});
