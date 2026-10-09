import { writable } from 'svelte/store';
import { io, type Socket } from 'socket.io-client';

export interface OfficialAnswer {
  rank: number;
  answer: string;
  displayValue: string | null;
  points?: number;
}

interface GameState {
  gameId: string | null;
  code: string | null;
  hostId: string | null;
  isHost: boolean;
  status: 'setup' | 'waiting' | 'active' | 'completed' | null;
  currentRound: number;
  totalRounds: number;
  waitForReconnects: boolean;
  players: Array<{
    id: string;
    name: string;
    score: number;
    connected: boolean;
    doublesRemaining?: number;
  }>;
  currentQuestion: {
    id: string;
    text: string;
    category: string;
    timeLimit: number;
  } | null;
  submissions: Array<{
    playerId: string;
    hasAnswer: boolean;
    locked: boolean;
    usedDouble: boolean;
  }>;
  /** Official ranked answer list for reveal */
  officialAnswers: OfficialAnswer[] | null;
  results: Array<{
    playerId: string;
    playerName: string;
    answer: string;
    matchedRank: number | null;
    points: number;
    usedDouble: boolean;
    matchMethod?: string;
  }> | null;
  leaderboard: Array<{
    id: string;
    name: string;
    score: number;
    doublesRemaining?: number;
  }> | null;
  doublesRemaining: number | null;
}

interface SocketStore {
  socket: Socket | null;
  isConnected: boolean;
  gameState: GameState;
  error: string | null;
}

const initialGameState: GameState = {
  gameId: null,
  code: null,
  hostId: null,
  isHost: false,
  status: null,
  currentRound: 0,
  totalRounds: 0,
  waitForReconnects: true,
  players: [],
  currentQuestion: null,
  submissions: [],
  officialAnswers: null,
  results: null,
  leaderboard: null,
  doublesRemaining: null,
};

function upsertPlayer(
  players: GameState['players'],
  player: GameState['players'][0]
): GameState['players'] {
  const idx = players.findIndex((p) => p.id === player.id);
  if (idx >= 0) {
    const next = [...players];
    next[idx] = { ...next[idx], ...player };
    return next;
  }
  return [...players, player];
}

function createSocketStore() {
  const { subscribe, set, update } = writable<SocketStore>({
    socket: null,
    isConnected: false,
    gameState: { ...initialGameState },
    error: null,
  });

  let socket: Socket | null = null;
  let handlersBound = false;

  function bindHandlers(s: Socket) {
    if (handlersBound) return;
    handlersBound = true;

    s.on('connect', () => {
      console.log('Socket connected:', s.id);
      update((st) => ({ ...st, isConnected: true, error: null }));
    });

    s.on('disconnect', () => {
      console.log('Socket disconnected');
      update((st) => ({ ...st, isConnected: false }));
    });

    s.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      update((st) => ({
        ...st,
        error: 'Connection failed: ' + err.message,
      }));
    });

    s.on('error', (data: { message: string }) => {
      update((st) => ({ ...st, error: data.message }));
    });

    s.on(
      'host:joined',
      (data: { gameId: string; code?: string; hostId?: string }) => {
        update((st) => ({
          ...st,
          gameState: {
            ...st.gameState,
            gameId: data.gameId,
            code: data.code ?? st.gameState.code,
            hostId: data.hostId ?? st.gameState.hostId,
            isHost: true,
          },
        }));
      }
    );

    s.on(
      'player:joined',
      (data: {
        playerId: string;
        gameId: string;
        code: string;
        doublesRemaining?: number;
      }) => {
        localStorage.setItem('playerId', data.playerId);
        update((st) => ({
          ...st,
          gameState: {
            ...st.gameState,
            gameId: data.gameId,
            code: data.code,
            doublesRemaining:
              data.doublesRemaining ?? st.gameState.doublesRemaining,
            isHost: false,
          },
        }));
      }
    );

    s.on(
      'game:state',
      (data: {
        status: string;
        currentRound: number;
        totalRounds: number;
        players: Array<{
          id: string;
          name: string;
          score: number;
          connected: boolean;
          doublesRemaining?: number;
        }>;
        code?: string;
        waitForReconnects?: boolean;
      }) => {
        update((st) => ({
          ...st,
          gameState: {
            ...st.gameState,
            status: data.status as GameState['status'],
            currentRound: data.currentRound,
            totalRounds: data.totalRounds,
            players: data.players,
            code: data.code ?? st.gameState.code,
            waitForReconnects:
              data.waitForReconnects ?? st.gameState.waitForReconnects,
          },
        }));
      }
    );

    s.on('player:connected', (data: { player: GameState['players'][0] }) => {
      update((st) => ({
        ...st,
        gameState: {
          ...st.gameState,
          players: upsertPlayer(st.gameState.players, {
            ...data.player,
            connected: true,
          }),
        },
      }));
    });

    s.on('player:disconnected', (data: { playerId: string }) => {
      update((st) => ({
        ...st,
        gameState: {
          ...st.gameState,
          players: st.gameState.players.map((p) =>
            p.id === data.playerId ? { ...p, connected: false } : p
          ),
        },
      }));
    });

    s.on(
      'player:updated',
      (data: { playerId: string; doublesRemaining: number }) => {
        update((st) => {
          const myId =
            typeof localStorage !== 'undefined'
              ? localStorage.getItem('playerId')
              : null;
          return {
            ...st,
            gameState: {
              ...st.gameState,
              players: st.gameState.players.map((p) =>
                p.id === data.playerId
                  ? { ...p, doublesRemaining: data.doublesRemaining }
                  : p
              ),
              doublesRemaining:
                myId === data.playerId
                  ? data.doublesRemaining
                  : st.gameState.doublesRemaining,
            },
          };
        });
      }
    );

    s.on('game:started', (data: { totalRounds: number; code?: string }) => {
      update((st) => ({
        ...st,
        gameState: {
          ...st.gameState,
          status: 'active',
          totalRounds: data.totalRounds,
          code: data.code ?? st.gameState.code,
          results: null,
          officialAnswers: null,
        },
      }));
    });

    s.on(
      'round:start',
      (data: {
        round: number;
        totalRounds: number;
        question: {
          id: string;
          text: string;
          category: string;
          timeLimit: number;
        };
      }) => {
        update((st) => ({
          ...st,
          gameState: {
            ...st.gameState,
            status: 'active',
            currentRound: data.round,
            totalRounds: data.totalRounds,
            currentQuestion: data.question,
            submissions: [],
            results: null,
            officialAnswers: null,
          },
        }));
      }
    );

    s.on(
      'submission:update',
      (data: {
        playerId: string;
        hasAnswer: boolean;
        locked: boolean;
        usedDouble?: boolean;
      }) => {
        update((st) => {
          const existingIndex = st.gameState.submissions.findIndex(
            (sub) => sub.playerId === data.playerId
          );
          const newSubmissions = [...st.gameState.submissions];

          if (existingIndex >= 0) {
            newSubmissions[existingIndex] = {
              ...newSubmissions[existingIndex],
              ...data,
              usedDouble:
                data.usedDouble ??
                newSubmissions[existingIndex].usedDouble ??
                false,
            };
          } else {
            newSubmissions.push({
              playerId: data.playerId,
              hasAnswer: data.hasAnswer,
              locked: data.locked,
              usedDouble: data.usedDouble ?? false,
            });
          }

          return {
            ...st,
            gameState: {
              ...st.gameState,
              submissions: newSubmissions,
            },
          };
        });
      }
    );

    s.on(
      'round:reveal',
      (data: {
        round: number;
        answers: OfficialAnswer[];
        results: GameState['results'];
        leaderboard: GameState['leaderboard'];
      }) => {
        update((st) => ({
          ...st,
          gameState: {
            ...st.gameState,
            officialAnswers: data.answers,
            results: data.results,
            leaderboard: data.leaderboard,
          },
        }));
      }
    );

    s.on('game:ended', (data: { leaderboard: GameState['leaderboard'] }) => {
      update((st) => ({
        ...st,
        gameState: {
          ...st.gameState,
          status: 'completed',
          leaderboard: data.leaderboard,
          results: null,
          officialAnswers: null,
          currentQuestion: null,
        },
      }));
    });

    s.on('answer:received', (data?: { usedDouble?: boolean }) => {
      if (data?.usedDouble === false) {
        // Server stripped invalid double — nothing extra needed
      }
    });
  }

  return {
    subscribe,

    connect() {
      if (socket?.connected) return socket;

      // Reuse existing socket if reconnecting
      if (socket && !socket.connected) {
        socket.connect();
        return socket;
      }

      const isLocalhost =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';
      const SOCKET_URL = isLocalhost
        ? import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'
        : `http://${window.location.hostname}:3001`;

      socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
      });

      handlersBound = false;
      bindHandlers(socket);

      // Preserve existing gameState on reconnect; only set socket refs
      update((st) => ({
        ...st,
        socket,
        isConnected: socket!.connected,
        error: null,
      }));

      return socket;
    },

    disconnect() {
      socket?.disconnect();
      socket = null;
      handlersBound = false;
      set({
        socket: null,
        isConnected: false,
        gameState: { ...initialGameState },
        error: null,
      });
    },

    // Host actions
    hostJoin(gameId: string, hostId?: string) {
      socket?.emit('host:join', { gameId, hostId });
    },

    startGame() {
      socket?.emit('game:start');
    },

    nextRound() {
      socket?.emit('host:nextRound');
    },

    endRound() {
      socket?.emit('host:endRound');
    },

    proceedWithout() {
      socket?.emit('host:proceedWithout');
    },

    // Player actions
    joinGame(code: string, name: string, deviceId: string) {
      socket?.emit('player:join', { code, name, deviceId });
    },

    submitAnswer(answer: string, usedDouble: boolean) {
      socket?.emit('player:submit', { answer, usedDouble });
    },

    lockAnswer() {
      socket?.emit('player:lock');
    },

    clearError() {
      update((st) => ({ ...st, error: null }));
    },
  };
}

export const socketStore = createSocketStore();
