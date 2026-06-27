import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Web unit tests (hooks/helpers) run under jsdom. The `@/…` alias mirrors the
 * tsconfig path mapping so test imports resolve the same as app code.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
