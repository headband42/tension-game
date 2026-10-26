import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { PrismaClient } from '@prisma/client';
import { Hono } from 'hono';
import { Server } from 'socket.io';
import { RoomRegistry } from './game/registry';
import { attachGameSockets, isWatched, type GameServer } from './game/sockets';
import { PrismaGameStore } from './game/store';
import { createApi } from './http/api';

export interface ServerOptions {
  prisma: PrismaClient;
  /** Built web app (apps/web/build). Served when present so production needs one port. */
  webDir?: string;
  /** Extra time a round stays open past its visible deadline. */
  graceMs?: number;
  /** Unlocks the question manager's API (/api/admin), which exposes answers. Off without one. */
  adminPassword?: string;
}

export function createTensionServer({ prisma, webDir, graceMs, adminPassword }: ServerOptions) {
  const store = new PrismaGameStore(prisma);
  const registry = new RoomRegistry(store, graceMs);

  const app = new Hono();
  app.route('/api', createApi(prisma, store, registry, adminPassword));

  const servesWeb = Boolean(webDir && existsSync(join(webDir, 'index.html')));
  if (webDir && servesWeb) {
    app.use('*', serveStatic({ root: webDir }));
    app.get('*', serveStatic({ path: join(webDir, 'index.html') })); // client-side routes
  } else {
    app.get('/', (c) =>
      c.text(
        'Tension game server. In development, open the web app on the Vite dev server (port 5173); ' +
          'to serve it from here, run `bun run build` and restart.',
      ),
    );
  }

  // Socket.IO takes over /socket.io/ requests and passes everything else to Hono.
  const httpServer = createServer(getRequestListener(app.fetch));
  const io: GameServer = new Server(httpServer, { serveClient: false });
  attachGameSockets(io, registry);

  const sweeper = setInterval(() => registry.sweep((code) => isWatched(io, code)), 10 * 60 * 1000);
  sweeper.unref();

  return {
    httpServer,
    io,
    registry,
    servesWeb,
    async close() {
      clearInterval(sweeper);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await registry.close();
    },
  };
}
