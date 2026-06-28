import { defineConfig } from 'vitest/config';

/**
 * The leaderboard suite runs real aggregation SQL against a throwaway Postgres
 * database (`cardmkt_test`), provisioned and migrated once in `globalSetup`.
 * Other suites (e.g. portfolio) mock `@cardmkt/db` and never connect, so the
 * shared `DATABASE_URL` override is harmless to them.
 *
 * `fileParallelism: false` keeps DB-touching suites from racing on shared tables.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cardmkt_test';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
