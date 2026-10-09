import { Hono } from 'hono';
import { z } from 'zod';

const questionRoutes = new Hono();

// Get all questions
questionRoutes.get('/', async (c) => {
  const prisma = c.get('prisma');
  const categoryId = c.req.query('category');
  
  const where: any = { active: true };
  if (categoryId) {
    where.categoryId = categoryId;
  }
  
  const questions = await prisma.question.findMany({
    where,
    include: {
      answers: {
        orderBy: { rank: 'asc' },
      },
      category: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  
  return c.json({ questions });
});

// Get a single question
questionRoutes.get('/:id', async (c) => {
  const prisma = c.get('prisma');
  const id = c.req.param('id');
  
  const question = await prisma.question.findUnique({
    where: { id },
    include: {
      answers: {
        orderBy: { rank: 'asc' },
      },
      category: true,
    },
  });
  
  if (!question) {
    return c.json({ error: 'Question not found' }, 404);
  }
  
  return c.json({ question });
});

// Create a new question
questionRoutes.post('/', async (c) => {
  const prisma = c.get('prisma');
  const body = await c.req.json();
  
  const answerSchema = z.object({
    rank: z.number(),
    answerText: z.string(),
    displayValue: z.string().optional(),
    points: z.number(),
    aliases: z.array(z.string()).default([]),
  });
  
  const schema = z.object({
    categoryId: z.string(),
    difficulty: z.number().min(1).max(5).default(1),
    questionText: z.string(),
    tensionCutoff: z.number().default(10),
    submitter: z.string().optional(),
    source: z.string().optional(),
    tags: z.array(z.string()).default([]),
    answers: z.array(answerSchema),
  });
  
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Invalid input', details: result.error }, 400);
  }
  
  const { answers, tags, ...questionData } = result.data;
  
  const question = await prisma.question.create({
    data: {
      ...questionData,
      tags: JSON.stringify(tags),
      answers: {
        create: answers.map(a => ({
          ...a,
          aliases: JSON.stringify(a.aliases),
        })),
      },
    },
    include: {
      answers: true,
    },
  });
  
  // Update category question count
  await prisma.category.update({
    where: { id: questionData.categoryId },
    data: {
      questionCount: {
        increment: 1,
      },
    },
  });
  
  return c.json({ question }, 201);
});

// Bulk import questions
questionRoutes.post('/bulk', async (c) => {
  const prisma = c.get('prisma');
  const body = await c.req.json();
  
  if (!Array.isArray(body.questions)) {
    return c.json({ error: 'Expected questions array' }, 400);
  }
  
  const results = [];
  
  for (const q of body.questions) {
    try {
      const question = await prisma.question.create({
        data: {
          categoryId: q.categoryId,
          difficulty: q.difficulty || 1,
          questionText: q.questionText,
          tensionCutoff: q.tensionCutoff || 10,
          submitter: q.submitter,
          source: q.source,
          tags: JSON.stringify(q.tags || []),
          answers: {
            create: (q.answers || []).map((a: any) => ({
              rank: a.rank,
              answerText: a.answerText,
              displayValue: a.displayValue,
              points: a.points || a.rank,
              aliases: JSON.stringify(a.aliases || []),
            })),
          },
        },
        include: { answers: true },
      });
      results.push({ success: true, question });
    } catch (err: any) {
      results.push({ success: false, error: err.message, question: q });
    }
  }
  
  return c.json({ results }, 201);
});

export { questionRoutes };
