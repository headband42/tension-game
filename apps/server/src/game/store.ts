import type { PrismaClient } from '@prisma/client';
import { MIN_TENSION_ANSWERS, type GameSettings } from '@tension/shared';
import type { AnswerKey } from './matching';

export interface StoredAnswer extends AnswerKey {
  displayValue: string | null;
}

export interface RoundQuestion {
  id: string;
  text: string;
  category: string;
  cutoff: number;
  /** Ordered by rank. */
  answers: StoredAnswer[];
}

export interface StoredPlayer {
  id: string;
  name: string;
  deviceId: string;
  score: number;
  doublesRemaining: number;
}

export type GameStatus = 'waiting' | 'active' | 'completed';

export interface StoredGame {
  id: string;
  code: string;
  hostToken: string;
  status: GameStatus;
  settings: GameSettings;
  categoryIds: string[];
  players: StoredPlayer[];
  /** The questions drawn for this game, in round order. Empty until it starts. */
  questions: RoundQuestion[];
  /** Highest round with recorded submissions. */
  scoredRounds: number;
}

export interface SubmissionRecord {
  playerId: string;
  answer: string;
  normalized: string;
  answerId: string | null;
  rank: number | null;
  points: number;
  doubled: boolean;
  lockedAt: Date | null;
}

export interface NewGame {
  code: string;
  hostToken: string;
  settings: GameSettings;
  categoryIds: string[];
}

/** Persistence used by game rooms. Rooms keep live state in memory and write through to this. */
export interface GameStore {
  codeInUse(code: string): Promise<boolean>;
  countQuestions(categoryIds: string[]): Promise<number>;
  createGame(game: NewGame): Promise<string>;
  loadGame(code: string): Promise<StoredGame | null>;
  addPlayer(gameId: string, player: StoredPlayer): Promise<void>;
  renamePlayer(playerId: string, name: string): Promise<void>;
  /** Draws up to `count` questions, preferring ones that have been played least. */
  pickQuestions(categoryIds: string[], count: number): Promise<RoundQuestion[]>;
  startGame(gameId: string, questions: RoundQuestion[]): Promise<void>;
  startRound(gameId: string, round: number): Promise<void>;
  recordRound(gameId: string, round: number, submissions: SubmissionRecord[], players: StoredPlayer[]): Promise<void>;
  finishGame(gameId: string): Promise<void>;
}

export function parseStringArray(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Active questions that can actually be played: they list at least
 * MIN_TENSION_ANSWERS tension answers below their cutoff. The importer guarantees that, but questions edited
 * by hand or left over from older versions might not, and they're skipped.
 */
export async function playableQuestions(prisma: PrismaClient, categoryIds?: string[]) {
  const questions = await prisma.question.findMany({
    where: { active: true, ...(categoryIds && { categoryId: { in: categoryIds } }) },
    select: { id: true, categoryId: true, usageCount: true, tensionCutoff: true, _count: { select: { answers: true } } },
  });
  return questions.filter((q) => q._count.answers >= q.tensionCutoff + MIN_TENSION_ANSWERS);
}

const questionWithAnswers = {
  category: true,
  answers: { orderBy: { rank: 'asc' } },
} as const;

type QuestionRow = {
  id: string;
  questionText: string;
  tensionCutoff: number;
  category: { name: string };
  answers: { id: string; rank: number; answerText: string; displayValue: string | null; aliases: string }[];
};

function toRoundQuestion(row: QuestionRow): RoundQuestion {
  return {
    id: row.id,
    text: row.questionText,
    category: row.category.name,
    cutoff: row.tensionCutoff,
    answers: row.answers.map((a) => ({
      id: a.id,
      rank: a.rank,
      text: a.answerText,
      displayValue: a.displayValue,
      aliases: parseStringArray(a.aliases),
    })),
  };
}

export class PrismaGameStore implements GameStore {
  constructor(private readonly prisma: PrismaClient) {}

  async codeInUse(code: string) {
    return (await this.prisma.game.count({ where: { code } })) > 0;
  }

  async countQuestions(categoryIds: string[]) {
    return (await playableQuestions(this.prisma, categoryIds)).length;
  }

  async createGame({ code, hostToken, settings, categoryIds }: NewGame) {
    const game = await this.prisma.game.create({
      data: { code, hostToken, ...settings, selectedCategories: JSON.stringify(categoryIds) },
    });
    return game.id;
  }

  async loadGame(code: string): Promise<StoredGame | null> {
    const game = await this.prisma.game.findUnique({
      where: { code },
      include: {
        players: { orderBy: { joinedAt: 'asc' } },
        questions: { orderBy: { roundNumber: 'asc' }, include: { question: { include: questionWithAnswers } } },
      },
    });
    if (!game) return null;

    const lastScored = await this.prisma.submission.aggregate({ where: { gameId: game.id }, _max: { round: true } });

    return {
      id: game.id,
      code: game.code,
      hostToken: game.hostToken,
      status: game.status as GameStatus,
      settings: {
        totalRounds: game.totalRounds,
        timePerRound: game.timePerRound,
        doublesPerPlayer: game.doublesPerPlayer,
      },
      categoryIds: parseStringArray(game.selectedCategories),
      players: game.players.map(({ id, name, deviceId, score, doublesRemaining }) => ({
        id,
        name,
        deviceId,
        score,
        doublesRemaining,
      })),
      questions: game.questions.map((gq) => toRoundQuestion(gq.question)),
      scoredRounds: lastScored._max.round ?? 0,
    };
  }

  async addPlayer(gameId: string, player: StoredPlayer) {
    await this.prisma.player.create({ data: { gameId, ...player } });
  }

  async renamePlayer(playerId: string, name: string) {
    await this.prisma.player.update({ where: { id: playerId }, data: { name } });
  }

  async pickQuestions(categoryIds: string[], count: number) {
    const pool = await playableQuestions(this.prisma, categoryIds);
    // Shuffle first so the stable sort breaks usage ties randomly.
    const ids = shuffle(pool)
      .sort((a, b) => a.usageCount - b.usageCount)
      .slice(0, count)
      .map((q) => q.id);

    const rows = await this.prisma.question.findMany({ where: { id: { in: ids } }, include: questionWithAnswers });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toRoundQuestion(row)] : [];
    });
  }

  async startGame(gameId: string, questions: RoundQuestion[]) {
    await this.prisma.$transaction([
      this.prisma.gameQuestion.deleteMany({ where: { gameId } }),
      this.prisma.gameQuestion.createMany({
        data: questions.map((q, i) => ({ gameId, questionId: q.id, roundNumber: i + 1 })),
      }),
      this.prisma.question.updateMany({
        where: { id: { in: questions.map((q) => q.id) } },
        data: { usageCount: { increment: 1 } },
      }),
      this.prisma.game.update({
        where: { id: gameId },
        data: { status: 'active', totalRounds: questions.length, startedAt: new Date() },
      }),
    ]);
  }

  async startRound(gameId: string, round: number) {
    await this.prisma.$transaction([
      this.prisma.game.update({ where: { id: gameId }, data: { currentRound: round } }),
      this.prisma.gameQuestion.updateMany({ where: { gameId, roundNumber: round }, data: { askedAt: new Date() } }),
    ]);
  }

  async recordRound(gameId: string, round: number, submissions: SubmissionRecord[], players: StoredPlayer[]) {
    await this.prisma.$transaction([
      this.prisma.submission.createMany({
        data: submissions.map((s) => ({
          gameId,
          round,
          playerId: s.playerId,
          submittedAnswer: s.answer,
          normalizedAnswer: s.normalized,
          answerMatchId: s.answerId,
          matchedRank: s.rank,
          pointsAwarded: s.points,
          usedDouble: s.doubled,
          lockedAt: s.lockedAt,
        })),
      }),
      ...players.map((p) =>
        this.prisma.player.update({
          where: { id: p.id },
          data: { score: p.score, doublesRemaining: p.doublesRemaining },
        }),
      ),
    ]);
  }

  async finishGame(gameId: string) {
    await this.prisma.game.update({ where: { id: gameId }, data: { status: 'completed', completedAt: new Date() } });
  }
}
