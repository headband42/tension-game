/**
 * One-time (and safe to re-run) local setup: creates .env, generates the
 * Prisma client, applies migrations, and imports the bundled questions.
 */
import { copyFileSync, existsSync } from 'node:fs';
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

if (!existsSync(resolve(root, '.env'))) {
  copyFileSync(resolve(root, '.env.example'), resolve(root, '.env'));
  console.log('→ Created apps/server/.env from .env.example');
}

run('Generate the Prisma client', ['x', 'prisma', 'generate', '--no-hints']);
run('Apply database migrations', ['x', 'prisma', 'migrate', 'deploy']);
run('Import the bundled questions', ['src/content/import-cli.ts', 'data']);

console.log('\nAll set. Start the game with `bun run dev` from the repository root.');
