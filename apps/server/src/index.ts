import { resolve } from 'node:path';
import { createPrisma } from './db';
import { lanAddresses } from './http/api';
import { createTensionServer } from './server';

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';
// In development Vite serves the UI (see apps/web/vite.config.ts), so skip any stale build.
const apiOnly = process.argv.includes('--api-only');
const webDir = apiOnly ? undefined : process.env.WEB_DIR || resolve(import.meta.dir, '../../web/build');
// Unlocks the question manager at /admin; `bun run setup` puts a random one in apps/server/.env.
const adminPassword = process.env.ADMIN_PASSWORD || undefined;

const prisma = createPrisma();
const server = createTensionServer({ prisma, webDir, adminPassword });

server.httpServer.listen(port, host, () => {
  console.log(`Tension server listening on http://localhost:${port}`);
  if (server.servesWeb) {
    for (const address of lanAddresses()) console.log(`  Phones on your network: http://${address}:${port}`);
  } else if (apiOnly) {
    console.log('  API only — open the web app from the Vite dev server.');
  } else {
    console.log('  No web build found, so only the API is served. Run `bun run build` first.');
  }
  if (!adminPassword) {
    console.log('  Question manager is off. Set ADMIN_PASSWORD in apps/server/.env to turn it on.');
  } else if (server.servesWeb || apiOnly) {
    const page = server.servesWeb ? `http://localhost:${port}/admin` : '/admin on the Vite dev server';
    console.log(`  Question manager: ${page} (password: ADMIN_PASSWORD in apps/server/.env)`);
  }
});

async function shutdown() {
  await server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
