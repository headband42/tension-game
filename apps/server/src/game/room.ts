import {
  DOUBLE_MULTIPLIER,
  MAX_ANSWER_LENGTH,
  MAX_NAME_LENGTH,
  outcomeForRank,
  pointsForRank,
  type Ack,
  type GameSettings,
  type GameView,
  type Phase,
  type PlayerStatus,
  type RevealView,
  type RoundResult,
  type YouView,
} from '@tension/shared';
import { matchAnswer, normalizeAnswer } from './matching';
import type { GameStore, RoundQuestion, StoredGame, StoredPlayer, SubmissionRecord } from './store';

/**
 * How long past the visible deadline a round stays open, so a phone that
 * auto-locks at 0:00 still gets its answer in.
 */
export const DEFAULT_GRACE_MS = 1500;

interface Player extends StoredPlayer {
  /** Open sockets for this player; more than one if they have the game open twice. */
  sockets: Set<string>;
}

interface Entry {
  answer: string;
  useDouble: boolean;
  locked: boolean;
  lockedAt: Date | null;
}

const fail = (error: string) => ({ ok: false, error }) as const;

function cleanAnswer(answer: unknown): string {
  return typeof answer === 'string' ? answer.slice(0, MAX_ANSWER_LENGTH) : '';
}

/**
 * One game, from lobby to final standings. All state changes happen
 * synchronously so socket events can never interleave halfway through one;
 * database writes are queued behind them in order.
 */
export class GameRoom {
  phase: Phase = 'lobby';
  round = 0;
  lastActivity = Date.now();
  /** Called after every visible change; the socket layer broadcasts from here. */
  onChange: () => void = () => {};

  private questions: RoundQuestion[] = [];
  private readonly players = new Map<string, Player>();
  private entries = new Map<string, Entry>();
  private skipOffline = false;
  private deadline = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reveal: RevealView | null = null;
  private resumed = false;
  private starting = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    readonly code: string,
    readonly hostToken: string,
    readonly settings: GameSettings,
    readonly categoryIds: string[],
    private readonly store: GameStore,
    private readonly graceMs = DEFAULT_GRACE_MS,
  ) {}

  /** Rebuilds a room from the database, e.g. after a server restart. */
  static restore(game: StoredGame, store: GameStore, graceMs = DEFAULT_GRACE_MS): GameRoom {
    const room = new GameRoom(game.id, game.code, game.hostToken, game.settings, game.categoryIds, store, graceMs);
    for (const player of game.players) room.players.set(player.id, { ...player, sockets: new Set() });
    room.questions = game.questions;
    if (game.status === 'completed') {
      room.phase = 'finished';
      room.round = game.questions.length;
    } else if (game.status === 'active') {
      // Any round that was in progress is lost; park between rounds and let the host continue.
      room.phase = 'reveal';
      room.round = game.scoredRounds;
      room.resumed = true;
    }
    return room;
  }

  get totalRounds() {
    return this.questions.length || this.settings.totalRounds;
  }

  isHost(token: string) {
    return token === this.hostToken;
  }

  hasPlayer(playerId: string) {
    return this.players.has(playerId);
  }

  join(name: string, deviceId: string, socketId: string): Ack<{ playerId: string }> {
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!trimmed) return fail('Enter a name to join');

    const existing = [...this.players.values()].find((p) => p.deviceId === deviceId);
    const taken = [...this.players.values()].some(
      (p) => p !== existing && p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (taken) return fail(`Someone is already called "${trimmed}" — pick another name`);

    if (existing) {
      if (existing.name !== trimmed) {
        existing.name = trimmed;
        this.persist(() => this.store.renamePlayer(existing.id, trimmed));
      }
      existing.sockets.add(socketId);
      this.changed();
      return { ok: true, playerId: existing.id };
    }

    if (this.phase === 'finished') return fail('This game has already finished');
    if (this.phase !== 'lobby') return fail('This game has already started');

    const player: Player = {
      id: crypto.randomUUID(),
      name: trimmed,
      deviceId,
      score: 0,
      doublesRemaining: this.settings.doublesPerPlayer,
      sockets: new Set([socketId]),
    };
    this.players.set(player.id, player);
    this.persist(() => this.store.addPlayer(this.id, this.stored(player)));
    this.changed();
    return { ok: true, playerId: player.id };
  }

  disconnect(playerId: string, socketId: string) {
    const player = this.players.get(playerId);
    if (!player?.sockets.delete(socketId)) return;
    if (player.sockets.size === 0) {
      this.changed();
      this.endRoundIfEveryoneLocked();
    }
  }

  async start(): Promise<Ack> {
    if (this.phase !== 'lobby' || this.starting) return fail('The game has already started');
    if (this.players.size === 0) return fail('Wait for at least one player to join');

    this.starting = true;
    try {
      const questions = await this.store.pickQuestions(this.categoryIds, this.settings.totalRounds);
      if (questions.length === 0) return fail('There are no questions in the selected categories');
      this.questions = questions;
      this.persist(() => this.store.startGame(this.id, questions));
      this.beginRound(1);
      return { ok: true };
    } finally {
      this.starting = false;
    }
  }

  /** Remembers what a player has typed so far without locking it in. */
  draft(playerId: string, answer: unknown, useDouble: unknown) {
    const player = this.players.get(playerId);
    if (!player || this.phase !== 'playing') return;
    const previous = this.entries.get(playerId);
    if (previous?.locked) return;

    const entry: Entry = {
      answer: cleanAnswer(answer),
      useDouble: useDouble === true && player.doublesRemaining > 0,
      locked: false,
      lockedAt: null,
    };
    this.entries.set(playerId, entry);
    this.lastActivity = Date.now();
    // Only the idle → typing transition is visible to others; skip broadcasting keystrokes.
    if (this.statusOf(playerId) !== (previous?.answer.trim() ? 'typing' : 'idle')) this.onChange();
  }

  lock(playerId: string, answer: unknown, useDouble: unknown) {
    const player = this.players.get(playerId);
    if (!player || this.phase !== 'playing' || this.entries.get(playerId)?.locked) return;

    this.entries.set(playerId, {
      answer: cleanAnswer(answer),
      useDouble: useDouble === true && player.doublesRemaining > 0,
      locked: true,
      lockedAt: new Date(),
    });
    this.changed();
    this.endRoundIfEveryoneLocked();
  }

  /** Host: stop waiting for disconnected players this round. */
  skipOfflinePlayers() {
    if (this.phase !== 'playing' || this.skipOffline) return;
    this.skipOffline = true;
    this.changed();
    this.endRoundIfEveryoneLocked();
  }

  /** Scores the round. Runs when everyone has locked in, the timer expires, or the host ends it. */
  endRound() {
    if (this.phase !== 'playing') return;
    clearTimeout(this.timer);
    this.timer = undefined;

    const question = this.questions[this.round - 1];
    const results: RoundResult[] = [];
    const records: SubmissionRecord[] = [];
    const pickedBy = new Map<string, string[]>();

    for (const player of this.players.values()) {
      const entry = this.entries.get(player.id);
      const answer = entry?.answer.trim() ?? '';
      const match = matchAnswer(answer, question.answers);
      // A blank answer never burns a double.
      const doubled = Boolean(entry?.useDouble) && answer !== '' && player.doublesRemaining > 0;
      const points = pointsForRank(match.rank, question.cutoff) * (doubled ? DOUBLE_MULTIPLIER : 1);

      if (doubled) player.doublesRemaining -= 1;
      player.score += points;
      if (match.answerId) pickedBy.set(match.answerId, [...(pickedBy.get(match.answerId) ?? []), player.id]);

      results.push({
        playerId: player.id,
        answer,
        rank: match.rank,
        outcome: outcomeForRank(match.rank, question.cutoff),
        points,
        doubled,
        fuzzy: match.method === 'fuzzy',
      });
      records.push({
        playerId: player.id,
        answer,
        normalized: normalizeAnswer(answer),
        answerId: match.answerId,
        rank: match.rank,
        points,
        doubled,
        lockedAt: entry?.lockedAt ?? null,
      });
    }

    this.reveal = {
      answers: question.answers.map((a) => ({
        rank: a.rank,
        text: a.text,
        displayValue: a.displayValue,
        points: pointsForRank(a.rank, question.cutoff),
        pickedBy: pickedBy.get(a.id) ?? [],
      })),
      results,
    };
    this.phase = 'reveal';

    const round = this.round;
    const players = [...this.players.values()].map((p) => this.stored(p));
    this.persist(() => this.store.recordRound(this.id, round, records, players));
    this.changed();
  }

  /** Host: go to the next round, or to the final standings after the last one. */
  next() {
    if (this.phase !== 'reveal') return;
    if (this.round >= this.questions.length) {
      this.phase = 'finished';
      this.persist(() => this.store.finishGame(this.id));
      this.changed();
    } else {
      this.beginRound(this.round + 1);
    }
  }

  view(): GameView {
    const question = this.phase === 'playing' || this.phase === 'reveal' ? this.questions[this.round - 1] : undefined;
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      settings: this.settings,
      players: [...this.players.values()].map((p) => {
        const entry = this.entries.get(p.id);
        return {
          id: p.id,
          name: p.name,
          score: p.score,
          connected: p.sockets.size > 0,
          doublesRemaining: p.doublesRemaining,
          status: this.statusOf(p.id),
          doubled: this.phase === 'playing' && Boolean(entry?.locked && entry.useDouble),
        };
      }),
      question: question ? { text: question.text, category: question.category, cutoff: question.cutoff } : null,
      remainingMs: this.phase === 'playing' ? Math.max(0, this.deadline - Date.now()) : null,
      skipOffline: this.skipOffline,
      reveal: this.phase === 'reveal' ? this.reveal : null,
      resumed: this.resumed,
    };
  }

  you(playerId: string): YouView | null {
    if (!this.players.has(playerId)) return null;
    const entry = this.phase === 'playing' ? this.entries.get(playerId) : undefined;
    return {
      playerId,
      answer: entry?.answer ?? '',
      useDouble: entry?.useDouble ?? false,
      locked: entry?.locked ?? false,
    };
  }

  /** Resolves once every queued database write has finished. */
  flush() {
    return this.writes;
  }

  dispose() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private beginRound(round: number) {
    this.round = round;
    this.phase = 'playing';
    this.entries = new Map();
    this.skipOffline = false;
    this.reveal = null;
    this.resumed = false;

    const durationMs = this.settings.timePerRound * 1000;
    this.deadline = Date.now() + durationMs;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.endRound(), durationMs + this.graceMs);

    this.persist(() => this.store.startRound(this.id, round));
    this.changed();
  }

  private endRoundIfEveryoneLocked() {
    if (this.phase !== 'playing') return;
    const required = [...this.players.values()].filter((p) => p.sockets.size > 0 || !this.skipOffline);
    if (required.length > 0 && required.every((p) => this.entries.get(p.id)?.locked)) this.endRound();
  }

  private statusOf(playerId: string): PlayerStatus {
    if (this.phase !== 'playing') return 'idle';
    const entry = this.entries.get(playerId);
    if (entry?.locked) return 'locked';
    return entry?.answer.trim() ? 'typing' : 'idle';
  }

  private stored({ id, name, deviceId, score, doublesRemaining }: Player): StoredPlayer {
    return { id, name, deviceId, score, doublesRemaining };
  }

  private changed() {
    this.lastActivity = Date.now();
    this.onChange();
  }

  private persist(write: () => Promise<void>) {
    this.writes = this.writes.then(write).catch((error) => {
      console.error(`[game ${this.code}] failed to save:`, error);
    });
  }
}
