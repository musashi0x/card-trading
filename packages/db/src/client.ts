/**
 * Postgres connection + Drizzle client.
 *
 * A single shared `postgres` pool per process, wrapped by Drizzle. The schema
 * is attached so queries are fully typed at call sites.
 */

import { resolve } from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

// Load the monorepo-root .env before reading DATABASE_URL (pnpm sets cwd per package).
config({ path: resolve(process.cwd(), '../..', '.env') });
config();

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cardmkt';

export const queryClient = postgres(connectionString, { max: 10 });
export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
