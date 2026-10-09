import { describe, expect, test } from 'bun:test';
import { MISS_PENALTY, TENSION_PENALTY, type GameSettings } from '@tension/shared';
import { RoomRegistry } from '../src/game/registry';
import { MemoryStore, question } from './memory-store';

const defaults: GameSettings = { totalRounds: 2, timePerRound: 30, doublesPerPlayer: 1 };

async function newRoom(settings: Partial<GameSettings> = {}) {
  const store = new MemoryStore([question('q1'), question('q2')]);
  const registry = new RoomRegistry(store, 0);
  const room = await registry.create({ ...defaults, ...settings }, ['test']);
  return { store, registry, room };
}

function joined<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`join failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('joining', () => {
  test('rejects blank and duplicate names, and lets a device rejoin under a new name', async () => {
    const { room } = await newRoom();
    expect(room.join('   ', 'device-a', 's1').ok).toBe(false);

    const ande = joined(room.join('  Ande ', 'device-a', 's1'));
    expect(room.join('ANDE', 'device-b', 's2')).toMatchObject({ ok: false });

    const again = joined(room.join('Andy', 'device-a', 's3'));
    expect(again.playerId).toBe(ande.playerId);
    expect(room.view().players.map((p) => p.name)).toEqual(['Andy']);
  });

  test('new players cannot join after the start, but existing ones can come back', async () => {
    const { room } = await newRoom();
    const sam = joined(room.join('Sam', 'device-a', 's1'));
    await room.start();

    expect(room.join('Late', 'device-z', 's9')).toMatchObject({ ok: false, error: expect.stringContaining('started') });
    room.disconnect(sam.playerId, 's1');
    expect(room.view().players[0].connected).toBe(false);
    expect(room.join('Sam', 'device-a', 's2').ok).toBe(true);
    expect(room.view().players[0].connected).toBe(true);
  });

  test('a player stays connected while any of their sockets is open', async () => {
    const { room } = await newRoom();
    const sam = joined(room.join('Sam', 'device-a', 's1'));
    room.join('Sam', 'device-a', 's2');
    room.disconnect(sam.playerId, 's1');
    expect(room.view().players[0].connected).toBe(true);
  });
});

describe('a round', () => {
  test('cannot start without players', async () => {
    const { room } = await newRoom();
    expect(await room.start()).toMatchObject({ ok: false });
    expect(room.phase).toBe('lobby');
  });

  test('scores hits, misses, tension and doubles once everyone locks in', async () => {
    const { room, store } = await newRoom({ doublesPerPlayer: 1 });
    const a = joined(room.join('A', 'device-a', 'sa'));
    const b = joined(room.join('B', 'device-b', 'sb'));
    const c = joined(room.join('C', 'device-c', 'sc'));
    expect(await room.start()).toEqual({ ok: true });
    expect(room.view()).toMatchObject({ phase: 'playing', round: 1, totalRounds: 2, reveal: null });

    room.lock(a.playerId, 'q1 answer 2', true); // #2 doubled → 4
    room.lock(b.playerId, 'q1 answer 4', false); // #4 with cutoff 3 → tension
    expect(room.phase).toBe('playing');
    expect(room.view().players.find((p) => p.id === a.playerId)).toMatchObject({ status: 'locked', doubled: true });
    room.lock(c.playerId, 'something else', true); // miss, doubled

    expect(room.phase).toBe('reveal');
    const scores = Object.fromEntries(room.view().players.map((p) => [p.name, [p.score, p.doublesRemaining]]));
    expect(scores).toEqual({ A: [4, 0], B: [TENSION_PENALTY, 1], C: [MISS_PENALTY * 2, 0] });

    const reveal = room.view().reveal!;
    expect(reveal.answers.map((x) => x.points)).toEqual([1, 2, 3, TENSION_PENALTY, TENSION_PENALTY]);
    expect(reveal.answers[1].pickedBy).toEqual([a.playerId]);
    expect(reveal.results.find((r) => r.playerId === b.playerId)).toMatchObject({ rank: 4, outcome: 'tension' });

    await room.flush();
    expect(store.submissions).toHaveLength(3);
  });

  test('the timer locks in whatever each player had typed', async () => {
    const { room } = await newRoom({ timePerRound: 0.05 });
    const a = joined(room.join('A', 'device-a', 'sa'));
    const b = joined(room.join('B', 'device-b', 'sb'));
    await room.start();

    room.draft(a.playerId, 'q1 answer 3', false);
    expect(room.you(a.playerId)).toMatchObject({ answer: 'q1 answer 3', locked: false });
    room.draft(b.playerId, '', true); // blank with a double: should not burn the double

    await sleep(120);
    expect(room.phase).toBe('reveal');
    const [resultA, resultB] = room.view().reveal!.results;
    expect(resultA).toMatchObject({ playerId: a.playerId, rank: 3, points: 3 });
    expect(resultB).toMatchObject({ playerId: b.playerId, answer: '', points: MISS_PENALTY, doubled: false });
    expect(room.view().players[1].doublesRemaining).toBe(1);
  });

  test('ignores changes after a player has locked in', async () => {
    const { room } = await newRoom();
    const a = joined(room.join('A', 'device-a', 'sa'));
    joined(room.join('B', 'device-b', 'sb'));
    await room.start();

    room.lock(a.playerId, 'q1 answer 1', false);
    room.draft(a.playerId, 'q1 answer 3', false);
    room.lock(a.playerId, 'q1 answer 3', false);
    expect(room.you(a.playerId)).toMatchObject({ answer: 'q1 answer 1', locked: true });
  });

  test('waits for disconnected players until the host stops waiting', async () => {
    const { room } = await newRoom();
    const a = joined(room.join('A', 'device-a', 'sa'));
    const b = joined(room.join('B', 'device-b', 'sb'));
    await room.start();

    room.disconnect(b.playerId, 'sb');
    room.lock(a.playerId, 'q1 answer 1', false);
    expect(room.phase).toBe('playing');

    room.skipOfflinePlayers();
    expect(room.phase).toBe('reveal');
  });

  test('the host can end a round early and step through to the final standings', async () => {
    const { room, store } = await newRoom();
    joined(room.join('A', 'device-a', 'sa'));
    await room.start();

    room.endRound();
    expect(room.phase).toBe('reveal');
    room.next();
    expect(room.view()).toMatchObject({ phase: 'playing', round: 2, question: { text: 'Question q2' } });
    room.endRound();
    room.next();
    expect(room.phase).toBe('finished');

    await room.flush();
    expect([...store.games.values()][0].status).toBe('completed');
  });

  test('the answer key is only sent once the round is over', async () => {
    const { room } = await newRoom();
    joined(room.join('A', 'device-a', 'sa'));
    await room.start();
    expect(JSON.stringify(room.view())).not.toContain('q1 answer');
    room.endRound();
    expect(JSON.stringify(room.view())).toContain('q1 answer');
  });
});

describe('the registry', () => {
  test('looks codes up case-insensitively and loads each room once', async () => {
    const { registry, room } = await newRoom();
    const [first, second] = await Promise.all([registry.get(room.code.toLowerCase()), registry.get(room.code)]);
    expect(first).toBe(room);
    expect(second).toBe(room);
    expect(await registry.get('ZZZZ')).toBeNull();
  });

  test('restores a game mid-way after a restart, parked between rounds', async () => {
    const { store, room } = await newRoom();
    const a = joined(room.join('A', 'device-a', 'sa'));
    await room.start();
    room.lock(a.playerId, 'q1 answer 3', false);
    room.next();
    await room.flush();

    // A fresh registry over the same store stands in for a restarted server.
    const restored = (await new RoomRegistry(store, 0).get(room.code))!;
    expect(restored).not.toBe(room);
    expect(restored.view()).toMatchObject({ phase: 'reveal', round: 1, resumed: true, reveal: null });
    expect(restored.view().players[0]).toMatchObject({ score: 3, connected: false });
    expect(restored.isHost(room.hostToken)).toBe(true);

    restored.next();
    expect(restored.view()).toMatchObject({ phase: 'playing', round: 2, resumed: false });
    restored.dispose();
    room.dispose();
  });
});
