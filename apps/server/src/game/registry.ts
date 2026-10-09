import { randomInt } from 'node:crypto';
import { CODE_ALPHABET, CODE_LENGTH, normalizeCode, type GameSettings } from '@tension/shared';
import { DEFAULT_GRACE_MS, GameRoom } from './room';
import type { GameStore } from './store';

export function randomCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/** Rooms idle this long are dropped from memory. They reload from the database if anyone comes back. */
const IDLE_EVICTION_MS = 3 * 60 * 60 * 1000;
const FINISHED_EVICTION_MS = 30 * 60 * 1000;

/** Live game rooms, keyed by join code. */
export class RoomRegistry {
  /** Called whenever any room changes. */
  onRoomChange: (room: GameRoom) => void = () => {};

  private readonly rooms = new Map<string, GameRoom>();
  private readonly loading = new Map<string, Promise<GameRoom | null>>();

  constructor(
    private readonly store: GameStore,
    private readonly graceMs = DEFAULT_GRACE_MS,
  ) {}

  async create(settings: GameSettings, categoryIds: string[]): Promise<GameRoom> {
    const code = await this.unusedCode();
    const hostToken = crypto.randomUUID();
    const id = await this.store.createGame({ code, hostToken, settings, categoryIds });
    return this.track(new GameRoom(id, code, hostToken, settings, categoryIds, this.store, this.graceMs));
  }

  /** Finds a room by code, reloading it from the database if it is not in memory. */
  get(rawCode: string): Promise<GameRoom | null> {
    const code = normalizeCode(rawCode);
    const live = this.rooms.get(code);
    if (live) return Promise.resolve(live);

    let pending = this.loading.get(code);
    if (!pending) {
      pending = this.store
        .loadGame(code)
        .then((game) => (game ? this.track(GameRoom.restore(game, this.store, this.graceMs)) : null))
        .finally(() => this.loading.delete(code));
      this.loading.set(code, pending);
    }
    return pending;
  }

  /** Drops idle rooms that nobody is connected to. */
  sweep(isWatched: (code: string) => boolean, now = Date.now()) {
    for (const [code, room] of this.rooms) {
      const idleFor = now - room.lastActivity;
      const limit = room.phase === 'finished' ? FINISHED_EVICTION_MS : IDLE_EVICTION_MS;
      if (idleFor > limit && !isWatched(code)) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  async close() {
    for (const room of this.rooms.values()) {
      room.dispose();
      await room.flush();
    }
    this.rooms.clear();
  }

  private track(room: GameRoom) {
    room.onChange = () => this.onRoomChange(room);
    this.rooms.set(room.code, room);
    return room;
  }

  private async unusedCode() {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = randomCode();
      if (!this.rooms.has(code) && !(await this.store.codeInUse(code))) return code;
    }
    throw new Error('Could not find an unused game code');
  }
}
