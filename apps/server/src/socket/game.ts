import type { Server, Socket } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import {
  normalizeAnswer,
  matchAnswer,
  shuffleArray,
} from '../services/answer-matcher.js';

interface GameState {
  gameId: string;
  status: 'setup' | 'waiting' | 'active' | 'completed';
  currentRound: number;
  players: Map<string, PlayerState>;
  submissions: Map<string, SubmissionState>;
  timer?: ReturnType<typeof setTimeout>;
  /** Prevents double-scoring when timer / all-lock / host end race */
  roundPhase: 'idle' | 'playing' | 'revealing';
  waitForReconnects: boolean;
  totalRounds: number;
}

interface PlayerState {
  id: string;
  name: string;
  socketId: string;
  score: number;
  doublesRemaining: number;
  connected: boolean;
}

interface SubmissionState {
  playerId: string;
  answer: string;
  normalizedAnswer: string;
  locked: boolean;
  usedDouble: boolean;
  lockedAt?: Date;
}

// In-memory game state (use Redis in production)
const gameStates = new Map<string, GameState>();

function createEmptyGameState(
  gameId: string,
  status: GameState['status'],
  currentRound: number,
  waitForReconnects: boolean,
  totalRounds: number,
  players: Map<string, PlayerState> = new Map()
): GameState {
  return {
    gameId,
    status,
    currentRound,
    players,
    submissions: new Map(),
    roundPhase: 'idle',
    waitForReconnects,
    totalRounds,
  };
}

function playersSnapshot(gameState: GameState) {
  return Array.from(gameState.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    doublesRemaining: p.doublesRemaining,
  }));
}

export function gameSocketHandler(io: Server, prisma: PrismaClient) {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('error', (err: Error) => {
      console.error(`Socket error for ${socket.id}:`, err.message);
    });

    // Host creates/joins game room
    socket.on('host:join', async (data: { gameId: string; hostId?: string }) => {
      const { gameId, hostId } = data;

      const game = await prisma.game.findUnique({
        where: { id: gameId },
        include: { players: true },
      });

      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      // Optional host identity check when client sends hostId
      if (hostId && game.hostId !== hostId) {
        socket.emit('error', { message: 'Not authorized as host' });
        return;
      }

      socket.join(`game:${gameId}`);
      socket.data.isHost = true;
      socket.data.gameId = gameId;
      socket.data.hostId = game.hostId;

      if (!gameStates.has(gameId)) {
        gameStates.set(
          gameId,
          createEmptyGameState(
            gameId,
            game.status as GameState['status'],
            game.currentRound,
            game.waitForReconnects,
            game.totalRounds,
            new Map(
              game.players.map((p) => [
                p.id,
                {
                  id: p.id,
                  name: p.name,
                  socketId: '',
                  score: p.score,
                  doublesRemaining: p.doublesRemaining,
                  connected: p.connected,
                },
              ])
            )
          )
        );
      }

      const gameState = gameStates.get(gameId)!;

      socket.emit('host:joined', {
        gameId,
        code: game.code,
        hostId: game.hostId,
      });

      // Sync full state so host sees current players
      socket.emit('game:state', {
        status: gameState.status,
        currentRound: gameState.currentRound,
        totalRounds: game.totalRounds,
        players: playersSnapshot(gameState),
        code: game.code,
        waitForReconnects: gameState.waitForReconnects,
      });
    });

    // Player joins game
    socket.on(
      'player:join',
      async (data: { code: string; name: string; deviceId: string }) => {
        console.log(`Player join event received:`, data);
        const { code, name, deviceId } = data;

        if (!code || !name?.trim() || !deviceId) {
          socket.emit('error', { message: 'Missing join fields' });
          return;
        }

        const game = await prisma.game.findUnique({
          where: { code: code.toUpperCase() },
        });

        if (!game) {
          socket.emit('error', { message: 'Game not found' });
          return;
        }

        if (game.status === 'completed') {
          socket.emit('error', { message: 'Game already completed' });
          return;
        }

        // Block new players mid-game; allow reconnect by deviceId
        let player = await prisma.player.findFirst({
          where: { gameId: game.id, deviceId },
        });

        if (player) {
          player = await prisma.player.update({
            where: { id: player.id },
            data: {
              connected: true,
              lastSeen: new Date(),
              // Allow name fix on reconnect
              name: name.trim() || player.name,
            },
          });
        } else {
          if (game.status === 'active') {
            socket.emit('error', {
              message: 'Game already started — cannot join as a new player',
            });
            return;
          }
          player = await prisma.player.create({
            data: {
              gameId: game.id,
              name: name.trim(),
              deviceId,
              doublesRemaining: game.doublesPerPlayer,
            },
          });
        }

        socket.join(`game:${game.id}`);
        socket.join(`player:${player.id}`);
        socket.data.playerId = player.id;
        socket.data.gameId = game.id;
        socket.data.isHost = false;

        let currentGameState = gameStates.get(game.id);

        if (!currentGameState) {
          console.log(`Game state not found for ${game.id}, initializing...`);
          const existingPlayers = await prisma.player.findMany({
            where: { gameId: game.id },
          });

          currentGameState = createEmptyGameState(
            game.id,
            game.status as GameState['status'],
            game.currentRound || 0,
            game.waitForReconnects,
            game.totalRounds,
            new Map(
              existingPlayers.map((p) => [
                p.id,
                {
                  id: p.id,
                  name: p.name,
                  socketId: p.id === player!.id ? socket.id : '',
                  score: p.score,
                  doublesRemaining: p.doublesRemaining,
                  connected: p.id === player!.id ? true : p.connected,
                },
              ])
            )
          );
          gameStates.set(game.id, currentGameState);
        } else {
          currentGameState.players.set(player.id, {
            id: player.id,
            name: player.name,
            socketId: socket.id,
            score: player.score,
            doublesRemaining: player.doublesRemaining,
            connected: true,
          });
        }

        console.log(`Emitting player:joined for ${player.name}`);
        socket.emit('player:joined', {
          playerId: player.id,
          gameId: game.id,
          code: game.code,
          doublesRemaining: player.doublesRemaining,
        });

        socket.emit('game:state', {
          status: currentGameState.status,
          currentRound: currentGameState.currentRound,
          totalRounds: game.totalRounds,
          players: playersSnapshot(currentGameState),
          code: game.code,
          waitForReconnects: currentGameState.waitForReconnects,
        });

        // Notify room (host + players) — upsert on client
        io.to(`game:${game.id}`).emit('player:connected', {
          player: {
            id: player.id,
            name: player.name,
            score: player.score,
            connected: true,
            doublesRemaining: player.doublesRemaining,
          },
        });
      }
    );

    // Host starts the game
    socket.on('game:start', async () => {
      if (!socket.data.isHost || !socket.data.gameId) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }

      const gameId = socket.data.gameId;
      const gameState = gameStates.get(gameId);

      // Idempotent: ignore if already active
      if (gameState?.status === 'active' || gameState?.status === 'completed') {
        socket.emit('error', { message: 'Game already started or finished' });
        return;
      }

      const game = await prisma.game.findUnique({
        where: { id: gameId },
      });

      if (!game) return;

      if (game.status === 'active' || game.status === 'completed') {
        socket.emit('error', { message: 'Game already started or finished' });
        return;
      }

      const selectedCategories = JSON.parse(game.selectedCategories || '[]');

      const categories = await prisma.category.findMany({
        where: {
          id: { in: selectedCategories },
        },
      });

      const allCategoryIds = new Set<string>();
      for (const cat of categories) {
        const subcats = await prisma.category.findMany({
          where: { path: { startsWith: cat.path } },
          select: { id: true },
        });
        subcats.forEach((sc) => allCategoryIds.add(sc.id));
      }

      const pool = await prisma.question.findMany({
        where: {
          categoryId: { in: Array.from(allCategoryIds) },
          active: true,
        },
      });

      if (pool.length === 0) {
        socket.emit('error', {
          message: 'No questions available for selected categories',
        });
        return;
      }

      // Shuffle and take up to totalRounds (cap if fewer questions)
      const shuffled = shuffleArray(pool);
      const questions = shuffled.slice(0, game.totalRounds);
      const actualRounds = questions.length;

      if (actualRounds < game.totalRounds) {
        console.warn(
          `Only ${actualRounds} questions available, requested ${game.totalRounds}`
        );
      }

      // Clear any leftover game questions (idempotency safety)
      await prisma.gameQuestion.deleteMany({ where: { gameId } });

      for (let i = 0; i < questions.length; i++) {
        await prisma.gameQuestion.create({
          data: {
            gameId,
            questionId: questions[i].id,
            roundNumber: i + 1,
          },
        });
      }

      await prisma.game.update({
        where: { id: gameId },
        data: {
          status: 'active',
          currentRound: 1,
          totalRounds: actualRounds,
          startedAt: new Date(),
        },
      });

      if (gameState) {
        gameState.status = 'active';
        gameState.currentRound = 1;
        gameState.totalRounds = actualRounds;
        gameState.waitForReconnects = game.waitForReconnects;
        gameState.roundPhase = 'idle';
        gameState.submissions.clear();
      }

      io.to(`game:${gameId}`).emit('game:started', {
        totalRounds: actualRounds,
        code: game.code,
      });

      startRound(io, prisma, gameId, 1);
    });

    // Player submits answer
    socket.on(
      'player:submit',
      async (data: { answer: string; usedDouble: boolean }) => {
        const { answer, usedDouble } = data;
        const playerId = socket.data.playerId;
        const gameId = socket.data.gameId;

        if (!playerId || !gameId) {
          socket.emit('error', { message: 'Not in a game' });
          return;
        }

        const gameState = gameStates.get(gameId);
        if (
          !gameState ||
          gameState.status !== 'active' ||
          gameState.roundPhase !== 'playing'
        ) {
          socket.emit('error', { message: 'Game not accepting answers' });
          return;
        }

        const player = gameState.players.get(playerId);
        if (!player) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        // Only allow double if player still has doubles remaining
        const canDouble = usedDouble && player.doublesRemaining > 0;
        if (usedDouble && !canDouble) {
          socket.emit('error', {
            message: 'No doubles remaining — submitting without double',
          });
        }

        const normalized = normalizeAnswer(answer || '');

        gameState.submissions.set(playerId, {
          playerId,
          answer: answer || '',
          normalizedAnswer: normalized,
          locked: false,
          usedDouble: canDouble,
        });

        socket.emit('answer:received', { usedDouble: canDouble });

        io.to(`game:${gameId}`).emit('submission:update', {
          playerId,
          hasAnswer: true,
          locked: false,
          usedDouble: canDouble,
        });
      }
    );

    // Player locks in answer
    socket.on('player:lock', async () => {
      const playerId = socket.data.playerId;
      const gameId = socket.data.gameId;

      if (!playerId || !gameId) return;

      const gameState = gameStates.get(gameId);
      if (!gameState || gameState.roundPhase !== 'playing') return;

      let submission = gameState.submissions.get(playerId);
      const player = gameState.players.get(playerId);
      if (!player) return;

      // Auto-create empty submission if locking without submit
      if (!submission) {
        submission = {
          playerId,
          answer: '',
          normalizedAnswer: '',
          locked: false,
          usedDouble: false,
        };
        gameState.submissions.set(playerId, submission);
      }

      if (submission.locked) return;

      // Validate double at lock time
      if (submission.usedDouble) {
        if (player.doublesRemaining > 0) {
          player.doublesRemaining--;
          await prisma.player.update({
            where: { id: playerId },
            data: { doublesRemaining: player.doublesRemaining },
          });
        } else {
          submission.usedDouble = false;
        }
      }

      submission.locked = true;
      submission.lockedAt = new Date();

      io.to(`game:${gameId}`).emit('submission:update', {
        playerId,
        hasAnswer: true,
        locked: true,
        usedDouble: submission.usedDouble,
      });

      // Also broadcast updated doubles count
      io.to(`game:${gameId}`).emit('player:updated', {
        playerId,
        doublesRemaining: player.doublesRemaining,
      });

      if (allRequiredPlayersLocked(gameState)) {
        endRound(io, prisma, gameId);
      }
    });

    // Host forces round end
    socket.on('host:endRound', async () => {
      if (!socket.data.isHost || !socket.data.gameId) return;
      endRound(io, prisma, socket.data.gameId);
    });

    // Host advances to next round
    socket.on('host:nextRound', async () => {
      if (!socket.data.isHost || !socket.data.gameId) return;

      const gameId = socket.data.gameId;
      const gameState = gameStates.get(gameId);
      if (!gameState) return;

      // Only advance from reveal phase
      if (gameState.roundPhase === 'playing') {
        socket.emit('error', { message: 'Round still in progress' });
        return;
      }

      const nextRound = gameState.currentRound + 1;
      const totalRounds =
        gameState.totalRounds ||
        (
          await prisma.game.findUnique({
            where: { id: gameId },
            select: { totalRounds: true },
          })
        )?.totalRounds ||
        0;

      if (nextRound > totalRounds) {
        await endGame(io, prisma, gameId);
        return;
      }

      gameState.currentRound = nextRound;
      gameState.submissions.clear();
      gameState.roundPhase = 'idle';

      await prisma.game.update({
        where: { id: gameId },
        data: { currentRound: nextRound },
      });

      startRound(io, prisma, gameId, nextRound);
    });

    // Host proceeds without disconnected players this round
    socket.on('host:proceedWithout', async () => {
      if (!socket.data.isHost || !socket.data.gameId) return;
      const gameState = gameStates.get(socket.data.gameId);
      if (!gameState || gameState.roundPhase !== 'playing') return;

      // Temporarily ignore disconnected for lock check by treating as if we only wait on connected
      if (allRequiredPlayersLocked(gameState, true /* force ignore disconnected */)) {
        endRound(io, prisma, socket.data.gameId);
      } else {
        // End round anyway — host override
        endRound(io, prisma, socket.data.gameId);
      }
    });

    // Disconnect handling (single handler)
    socket.on('disconnect', async (reason: string) => {
      console.log(`Socket disconnected: ${socket.id}, reason: ${reason}`);

      const playerId = socket.data.playerId;
      const gameId = socket.data.gameId;

      if (playerId && gameId) {
        try {
          await prisma.player.update({
            where: { id: playerId },
            data: { connected: false, lastSeen: new Date() },
          });
        } catch {
          // Player may already be gone
        }

        const gameState = gameStates.get(gameId);
        if (gameState) {
          const player = gameState.players.get(playerId);
          if (player) {
            player.connected = false;
          }

          // If not waiting for reconnects and remaining connected all locked → end round
          if (
            gameState.roundPhase === 'playing' &&
            !gameState.waitForReconnects &&
            allRequiredPlayersLocked(gameState)
          ) {
            endRound(io, prisma, gameId);
          }
        }

        io.to(`game:${gameId}`).emit('player:disconnected', { playerId });
      }
    });
  });
}

/**
 * Whether every player who must answer has locked.
 * - waitForReconnects=true: all players (connected or not) must lock
 * - waitForReconnects=false: only currently connected players
 * - forceIgnoreDisconnected: only connected (host proceed)
 */
function allRequiredPlayersLocked(
  gameState: GameState,
  forceIgnoreDisconnected = false
): boolean {
  const wait = forceIgnoreDisconnected ? false : gameState.waitForReconnects;
  const required = Array.from(gameState.players.values()).filter((p) =>
    wait ? true : p.connected
  );

  if (required.length === 0) return false;

  return required.every((p) => {
    const sub = gameState.submissions.get(p.id);
    return sub?.locked;
  });
}

async function startRound(
  io: Server,
  prisma: PrismaClient,
  gameId: string,
  roundNumber: number
) {
  const gameQuestion = await prisma.gameQuestion.findFirst({
    where: {
      gameId,
      roundNumber,
    },
    include: {
      question: {
        include: {
          category: true,
        },
      },
    },
  });

  if (!gameQuestion) {
    console.error(`No question for game ${gameId} round ${roundNumber}`);
    io.to(`game:${gameId}`).emit('error', {
      message: `No question available for round ${roundNumber}`,
    });
    return;
  }

  const game = await prisma.game.findUnique({
    where: { id: gameId },
  });

  if (!game) return;

  const gameState = gameStates.get(gameId);
  if (gameState) {
    if (gameState.timer) {
      clearTimeout(gameState.timer);
      gameState.timer = undefined;
    }
    gameState.submissions.clear();
    gameState.roundPhase = 'playing';
    gameState.currentRound = roundNumber;
  }

  await prisma.gameQuestion.update({
    where: { id: gameQuestion.id },
    data: { askedAt: new Date() },
  });

  io.to(`game:${gameId}`).emit('round:start', {
    round: roundNumber,
    totalRounds: game.totalRounds,
    question: {
      id: gameQuestion.question.id,
      text: gameQuestion.question.questionText,
      category: gameQuestion.question.category?.name || 'General',
      timeLimit: game.timePerRound,
    },
  });

  if (gameState) {
    gameState.timer = setTimeout(() => {
      endRound(io, prisma, gameId);
    }, game.timePerRound * 1000);
  }
}

async function endRound(io: Server, prisma: PrismaClient, gameId: string) {
  const gameState = gameStates.get(gameId);
  if (!gameState) return;

  // Guard against double scoring
  if (gameState.roundPhase !== 'playing') {
    return;
  }
  gameState.roundPhase = 'revealing';

  if (gameState.timer) {
    clearTimeout(gameState.timer);
    gameState.timer = undefined;
  }

  const gameQuestion = await prisma.gameQuestion.findFirst({
    where: {
      gameId,
      roundNumber: gameState.currentRound,
    },
    include: {
      question: {
        include: {
          answers: {
            orderBy: { rank: 'asc' },
          },
        },
      },
    },
  });

  if (!gameQuestion) {
    gameState.roundPhase = 'idle';
    return;
  }

  const answers = gameQuestion.question.answers;
  const tensionCutoff = gameQuestion.question.tensionCutoff;
  const results: Array<{
    playerId: string;
    playerName: string;
    answer: string;
    matchedRank: number | null;
    points: number;
    usedDouble: boolean;
    matchMethod: string;
  }> = [];

  // Ensure every required player has a submission (empty = not on list)
  for (const player of gameState.players.values()) {
    if (!gameState.submissions.has(player.id)) {
      gameState.submissions.set(player.id, {
        playerId: player.id,
        answer: '',
        normalizedAnswer: '',
        locked: true,
        usedDouble: false,
        lockedAt: new Date(),
      });
    } else {
      const sub = gameState.submissions.get(player.id)!;
      if (!sub.locked) {
        sub.locked = true;
        sub.lockedAt = new Date();
        // Finalize double if they had one pending without lock
        if (sub.usedDouble && player.doublesRemaining > 0) {
          player.doublesRemaining--;
          await prisma.player.update({
            where: { id: player.id },
            data: { doublesRemaining: player.doublesRemaining },
          });
        } else if (sub.usedDouble && player.doublesRemaining <= 0) {
          sub.usedDouble = false;
        }
      }
    }
  }

  for (const [playerId, submission] of gameState.submissions) {
    const player = gameState.players.get(playerId);
    const match = matchAnswer(
      submission.answer,
      answers.map((a) => ({
        id: a.id,
        rank: a.rank,
        answerText: a.answerText,
        aliases: a.aliases,
      })),
      tensionCutoff
    );

    let points = match.points;
    const usedDouble = submission.usedDouble;

    if (usedDouble && points !== 0) {
      points *= 2;
    }

    await prisma.submission.create({
      data: {
        gameId,
        playerId,
        round: gameState.currentRound,
        submittedAnswer: submission.answer,
        normalizedAnswer: submission.normalizedAnswer || normalizeAnswer(submission.answer),
        answerMatchId: match.answerMatchId,
        matchedRank: match.rank,
        pointsAwarded: points,
        usedDouble,
        lockedAt: submission.lockedAt,
      },
    });

    if (player) {
      player.score += points;
      await prisma.player.update({
        where: { id: playerId },
        data: { score: player.score },
      });
    }

    results.push({
      playerId,
      playerName: player?.name || 'Unknown',
      answer: submission.answer || '(no answer)',
      matchedRank: match.rank,
      points,
      usedDouble,
      matchMethod: match.method,
    });
  }

  io.to(`game:${gameId}`).emit('round:reveal', {
    round: gameState.currentRound,
    answers: answers.map((a) => ({
      rank: a.rank,
      answer: a.answerText,
      displayValue: a.displayValue,
      points: a.points,
    })),
    results: results.sort((a, b) => (b.points || 0) - (a.points || 0)),
    leaderboard: Array.from(gameState.players.values())
      .sort((a, b) => b.score - a.score)
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        doublesRemaining: p.doublesRemaining,
      })),
  });
}

async function endGame(io: Server, prisma: PrismaClient, gameId: string) {
  const gameState = gameStates.get(gameId);
  if (!gameState) return;

  if (gameState.status === 'completed') return;
  gameState.status = 'completed';
  gameState.roundPhase = 'idle';

  await prisma.game.update({
    where: { id: gameId },
    data: {
      status: 'completed',
      completedAt: new Date(),
    },
  });

  const finalLeaderboard = Array.from(gameState.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, index) => ({
      position: index + 1,
      id: p.id,
      name: p.name,
      score: p.score,
    }));

  io.to(`game:${gameId}`).emit('game:ended', {
    leaderboard: finalLeaderboard,
  });

  setTimeout(() => {
    gameStates.delete(gameId);
  }, 60000);
}
