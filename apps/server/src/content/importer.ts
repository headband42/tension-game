import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { DEFAULT_CUTOFF, MIN_TENSION_ANSWERS } from '@tension/shared';
import { answerKey, confusable, normalizeAnswer, similarity } from '../game/matching';

/** Field names people reach for (often from older formats), and what to use instead. */
const FIELD_HINTS: Record<string, string> = {
  rank: 'answers are ranked by their order in the list, so remove "rank" and put them in order, #1 first',
  points: 'points come from the rank and the cutoff, so remove "points"',
  questionText: 'use "question"',
  question_text: 'use "question"',
  text: 'use "answer"',
  answerText: 'use "answer"',
  answer_text: 'use "answer"',
  value: 'use "display"',
  displayValue: 'use "display"',
  display_value: 'use "display"',
  alias: 'use "aliases", a list',
  tensionCutoff: 'use "cutoff"',
  tension_cutoff: 'use "cutoff"',
  categoryId: 'use "category", a path like "geography/mountains"',
};

function explainUnknownField(field: string, known: string[]) {
  const hint = FIELD_HINTS[field];
  if (hint) return `"${field}" isn't a field: ${hint}`;
  const [closest] = known
    .map((name) => ({ name, score: similarity(name.toLowerCase(), field.toLowerCase()) }))
    .sort((a, b) => b.score - a.score);
  return closest && closest.score >= 0.6
    ? `"${field}" isn't a field. Did you mean "${closest.name}"?`
    : `"${field}" isn't a field. Allowed: ${known.join(', ')}`;
}

/** An object schema that rejects unknown fields (so typos can't vanish silently) and explains them. */
function strictObject<T extends z.core.$ZodLooseShape>(shape: T) {
  const known = Object.keys(shape);
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys' ? issue.keys.map((key) => explainUnknownField(key, known)).join('; ') : undefined,
  });
}

const categoryPath = z
  .string()
  .regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/, 'use lower-case slugs separated by "/", e.g. "geography/mountains"');

const answerSchema = strictObject({
  answer: z.string().trim().min(1),
  display: z.string().trim().min(1).optional(),
  aliases: z.array(z.string().trim().min(1)).default([]),
});

const questionSchema = strictObject({
  category: categoryPath,
  question: z.string().trim().min(1),
  difficulty: z.number().int().min(1).max(5).default(1),
  cutoff: z.number().int().min(1).max(20).default(DEFAULT_CUTOFF),
  submitter: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  /** One ranked list, best first: the scoring answers, then the tension answers below them. */
  answers: z.array(answerSchema).min(1).max(100),
}).superRefine((q, ctx) => {
  const count = q.answers.length;
  const needed = q.cutoff + MIN_TENSION_ANSWERS;
  if (count < needed) {
    ctx.addIssue({
      code: 'custom',
      path: ['answers'],
      message:
        `lists ${count} answer${count === 1 ? '' : 's'}, but a cutoff of ${q.cutoff} needs at least ${needed}: ` +
        `the top ${q.cutoff} that score, then at least ${MIN_TENSION_ANSWERS} tension answers ranked below them`,
    });
  }

  const stated = /\btop (\d+)\b/.exec(normalizeAnswer(q.question));
  if (stated && Number(stated[1]) !== q.cutoff) {
    ctx.addIssue({
      code: 'custom',
      path: ['cutoff'],
      message:
        `the question says "Top ${stated[1]}" but the cutoff is ${q.cutoff}` +
        `${q.cutoff === DEFAULT_CUTOFF ? ' (the default)' : ''}; set "cutoff": ${stated[1]} or reword the question`,
    });
  }

  // Every spelling must point at exactly one answer, or matching becomes a coin flip.
  const owner = new Map<string, number>();
  q.answers.forEach((a, index) => {
    for (const spelling of [a.answer, ...a.aliases]) {
      const key = answerKey(spelling);
      const previous = owner.get(key);
      if (!key) {
        ctx.addIssue({ code: 'custom', path: ['answers', index], message: `"${spelling}" has no letters or digits` });
      } else if (previous !== undefined && previous !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['answers', index],
          message: `"${spelling}" also matches answer #${previous + 1} (${q.answers[previous].answer})`,
        });
      } else {
        owner.set(key, index);
      }
    }
  });
});

export const packSchema = strictObject({
  /** Optional display names for category paths; missing ones are derived from the slug. */
  categories: z.array(strictObject({ path: categoryPath, name: z.string().trim().min(1) })).default([]),
  questions: z.array(questionSchema).min(1),
});

export type QuestionPack = z.infer<typeof packSchema>;

export type ParseResult = { ok: true; pack: QuestionPack; warnings: string[] } | { ok: false; errors: string };

/**
 * Pairs of different answers in one question that are spelled or sound so alike
 * that a misspelling of one could be scored as the other. Allowed, but worth a look.
 */
export function lookalikeWarnings(pack: QuestionPack): string[] {
  const warnings: string[] = [];
  pack.questions.forEach((q, i) => {
    const spellings = q.answers.map((a) => [a.answer, ...a.aliases]);
    for (let a = 0; a < spellings.length; a++) {
      for (let b = a + 1; b < spellings.length; b++) {
        const pair = spellings[a].flatMap((x) => spellings[b].map((y) => [x, y] as const)).find(([x, y]) => confusable(x, y));
        if (pair) {
          warnings.push(
            `questions[${i}] "${q.question}": "${pair[0]}" (#${a + 1}) and "${pair[1]}" (#${b + 1}) are so alike ` +
              'that a misspelling of one could be scored as the other',
          );
        }
      }
    }
  });
  return warnings;
}

export function parsePack(data: unknown): ParseResult {
  const result = packSchema.safeParse(data);
  if (!result.success) return { ok: false, errors: z.prettifyError(result.error) };
  return { ok: true, pack: result.data, warnings: lookalikeWarnings(result.data) };
}

export interface ImportSummary {
  categoriesCreated: number;
  created: number;
  updated: number;
  skipped: number;
}

function nameFromSlug(slug: string) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Writes a validated pack. Questions are identified by category + question
 * text; existing ones are skipped unless `replace` is set, in which case their
 * details and answers are overwritten.
 */
export async function importPack(
  prisma: PrismaClient,
  pack: QuestionPack,
  { replace = false } = {},
): Promise<ImportSummary> {
  const summary: ImportSummary = { categoriesCreated: 0, created: 0, updated: 0, skipped: 0 };
  const declaredNames = new Map(pack.categories.map((c) => [c.path, c.name]));

  await prisma.$transaction(async (tx) => {
    const paths = new Set([...pack.categories.map((c) => c.path), ...pack.questions.map((q) => q.category)]);
    const ensured = new Set<string>();

    for (const fullPath of paths) {
      const segments = fullPath.split('/');
      for (let depth = 0; depth < segments.length; depth++) {
        const path = segments.slice(0, depth + 1).join('/');
        if (ensured.has(path)) continue;
        ensured.add(path);

        const name = declaredNames.get(path) ?? nameFromSlug(segments[depth]);
        const existing = await tx.category.findUnique({ where: { id: path } });
        if (!existing) {
          const parentId = depth > 0 ? segments.slice(0, depth).join('/') : null;
          await tx.category.create({ data: { id: path, path, name, parentId, depth } });
          summary.categoriesCreated++;
        } else if (declaredNames.has(path) && existing.name !== name) {
          await tx.category.update({ where: { id: path }, data: { name } });
        }
      }
    }

    for (const q of pack.questions) {
      const fields = {
        difficulty: q.difficulty,
        tensionCutoff: q.cutoff,
        submitter: q.submitter ?? null,
        source: q.source ?? null,
        tags: JSON.stringify(q.tags),
      };
      const answers = q.answers.map((a, index) => ({
        rank: index + 1,
        answerText: a.answer,
        displayValue: a.display ?? null,
        aliases: JSON.stringify(a.aliases),
      }));

      const existing = await tx.question.findFirst({ where: { categoryId: q.category, questionText: q.question } });
      if (!existing) {
        await tx.question.create({
          data: { categoryId: q.category, questionText: q.question, ...fields, answers: { create: answers } },
        });
        summary.created++;
      } else if (replace) {
        await tx.answer.deleteMany({ where: { questionId: existing.id } });
        await tx.question.update({ where: { id: existing.id }, data: { ...fields, answers: { create: answers } } });
        summary.updated++;
      } else {
        summary.skipped++;
      }
    }
  });

  return summary;
}
