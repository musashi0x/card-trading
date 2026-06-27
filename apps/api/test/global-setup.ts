/**
 * Vitest global setup: provision and migrate the throwaway test database the
 * leaderboard aggregation suite runs against.
 *
 * Creates `cardmkt_test` if it does not exist (connecting to the maintenance
 * `postgres` database), then applies the Drizzle migrations so the schema
 * matches production. Runs once before the whole suite.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/cardmkt_test';

const here = fileURLToPath(new URL('.', import.meta.url));
const migrationsFolder = resolve(here, '../../../packages/db/drizzle');

/** Connection to the maintenance DB, used only to CREATE DATABASE if needed. */
function adminUrl(): string {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, '');
  url.pathname = '/postgres';
  return `${url.toString()}|${dbName}`;
}

export default async function setup(): Promise<void> {
  const [maintenanceUrl, dbName] = adminUrl().split('|');
  const admin = postgres(maintenanceUrl, { max: 1 });
  try {
    const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (existing.length === 0) {
      // Identifier can't be parameterised; dbName comes from our own config.
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end({ timeout: 5 });
  }

  const client = postgres(TEST_DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}
