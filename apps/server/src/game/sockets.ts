import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { Ack, ClientToServerEvents, GameView, ServerToClientEvents, StatePayload } from '@tension/shared';
import type { RoomRegistry } from './registry';
import type { GameRoom } from './room';

interface SocketData {
  code?: string;
  role?: 'host' | 'player';
  playerId?: string;
}

type NoEvents = Record<string, never>;
export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, NoEvents, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, NoEvents, SocketData>;

const hostJoin = z.object({ code: z.string().max(16), token: z.string().max(100) });
const playerJoin = z.object({
  code: z.string().max(16),
  name: z.string().max(100),
  deviceId: z.string().min(8).max(100),
});
const answer = z.object({ answer: z.string().max(1000), useDouble: z.boolean() });

const channel = (code: string) => `game:${code}`;

function reply<T extends object>(ack: unknown, result: Ack<T>) {
  if (typeof ack === 'function') ack(result);
}

function stateFor(socket: GameSocket, room: GameRoom, game: GameView = room.view()): StatePayload {
  const { role, playerId } = socket.data;
  return { game, you: role === 'player' && playerId ? room.you(playerId) : null };
}

/** Sends every socket in the room its own snapshot. */
function broadcast(io: GameServer, room: GameRoom) {
  const ids = io.sockets.adapter.rooms.get(channel(room.code));
  if (!ids) return;
  const game = room.view();
  for (const id of ids) {
    const socket = io.sockets.sockets.get(id);
    if (socket) socket.emit('state', stateFor(socket, room, game));
  }
}

/** Runs a handler, logging failures and answering the ack (if any) instead of crashing. */
function guarded<A extends unknown[]>(handler: (...args: A) => Promise<void> | void) {
  return async (...args: A) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error('Socket handler failed:', error);
      reply(args.at(-1), { ok: false, error: 'Something went wrong on the server' });
    }
  };
}

export function isWatched(io: GameServer, code: string) {
  return (io.sockets.adapter.rooms.get(channel(code))?.size ?? 0) > 0;
}

export function attachGameSockets(io: GameServer, registry: RoomRegistry) {
  registry.onRoomChange = (room) => broadcast(io, room);

  io.on('connection', (socket) => {
    const currentRoom = () => (socket.data.code ? registry.get(socket.data.code) : Promise.resolve(null));

    async function leaveCurrentGame() {
      const { code, role, playerId } = socket.data;
      if (!code) return;
      socket.leave(channel(code));
      socket.data = {};
      if (role === 'player' && playerId) (await registry.get(code))?.disconnect(playerId, socket.id);
    }

    async function enter(room: GameRoom, data: SocketData) {
      const { code, role, playerId } = socket.data;
      const sameSeat = code === room.code && role === data.role && playerId === data.playerId;
      if (!sameSeat) await leaveCurrentGame();
      socket.data = data;
      await socket.join(channel(room.code));
      socket.emit('state', stateFor(socket, room));
    }

    function hostAction(action: (room: GameRoom) => void) {
      return guarded(async () => {
        const room = socket.data.role === 'host' ? await currentRoom() : null;
        if (room) action(room);
      });
    }

    function playerAction(action: (room: GameRoom, playerId: string, payload: z.infer<typeof answer>) => void) {
      return guarded(async (payload: unknown) => {
        const parsed = answer.safeParse(payload);
        const { role, playerId } = socket.data;
        if (!parsed.success || role !== 'player' || !playerId) return;
        const room = await currentRoom();
        if (room) action(room, playerId, parsed.data);
      });
    }

    socket.on(
      'host:join',
      guarded(async (payload: unknown, ack: unknown) => {
        const parsed = hostJoin.safeParse(payload);
        if (!parsed.success) return reply(ack, { ok: false, error: 'Invalid request' });
        const room = await registry.get(parsed.data.code);
        if (!room) return reply(ack, { ok: false, error: 'No game with that code' });
        if (!room.isHost(parsed.data.token)) {
          return reply(ack, { ok: false, error: 'This browser is not the host of that game' });
        }
        await enter(room, { code: room.code, role: 'host' });
        reply(ack, { ok: true });
      }),
    );

    socket.on(
      'player:join',
      guarded(async (payload: unknown, ack: unknown) => {
        const parsed = playerJoin.safeParse(payload);
        if (!parsed.success) return reply(ack, { ok: false, error: 'Invalid request' });
        const { code, name, deviceId } = parsed.data;
        const room = await registry.get(code);
        if (!room) return reply(ack, { ok: false, error: 'No game with that code' });

        const result = room.join(name, deviceId, socket.id);
        if (!result.ok) return reply(ack, result);
        await enter(room, { code: room.code, role: 'player', playerId: result.playerId });
        reply(ack, result);
      }),
    );

    socket.on(
      'host:start',
      guarded(async (ack: unknown) => {
        const room = socket.data.role === 'host' ? await currentRoom() : null;
        if (!room) return reply(ack, { ok: false, error: 'Only the host can start the game' });
        reply(ack, await room.start());
      }),
    );

    socket.on('host:endRound', hostAction((room) => room.endRound()));
    socket.on('host:skipOffline', hostAction((room) => room.skipOfflinePlayers()));
    socket.on('host:next', hostAction((room) => room.next()));

    socket.on('player:draft', playerAction((room, id, p) => room.draft(id, p.answer, p.useDouble)));
    socket.on('player:lock', playerAction((room, id, p) => room.lock(id, p.answer, p.useDouble)));

    socket.on('disconnect', guarded(leaveCurrentGame));
  });
}
