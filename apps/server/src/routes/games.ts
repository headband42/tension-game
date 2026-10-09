import { Hono } from 'hono';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const gameRoutes = new Hono();

const createGameSchema = z.object({
  hostId: z.string(),
  totalRounds: z.number().min(1).max(20).default(5),
  timePerRound: z.number().min(10).max(120).default(45),
  doublesPerPlayer: z.number().min(0).max(5).default(1),
  waitForReconnects: z.boolean().default(true),
  selectedCategories: z.array(z.string()).default([]),
});

// Generate a game code like "TENSION-42"
function generateGameCode(): string {
  const adjectives = ['TENSION', 'RISK', 'DRAMA', 'STAKES', 'BLUFF', 'GUESS'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${adj}-${num}`;
}

gameRoutes.post('/', async (c) => {
  const prisma = c.get('prisma');
  const body = await c.req.json();
  
  const result = createGameSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Invalid input', details: result.error }, 400);
  }
  
  const code = generateGameCode();
  
  const game = await prisma.game.create({
    data: {
      code,
      hostId: result.data.hostId,
      status: 'waiting',
      totalRounds: result.data.totalRounds,
      timePerRound: result.data.timePerRound,
      doublesPerPlayer: result.data.doublesPerPlayer,
      waitForReconnects: result.data.waitForReconnects,
      selectedCategories: JSON.stringify(result.data.selectedCategories),
    },
  });
  
  return c.json({ game }, 201);
});

gameRoutes.get('/:code', async (c) => {
  const prisma = c.get('prisma');
  const code = c.req.param('code');
  
  const game = await prisma.game.findUnique({
    where: { code },
    include: {
      players: true,
      questions: {
        include: { question: true },
      },
    },
  });
  
  if (!game) {
    return c.json({ error: 'Game not found' }, 404);
  }
  
  return c.json({ game });
});

gameRoutes.get('/:code/leaderboard', async (c) => {
  const prisma = c.get('prisma');
  const code = c.req.param('code');
  
  const game = await prisma.game.findUnique({
    where: { code },
    include: {
      players: {
        orderBy: { score: 'desc' },
      },
      submissions: true,
    },
  });
  
  if (!game) {
    return c.json({ error: 'Game not found' }, 404);
  }
  
  return c.json({
    players: game.players,
    currentRound: game.currentRound,
    totalRounds: game.totalRounds,
  });
});

export { gameRoutes };
