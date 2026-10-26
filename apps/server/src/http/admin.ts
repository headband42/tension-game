import { createHash, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  QUESTION_SORTS,
  QUESTION_STATUSES,
  QUESTIONS_PER_PAGE,
  type AdminCategory,
  type AdminErrorResponse,
  type AdminQuestion,
  type QuestionListResponse,
  type QuestionSort,
  type SaveQuestionResponse,
} from '@tension/shared';
import { answerRows, ensureCategories, nameFromSlug, parseQuestion, questionFields, type PackQuestion } from '../content/importer';
import { parseStringArray } from '../game/store';

const filtersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().max(200).optional(),
  status: z.enum(QUESTION_STATUSES).default('all'),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  tag: z.string().max(200).optional(),
  sort: z.enum(QUESTION_SORTS).default('category'),
  page: z.coerce.number().int().min(1).default(1),
});

type Filters = z.infer<typeof filtersSchema>;

function questionWhere({ q, category, status, difficulty, tag }: Filters): Prisma.QuestionWhereInput {
  const conditions: Prisma.QuestionWhereInput[] = [];
  // Category ids are their paths, so a prefix finds the sub-categories.
  if (category) conditions.push({ OR: [{ categoryId: category }, { categoryId: { startsWith: `${category}/` } }] });
  if (status !== 'all') conditions.push({ active: status === 'active' });
  if (difficulty) conditions.push({ difficulty });
  // Tags are stored as a JSON array, so the quoted tag matches a whole entry.
  if (tag) conditions.push({ tags: { contains: JSON.stringify(tag) } });
  if (q) {
    conditions.push({
      OR: [
        { questionText: { contains: q } },
        { answers: { some: { OR: [{ answerText: { contains: q } }, { aliases: { contains: q } }] } } },
      ],
    });
  }
  return { AND: conditions };
}

const ORDER: Record<QuestionSort, Prisma.QuestionOrderByWithRelationInput[]> = {
  category: [{ categoryId: 'asc' }, { questionText: 'asc' }],
  newest: [{ createdAt: 'desc' }],
  'most-played': [{ usageCount: 'desc' }, { categoryId: 'asc' }, { questionText: 'asc' }],
  'least-played': [{ usageCount: 'asc' }, { categoryId: 'asc' }, { questionText: 'asc' }],
};

const questionDetails = {
  answers: { orderBy: { rank: 'asc' } },
  _count: { select: { games: true } },
} as const;

type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof questionDetails }>;

function toAdminQuestion(row: QuestionRow): AdminQuestion {
  return {
    id: row.id,
    category: row.categoryId,
    question: row.questionText,
    cutoff: row.tensionCutoff,
    difficulty: row.difficulty,
    submitter: row.submitter ?? undefined,
    source: row.source ?? undefined,
    tags: parseStringArray(row.tags),
    answers: row.answers.map((a) => ({
      answer: a.answerText,
      display: a.displayValue ?? undefined,
      aliases: parseStringArray(a.aliases),
    })),
    active: row.active,
    usageCount: row.usageCount,
    games: row._count.games,
  };
}

/** A question as the bundled packs write it: fields in their usual order, empty lists left out. */
function toPackQuestion({ category, question, cutoff, difficulty, submitter, source, tags, answers }: AdminQuestion) {
  return {
    category,
    question,
    cutoff,
    difficulty,
    submitter,
    source,
    ...(tags.length > 0 && { tags }),
    answers: answers.map(({ answer, display, aliases }) => ({ answer, display, ...(aliases.length > 0 && { aliases }) })),
  };
}

/** Every category that holds questions, active or not, as a tree with question counts. */
async function categoryTree(prisma: PrismaClient): Promise<AdminCategory[]> {
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
    prisma.question.groupBy({ by: ['categoryId'], _count: { _all: true } }),
  ]);
  const own = new Map(counts.map((c) => [c.categoryId, c._count._all]));

  const nodes = new Map<string, AdminCategory>(
    categories.map((c) => [c.id, { id: c.id, name: c.name, active: c.active, questions: own.get(c.id) ?? 0, children: [] }]),
  );
  const roots: AdminCategory[] = [];
  for (const category of categories) {
    const parent = category.parentId ? nodes.get(category.parentId) : undefined;
    (parent?.children ?? roots).push(nodes.get(category.id)!);
  }

  const total = (node: AdminCategory): number =>
    (node.questions += node.children.reduce((sum, child) => sum + total(child), 0));
  const prune = (list: AdminCategory[]): AdminCategory[] =>
    list.filter((node) => node.questions > 0).map((node) => ({ ...node, children: prune(node.children) }));

  roots.forEach(total);
  return prune(roots);
}

/** Compares secrets in constant time, whatever their lengths. */
function sameSecret(given: string, expected: string) {
  const digest = (secret: string) => createHash('sha256').update(secret).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

const patchSchema = z.object({ active: z.boolean() });

/**
 * The question manager's API. It hands out answer keys, so every request must
 * carry the password (URI-encoded, so any characters work in a header) as a
 * bearer token. Without a password configured, it stays off.
 */
export function createAdminApi(prisma: PrismaClient, password?: string) {
  const admin = new Hono();

  const error = (message: string, extra: Omit<AdminErrorResponse, 'error'> = {}): AdminErrorResponse => ({ error: message, ...extra });

  admin.use('*', async (c, next) => {
    if (!password) {
      return c.json(error('The question manager is off. Set ADMIN_PASSWORD in apps/server/.env and restart the server.'), 403);
    }
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? '';
    if (!sameSecret(token, encodeURIComponent(password))) return c.json(error('Wrong password'), 401);
    await next();
  });

  const loadQuestion = async (id: string) =>
    toAdminQuestion(await prisma.question.findUniqueOrThrow({ where: { id }, include: questionDetails }));

  /** The importer tells questions apart by category and text, so two can't share both. */
  const takenBy = async (q: PackQuestion, exceptId?: string) =>
    prisma.question.findFirst({
      where: { categoryId: q.category, questionText: q.question, ...(exceptId && { id: { not: exceptId } }) },
      select: { id: true },
    });
  const duplicate = error('This category already has a question with exactly this text.');
  const notFound = error('No such question. It may have been deleted.');

  admin.get('/categories', async (c) => c.json({ categories: await categoryTree(prisma) }));

  admin.get('/questions', async (c) => {
    const parsed = filtersSchema.safeParse(c.req.query());
    if (!parsed.success) return c.json(error('Invalid filters'), 400);

    const { page, sort } = parsed.data;
    const where = questionWhere(parsed.data);
    const [total, rows] = await prisma.$transaction([
      prisma.question.count({ where }),
      prisma.question.findMany({
        where,
        orderBy: [...ORDER[sort], { id: 'asc' }],
        skip: (page - 1) * QUESTIONS_PER_PAGE,
        take: QUESTIONS_PER_PAGE,
        include: questionDetails,
      }),
    ]);
    return c.json({ questions: rows.map(toAdminQuestion), total, page, pageSize: QUESTIONS_PER_PAGE } satisfies QuestionListResponse);
  });

  /** Every question matching the filters as a question pack, so edits can go back into a pack file. */
  admin.get('/export', async (c) => {
    const parsed = filtersSchema.safeParse(c.req.query());
    if (!parsed.success) return c.json(error('Invalid filters'), 400);

    const [rows, categories] = await Promise.all([
      prisma.question.findMany({
        where: questionWhere(parsed.data),
        orderBy: [...ORDER[parsed.data.sort], { id: 'asc' }],
        include: questionDetails,
      }),
      prisma.category.findMany({ orderBy: { id: 'asc' } }),
    ]);
    // Only names that differ from the slug need declaring (see docs/QUESTIONS.md).
    const used = new Set(
      rows.flatMap((row) => row.categoryId.split('/').map((_, depth, slugs) => slugs.slice(0, depth + 1).join('/'))),
    );
    const named = categories.filter((cat) => used.has(cat.id) && cat.name !== nameFromSlug(cat.id.split('/').at(-1)!));
    return c.json({
      ...(named.length > 0 && { categories: named.map((cat) => ({ path: cat.id, name: cat.name })) }),
      questions: rows.map((row) => toPackQuestion(toAdminQuestion(row))),
    });
  });

  admin.post('/questions', async (c) => {
    const parsed = parseQuestion(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json(error('Fix the problems below and save again.', { issues: parsed.issues }), 400);

    const q = parsed.question;
    if (await takenBy(q)) return c.json(duplicate, 409);
    const { id } = await prisma.$transaction(async (tx) => {
      await ensureCategories(tx, [q.category]);
      return tx.question.create({
        data: { categoryId: q.category, questionText: q.question, ...questionFields(q), answers: { create: answerRows(q) } },
      });
    });
    return c.json({ question: await loadQuestion(id), warnings: parsed.warnings } satisfies SaveQuestionResponse, 201);
  });

  /** Replaces a question's details and its whole answer list, as `bun run import --replace` would. */
  admin.put('/questions/:id', async (c) => {
    const id = c.req.param('id');
    if (!(await prisma.question.findUnique({ where: { id }, select: { id: true } }))) return c.json(notFound, 404);

    const parsed = parseQuestion(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json(error('Fix the problems below and save again.', { issues: parsed.issues }), 400);

    const q = parsed.question;
    if (await takenBy(q, id)) return c.json(duplicate, 409);
    await prisma.$transaction(async (tx) => {
      await ensureCategories(tx, [q.category]);
      await tx.answer.deleteMany({ where: { questionId: id } });
      await tx.question.update({
        where: { id },
        data: { categoryId: q.category, questionText: q.question, ...questionFields(q), answers: { create: answerRows(q) } },
      });
    });
    return c.json({ question: await loadQuestion(id), warnings: parsed.warnings } satisfies SaveQuestionResponse);
  });

  admin.patch('/questions/:id', async (c) => {
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(error('Send { "active": true } or { "active": false }'), 400);

    const id = c.req.param('id');
    const { count } = await prisma.question.updateMany({ where: { id }, data: { active: parsed.data.active } });
    if (count === 0) return c.json(notFound, 404);
    return c.json({ question: await loadQuestion(id) });
  });

  admin.delete('/questions/:id', async (c) => {
    const id = c.req.param('id');
    const question = await prisma.question.findUnique({ where: { id }, select: { _count: { select: { games: true } } } });
    if (!question) return c.json(notFound, 404);

    const games = question._count.games;
    if (games > 0) {
      return c.json(
        error(`This question was played in ${games} game${games === 1 ? '' : 's'}, and deleting it would break their history. Deactivate it instead.`),
        409,
      );
    }
    await prisma.question.delete({ where: { id } });
    return c.body(null, 204);
  });

  return admin;
}
