import type { Outcome } from './scoring';

// ---------------------------------------------------------------------------
// Limits shared by the setup form and server-side validation
// ---------------------------------------------------------------------------

export const SETTINGS_LIMITS = {
  totalRounds: { min: 1, max: 20, default: 5 },
  timePerRound: { min: 10, max: 120, step: 5, default: 45 },
  doublesPerPlayer: { min: 0, max: 5, default: 1 },
} as const;

export const MAX_NAME_LENGTH = 20;
export const MAX_ANSWER_LENGTH = 80;

/** Join codes avoid look-alike characters (0/O, 1/I) so they are easy to read off a TV. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

/** Upper-cases a typed join code and drops anything that cannot be part of one. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

export interface CategoryNode {
  id: string;
  name: string;
  /** Active questions filed directly under this category. */
  ownQuestions: number;
  /** Active questions in this category and all of its descendants. */
  totalQuestions: number;
  children: CategoryNode[];
}

export interface GameSettings {
  totalRounds: number;
  timePerRound: number;
  doublesPerPlayer: number;
}

export interface CreateGameRequest extends GameSettings {
  /** Questions are drawn from exactly these categories (not their descendants). */
  categoryIds: string[];
}

export interface CreateGameResponse {
  code: string;
  /** Secret that proves a socket is the host. Only ever returned to the creator. */
  hostToken: string;
}

export interface ServerInfo {
  /** IPv4 addresses phones on the same network can use to reach this server. */
  lanAddresses: string[];
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

export type Phase = 'lobby' | 'playing' | 'reveal' | 'finished';

export type PlayerStatus = 'idle' | 'typing' | 'locked';

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  doublesRemaining: number;
  status: PlayerStatus;
  /** True once the player has locked in an answer with a double on it. */
  doubled: boolean;
}

export interface QuestionView {
  text: string;
  category: string;
  /** Ranks at or above this score their rank. */
  cutoff: number;
  /** How many tension answers lurk just below the cutoff; announced before anyone answers. */
  tensionCount: number;
}

export interface RevealAnswer {
  rank: number;
  text: string;
  displayValue: string | null;
  points: number;
  /** Ids of players whose answer matched this entry. */
  pickedBy: string[];
}

export interface RoundResult {
  playerId: string;
  /** What the player typed, trimmed. Empty if they never answered. */
  answer: string;
  rank: number | null;
  outcome: Outcome;
  points: number;
  doubled: boolean;
  /** Matched by spelling tolerance rather than exactly. */
  fuzzy: boolean;
}

export interface RevealView {
  answers: RevealAnswer[];
  results: RoundResult[];
}

/** Everything a screen needs to render the game. Identical for every recipient. */
export interface GameView {
  code: string;
  phase: Phase;
  /** 1-based round number; 0 before the first round. */
  round: number;
  totalRounds: number;
  settings: GameSettings;
  /** In join order. */
  players: PlayerView[];
  question: QuestionView | null;
  /** Time left to answer when this snapshot was sent; null outside a round. */
  remainingMs: number | null;
  /** The host chose to stop waiting for disconnected players this round. */
  skipOffline: boolean;
  reveal: RevealView | null;
  /** The server restarted mid-game; the host needs to continue manually. */
  resumed: boolean;
}

/** The receiving player's own, private slice of state. */
export interface YouView {
  playerId: string;
  answer: string;
  useDouble: boolean;
  locked: boolean;
}

export interface StatePayload {
  game: GameView;
  /** Null for the host screen. */
  you: YouView | null;
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface AnswerPayload {
  answer: string;
  useDouble: boolean;
}

export interface ClientToServerEvents {
  'host:join': (payload: { code: string; token: string }, ack: (result: Ack) => void) => void;
  'host:start': (ack: (result: Ack) => void) => void;
  'host:endRound': () => void;
  'host:skipOffline': () => void;
  'host:next': () => void;
  'player:join': (
    payload: { code: string; name: string; deviceId: string },
    ack: (result: Ack<{ playerId: string }>) => void,
  ) => void;
  /** Latest unsubmitted answer; used if the timer runs out before the player locks in. */
  'player:draft': (payload: AnswerPayload) => void;
  'player:lock': (payload: AnswerPayload) => void;
}

export interface ServerToClientEvents {
  state: (payload: StatePayload) => void;
}
