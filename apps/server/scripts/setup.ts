/**
 * One-time (and safe to re-run) local setup: creates .env with a question
 * manager password, generates the Prisma client, applies migrations, and
 * imports the bundled questions.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

function run(label: string, args: string[]) {
  console.log(`\n→ ${label}`);
  const result = Bun.spawnSync([process.execPath, ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode !== 0) {
    console.error(`\nSetup failed while trying to ${label.toLowerCase()}.`);
    process.exit(result.exitCode ?? 1);
  }
}

const envFile = resolve(root, '.env');
if (!existsSync(envFile)) {
  copyFileSync(resolve(root, '.env.example'), envFile);
  console.log('→ Created apps/server/.env from .env.example');
}

// Fills in the commented-out placeholder from .env.example; older .env files get the line appended.
const env = readFileSync(envFile, 'utf8');
if (!/^\s*ADMIN_PASSWORD\s*=/m.test(env)) {
  const line = `ADMIN_PASSWORD="${randomBytes(12).toString('base64url')}"`;
  const placeholder = /^#\s*ADMIN_PASSWORD=.*$/m;
  writeFileSync(
    envFile,
    placeholder.test(env) ? env.replace(placeholder, line) : `${env.trimEnd()}\n\n# Password for the question manager at /admin.\n${line}\n`,
  );
  console.log('→ Added a question manager password (ADMIN_PASSWORD) to apps/server/.env');
}

run('Generate the Prisma client', ['x', 'prisma', 'generate', '--no-hints']);
run('Apply database migrations', ['x', 'prisma', 'migrate', 'deploy']);
run('Import the bundled questions', ['src/content/import-cli.ts', 'data']);

console.log('\nAll set. Start the game with `bun run dev` from the repository root.');
console.log('Manage questions at /admin, using ADMIN_PASSWORD from apps/server/.env.');
