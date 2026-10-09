import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPrisma } from '../db';
import { importPack, parsePack } from './importer';

const USAGE = `Usage: bun run import <pack.json> [more.json ...] [--replace] [--dry-run]

  --replace   overwrite questions that already exist (matched by category + question text)
  --dry-run   validate the files without touching the database

See docs/QUESTIONS.md for the file format.`;

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const files = args.filter((arg) => !arg.startsWith('--'));
const unknown = [...flags].filter((flag) => !['--replace', '--dry-run', '--help'].includes(flag));

if (files.length === 0 || flags.has('--help') || unknown.length > 0) {
  if (unknown.length > 0) console.error(`Unknown option: ${unknown.join(', ')}\n`);
  console.error(USAGE);
  process.exit(files.length === 0 || unknown.length > 0 ? 1 : 0);
}

const prisma = flags.has('--dry-run') ? null : createPrisma();
let failed = false;

for (const file of files) {
  const path = resolve(file);
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    console.error(`✗ ${file}: ${error instanceof Error ? error.message : error}`);
    failed = true;
    continue;
  }

  const parsed = parsePack(data);
  if (!parsed.ok) {
    console.error(`✗ ${file} is not a valid question pack:\n${parsed.errors}`);
    failed = true;
    continue;
  }

  for (const warning of parsed.warnings) console.warn(`⚠ ${file}: ${warning}`);

  if (!prisma) {
    console.log(`✓ ${file}: ${parsed.pack.questions.length} valid questions`);
    continue;
  }

  const summary = await importPack(prisma, parsed.pack, { replace: flags.has('--replace') });
  console.log(
    `✓ ${file}: ${summary.created} added, ${summary.updated} updated, ${summary.skipped} already present` +
      (summary.categoriesCreated ? `, ${summary.categoriesCreated} new categories` : ''),
  );
}

await prisma?.$disconnect();
process.exit(failed ? 1 : 0);
