import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import {
  MISS_PENALTY,
  type Ack,
  type CategoryNode,
  type ClientToServerEvents,
  type CreateGameResponse,
  type ServerToClientEvents,
  type StatePayload,
} from '@tension/shared';
import { importPack, parsePack } from '../src/content/importer';
import { createPrisma } from '../src/db';
import { createTensionServer } from '../src/server';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const serverRoot = resolve(import.meta.dir, '..');
const tempDir = mkdtempSync(join(tmpdir(), 'tension-test-'));
const databaseUrl = `file:${join(tempDir, 'test.db')}`;

let prisma: PrismaClient;
let server: ReturnType<typeof createTensionServer>;
let baseUrl: string;
const clients: Client[] = [];

async function startServer(webDir?: string) {
  server = createTensionServer({ prisma, webDir, graceMs: 50 });
  await new Promise<void>((done) => server.httpServer.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
}

async function stopServer() {
  clients.splice(0).forEach((c) => c.disconnect());
  await server.close();
  await new Promise((done) => server.httpServer.close(done));
}

/** A socket that remembers the latest state and can wait for a state matching a condition. */
function connectClient() {
  const socket: Client = io(baseUrl, { forceNew: true });
  clients.push(socket);
  let latest: StatePayload | null = null;
  const waiters: { check: (s: StatePayload) => boolean; done: (s: StatePayload) => void }[] = [];

  socket.on('state', (state) => {
    latest = state;
    for (const waiter of [...waiters]) {
      if (waiter.check(state)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.done(state);
      }
    }
  });

  return {
    socket,
    get state() {
      return latest;
    },
    until(check: (s: StatePayload) => boolean, label = 'state'): Promise<StatePayload> {
      if (latest && check(latest)) return Promise.resolve(latest);
      return new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error(`timed out waiting for ${label}`)), 3000);
        waiters.push({ check, done: (s) => (clearTimeout(timer), done(s)) });
      });
    },
  };
}

const ok = <T extends object>(result: Ack<T>) => {
  if (!result.ok) throw new Error(result.error);
  return result;
};

async function createGame(body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as CreateGameResponse & { error?: string } };
}

async function answerKey(questionText: string) {
  const question = await prisma.question.findFirstOrThrow({
    where: { questionText },
    include: { answers: { orderBy: { rank: 'asc' } } },
  });
  return { cutoff: question.tensionCutoff, answers: question.answers.map((a) => a.answerText) };
}

beforeAll(async () => {
  const migrate = Bun.spawnSync([process.execPath, 'x', 'prisma', 'migrate', 'deploy'], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (migrate.exitCode !== 0) throw new Error(`migrate failed: ${migrate.stderr.toString()}`);

  prisma = createPrisma(databaseUrl);
  const parsed = parsePack(await Bun.file(join(serverRoot, 'data/questions.json')).json());
  if (!parsed.ok) throw new Error(parsed.errors);
  await importPack(prisma, parsed.pack);
  await startServer();
});

afterAll(async () => {
  await stopServer();
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('HTTP API', () => {
  test('lists categories as a tree with question counts', async () => {
    const { categories } = (await (await fetch(`${baseUrl}/api/categories`)).json()) as { categories: CategoryNode[] };
    const geography = categories.find((c) => c.id === 'geography')!;
    expect(geography).toMatchObject({ name: 'Geography', ownQuestions: 0, totalQuestions: 3 });
    expect(geography.children.map((c) => c.name)).toEqual(['Cities', 'Countries', 'Mountains']);
    expect(categories.reduce((sum, c) => sum + c.totalQuestions, 0)).toBe(7);
  });

  test('validates new games', async () => {
    const settings = { totalRounds: 3, timePerRound: 30, doublesPerPlayer: 1 };
    expect((await createGame({ ...settings, categoryIds: [] })).status).toBe(400);
    expect((await createGame({ ...settings, timePerRound: 5, categoryIds: ['movies'] })).status).toBe(400);
    expect((await createGame({ ...settings, categoryIds: ['no-such-category'] })).status).toBe(400);

    const created = await createGame({ ...settings, categoryIds: ['movies', 'history'] });
    expect(created.status).toBe(201);
    expect(created.body.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(created.body.hostToken).toBeString();
  });

  test('questions without a tension answer are never offered, even if they bypass the importer', async () => {
    await prisma.category.create({ data: { id: 'hand-edited', path: 'hand-edited', name: 'Hand edited' } });
    await prisma.question.create({
      data: {
        categoryId: 'hand-edited',
        questionText: 'Top 3 with no tension zone',
        tensionCutoff: 3,
        answers: { create: ['One', 'Two', 'Three'].map((answerText, i) => ({ rank: i + 1, answerText })) },
      },
    });

    const { categories } = (await (await fetch(`${baseUrl}/api/categories`)).json()) as { categories: CategoryNode[] };
    expect(categories.map((c) => c.id)).not.toContain('hand-edited');
    const created = await createGame({ totalRounds: 1, timePerRound: 30, doublesPerPlayer: 1, categoryIds: ['hand-edited'] });
    expect(created).toMatchObject({ status: 400, body: { error: 'There are no questions in the selected categories' } });
  });

  test('unknown API routes are JSON 404s', async () => {
    const response = await fetch(`${baseUrl}/api/questions`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });
});

describe('a full game over sockets', () => {
  test('host and two phones play every round, with a reconnect in the middle', async () => {
    const { body: game } = await createGame({
      totalRounds: 2,
      timePerRound: 30,
      doublesPerPlayer: 1,
      categoryIds: ['geography/mountains', 'geography/countries'],
    });

    const host = connectClient();
    expect(await host.socket.emitWithAck('host:join', { code: game.code, token: 'wrong' })).toMatchObject({ ok: false });
    ok(await host.socket.emitWithAck('host:join', { code: game.code.toLowerCase(), token: game.hostToken }));
    await host.until((s) => s.game.phase === 'lobby' && s.you === null, 'host lobby');

    const ann = connectClient();
    const ben = connectClient();
    expect(await ann.socket.emitWithAck('player:join', { code: 'ZZZZ', name: 'Ann', deviceId: 'device-ann' })).toMatchObject({
      ok: false,
      error: 'No game with that code',
    });
    const annId = ok(await ann.socket.emitWithAck('player:join', { code: game.code, name: 'Ann', deviceId: 'device-ann' })).playerId;
    const benId = ok(await ben.socket.emitWithAck('player:join', { code: game.code, name: 'Ben', deviceId: 'device-ben' })).playerId;
    await host.until((s) => s.game.players.length === 2, 'both players in lobby');

    // Players cannot drive the game.
    expect(await ann.socket.emitWithAck('host:start')).toMatchObject({ ok: false });
    ok(await host.socket.emitWithAck('host:start'));

    // Round 1: Ann doubles the #1 answer; Ben types the cutoff answer, drops, rejoins, and never locks.
    let round = await ann.until((s) => s.game.phase === 'playing', 'round 1');
    expect(round.game.remainingMs).toBeGreaterThan(25_000);
    let key = await answerKey(round.game.question!.text);

    ben.socket.emit('player:draft', { answer: key.answers[key.cutoff - 1], useDouble: false });
    await host.until((s) => s.game.players.find((p) => p.id === benId)?.status === 'typing', 'Ben typing');
    ben.socket.disconnect();
    await host.until((s) => s.game.players.find((p) => p.id === benId)?.connected === false, 'Ben offline');

    const benAgain = connectClient();
    ok(await benAgain.socket.emitWithAck('player:join', { code: game.code, name: 'Ben', deviceId: 'device-ben' }));
    const restored = await benAgain.until((s) => s.you !== null, 'Ben restored');
    expect(restored.you).toMatchObject({ playerId: benId, answer: key.answers[key.cutoff - 1], locked: false });

    ann.socket.emit('player:lock', { answer: key.answers[0].toUpperCase(), useDouble: true });
    await host.until((s) => s.game.players.find((p) => p.id === annId)?.status === 'locked', 'Ann locked');
    host.socket.emit('host:endRound');

    let reveal = await benAgain.until((s) => s.game.phase === 'reveal', 'round 1 reveal');
    const scores = () => Object.fromEntries(reveal.game.players.map((p) => [p.name, p.score]));
    expect(scores()).toEqual({ Ann: 2, Ben: key.cutoff });
    expect(reveal.game.reveal!.answers[0].pickedBy).toEqual([annId]);

    // Round 2: both miss.
    host.socket.emit('host:next');
    round = await ann.until((s) => s.game.phase === 'playing' && s.game.round === 2, 'round 2');
    key = await answerKey(round.game.question!.text);
    expect(round.game.players.find((p) => p.id === annId)!.doublesRemaining).toBe(0);
    ann.socket.emit('player:lock', { answer: 'Atlantis', useDouble: true });
    benAgain.socket.emit('player:lock', { answer: 'Mount Doom', useDouble: false });
    reveal = await host.until((s) => s.game.phase === 'reveal' && s.game.round === 2, 'round 2 reveal');
    expect(scores()).toEqual({ Ann: 2 + MISS_PENALTY, Ben: key.cutoff + MISS_PENALTY });

    host.socket.emit('host:next');
    await ann.until((s) => s.game.phase === 'finished', 'final standings');

    await server.registry.get(game.code).then((room) => room!.flush());
    const saved = await prisma.game.findUniqueOrThrow({
      where: { code: game.code },
      include: { players: true, submissions: true },
    });
    expect(saved.status).toBe('completed');
    expect(saved.submissions).toHaveLength(4);
    expect(Object.fromEntries(saved.players.map((p) => [p.name, p.score]))).toEqual(scores());
  });

  test('a game survives a server restart between rounds', async () => {
    const { body: game } = await createGame({ totalRounds: 2, timePerRound: 30, doublesPerPlayer: 0, categoryIds: ['movies', 'history'] });
    const host = connectClient();
    const ann = connectClient();
    ok(await host.socket.emitWithAck('host:join', { code: game.code, token: game.hostToken }));
    ok(await ann.socket.emitWithAck('player:join', { code: game.code, name: 'Ann', deviceId: 'device-ann-2' }));
    ok(await host.socket.emitWithAck('host:start'));
    const round = await ann.until((s) => s.game.phase === 'playing', 'round 1');
    const key = await answerKey(round.game.question!.text);
    ann.socket.emit('player:lock', { answer: key.answers[2], useDouble: false });
    await host.until((s) => s.game.phase === 'reveal', 'reveal');
    await (await server.registry.get(game.code))!.flush();

    await stopServer();
    await startServer();

    const newHost = connectClient();
    ok(await newHost.socket.emitWithAck('host:join', { code: game.code, token: game.hostToken }));
    const resumed = await newHost.until(() => true);
    expect(resumed.game).toMatchObject({ phase: 'reveal', round: 1, resumed: true });
    expect(resumed.game.players[0]).toMatchObject({ name: 'Ann', score: 3, connected: false });

    newHost.socket.emit('host:next');
    await newHost.until((s) => s.game.phase === 'playing' && s.game.round === 2, 'round 2 after restart');
  });
});

describe('serving the built web app', () => {
  test('serves files and falls back to index.html for client-side routes', async () => {
    const webDir = join(tempDir, 'web');
    mkdirSync(webDir, { recursive: true });
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Tension</title>');
    writeFileSync(join(webDir, 'app.js'), 'console.log(1)');

    await stopServer();
    await startServer(webDir);

    expect(await (await fetch(`${baseUrl}/`)).text()).toContain('<title>Tension</title>');
    expect(await (await fetch(`${baseUrl}/app.js`)).text()).toBe('console.log(1)');
    expect(await (await fetch(`${baseUrl}/play/ABCD`)).text()).toContain('<title>Tension</title>');
    expect((await fetch(`${baseUrl}/api/nope`)).status).toBe(404);
  });
});
