import type { GameStore, NewGame, RoundQuestion, StoredGame, StoredPlayer, SubmissionRecord } from '../src/game/store';

/** In-memory GameStore for exercising rooms without a database. */
export class MemoryStore implements GameStore {
  games = new Map<string, StoredGame>();
  submissions: (SubmissionRecord & { gameId: string; round: number })[] = [];

  constructor(private readonly questionBank: RoundQuestion[] = []) {}

  async codeInUse(code: string) {
    return [...this.games.values()].some((g) => g.code === code);
  }
  async countQuestions() {
    return this.questionBank.length;
  }
  async createGame(game: NewGame) {
    const id = `game-${this.games.size + 1}`;
    this.games.set(id, { id, ...game, status: 'waiting', players: [], questions: [], scoredRounds: 0 });
    return id;
  }
  async loadGame(code: string) {
    const game = [...this.games.values()].find((g) => g.code === code);
    return game ? structuredClone(game) : null;
  }
  async addPlayer(gameId: string, player: StoredPlayer) {
    this.games.get(gameId)!.players.push({ ...player });
  }
  async renamePlayer(playerId: string, name: string) {
    for (const game of this.games.values()) for (const p of game.players) if (p.id === playerId) p.name = name;
  }
  async pickQuestions(_categoryIds: string[], count: number) {
    return this.questionBank.slice(0, count);
  }
  async startGame(gameId: string, questions: RoundQuestion[]) {
    Object.assign(this.games.get(gameId)!, { status: 'active', questions });
  }
  async startRound() {}
  async recordRound(gameId: string, round: number, submissions: SubmissionRecord[], players: StoredPlayer[]) {
    const game = this.games.get(gameId)!;
    this.submissions.push(...submissions.map((s) => ({ ...s, gameId, round })));
    game.scoredRounds = round;
    game.players = players.map((p) => ({ ...p }));
  }
  async finishGame(gameId: string) {
    this.games.get(gameId)!.status = 'completed';
  }
}

export function question(id: string, cutoff = 3, size = 5): RoundQuestion {
  return {
    id,
    text: `Question ${id}`,
    category: 'Test',
    cutoff,
    answers: Array.from({ length: size }, (_, i) => ({
      id: `${id}-${i + 1}`,
      rank: i + 1,
      text: `${id} answer ${i + 1}`,
      displayValue: null,
      aliases: [],
    })),
  };
}
