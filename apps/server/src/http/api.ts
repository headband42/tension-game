import { networkInterfaces } from 'node:os';
import type { PrismaClient } from '@prisma/client';
import { Hono } from 'hono';
import { z } from 'zod';
import { SETTINGS_LIMITS, type CategoryNode, type CreateGameResponse, type ServerInfo } from '@tension/shared';
import type { RoomRegistry } from '../game/registry';
import { playableQuestions, type GameStore } from '../game/store';
import { createAdminApi } from './admin';

const { totalRounds, timePerRound, doublesPerPlayer } = SETTINGS_LIMITS;

const createGame = z.object({
  totalRounds: z.number().int().min(totalRounds.min).max(totalRounds.max),
  timePerRound: z.number().int().min(timePerRound.min).max(timePerRound.max),
  doublesPerPlayer: z.number().int().min(doublesPerPlayer.min).max(doublesPerPlayer.max),
  categoryIds: z.array(z.string().max(200)).min(1).max(500),
});

/** Typical home-network ranges first, so Docker bridges and VPNs don't end up in the join link. */
function lanPreference(address: string) {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface!.address)
    .sort((a, b) => lanPreference(a) - lanPreference(b));
}

/** Active categories that contain at least one playable question, as a tree. */
export async function categoryTree(prisma: PrismaClient): Promise<CategoryNode[]> {
  const [categories, questions] = await Promise.all([
    prisma.category.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    playableQuestions(prisma),
  ]);
  const own = new Map<string, number>();
  for (const q of questions) own.set(q.categoryId, (own.get(q.categoryId) ?? 0) + 1);

  const nodes = new Map<string, CategoryNode>(
    categories.map((c) => [c.id, { id: c.id, name: c.name, ownQuestions: own.get(c.id) ?? 0, totalQuestions: 0, children: [] }]),
  );
  const roots: CategoryNode[] = [];
  for (const category of categories) {
    const node = nodes.get(category.id)!;
    if (!category.parentId) roots.push(node);
    else nodes.get(category.parentId)?.children.push(node); // children of inactive parents are hidden
  }

  const total = (node: CategoryNode): number =>
    (node.totalQuestions = node.ownQuestions + node.children.reduce((sum, child) => sum + total(child), 0));
  const prune = (list: CategoryNode[]): CategoryNode[] =>
    list.filter((node) => node.totalQuestions > 0).map((node) => ({ ...node, children: prune(node.children) }));

  roots.forEach(total);
  return prune(roots);
}

export function createApi(prisma: PrismaClient, store: GameStore, registry: RoomRegistry, adminPassword?: string) {
  const api = new Hono();

  api.get('/health', (c) => c.json({ ok: true }));

  api.get('/info', (c) => c.json({ lanAddresses: lanAddresses() } satisfies ServerInfo));

  api.get('/categories', async (c) => c.json({ categories: await categoryTree(prisma) }));

  api.post('/games', async (c) => {
    const parsed = createGame.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid game settings' }, 400);

    const { categoryIds, ...settings } = parsed.data;
    const available = await store.countQuestions(categoryIds);
    if (available === 0) return c.json({ error: 'There are no questions in the selected categories' }, 400);

    const room = await registry.create({ ...settings, totalRounds: Math.min(settings.totalRounds, available) }, categoryIds);
    return c.json({ code: room.code, hostToken: room.hostToken } satisfies CreateGameResponse, 201);
  });

  api.route('/admin', createAdminApi(prisma, adminPassword));

  api.all('*', (c) => c.json({ error: 'Not found' }, 404));

  return api;
}
