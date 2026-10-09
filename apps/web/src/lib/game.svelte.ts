import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, GameView, ServerToClientEvents, YouView } from '@tension/shared';
import { deviceId } from './storage';

type Session =
  | { role: 'host'; code: string; token: string }
  | { role: 'player'; code: string; name: string; playerId: string };

const ACK_TIMEOUT_MS = 8000;
const unreachable = { ok: false, error: 'Could not reach the game server' } as const;

/**
 * The browser's connection to a game. The server sends a full snapshot after
 * every change, so this just keeps the latest one; after a reconnect it rejoins
 * the same seat automatically and the next snapshot brings the screen back.
 */
class GameClient {
  connected = $state(false);
  game = $state<GameView | null>(null);
  you = $state<YouView | null>(null);
  session = $state<Session | null>(null);
  /** Local time when answers close, derived from the server's remainingMs. */
  deadline = $state<number | null>(null);
  /** Set when an automatic rejoin fails, e.g. the game no longer exists. */
  error = $state<string | null>(null);

  #socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

  get socket() {
    if (!this.#socket) {
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
      socket.on('connect', () => {
        this.connected = true;
        void this.#rejoin();
      });
      socket.on('disconnect', () => (this.connected = false));
      socket.on('state', ({ game, you }) => {
        this.game = game;
        this.you = you;
        this.deadline = game.remainingMs === null ? null : Date.now() + game.remainingMs;
      });
      this.#socket = socket;
    }
    return this.#socket;
  }

  async hostGame(code: string, token: string): Promise<Ack> {
    this.#reset();
    const result = await this.#hostJoin(code, token);
    if (result.ok) this.session = { role: 'host', code, token };
    return result;
  }

  async joinGame(code: string, name: string): Promise<Ack> {
    this.#reset();
    const result = await this.#playerJoin(code, name);
    if (result.ok) this.session = { role: 'player', code, name, playerId: result.playerId };
    return result;
  }

  isSeated(role: Session['role'], code: string) {
    return this.session?.role === role && this.session.code === code;
  }

  async start(): Promise<Ack> {
    try {
      return await this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('host:start');
    } catch {
      return unreachable;
    }
  }

  endRound = () => this.socket.emit('host:endRound');
  skipOffline = () => this.socket.emit('host:skipOffline');
  next = () => this.socket.emit('host:next');
  draft = (answer: string, useDouble: boolean) => this.socket.emit('player:draft', { answer, useDouble });
  lock = (answer: string, useDouble: boolean) => this.socket.emit('player:lock', { answer, useDouble });

  #reset() {
    this.session = null;
    this.game = null;
    this.you = null;
    this.deadline = null;
    this.error = null;
  }

  async #hostJoin(code: string, token: string): Promise<Ack> {
    try {
      return await this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('host:join', { code, token });
    } catch {
      return unreachable;
    }
  }

  async #playerJoin(code: string, name: string): Promise<Ack<{ playerId: string }>> {
    try {
      return await this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('player:join', { code, name, deviceId: deviceId() });
    } catch {
      return unreachable;
    }
  }

  async #rejoin() {
    const session = this.session;
    if (!session) return;
    const result =
      session.role === 'host'
        ? await this.#hostJoin(session.code, session.token)
        : await this.#playerJoin(session.code, session.name);
    this.error = result.ok ? null : result.error;
  }
}

export const game = new GameClient();
