import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

/** apps/server/prisma/dev.db, regardless of the directory the process was started from. */
export const DEFAULT_DATABASE_URL = `file:${resolve(import.meta.dir, '../prisma/dev.db')}`;

export function createPrisma(url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL) {
  return new PrismaClient({ datasourceUrl: url });
}
