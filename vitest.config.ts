import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Shared by both test configs. */
export const workspaceSources = {
  // Packages export compiled `dist/` at runtime; tests must run against the source, never a stale build.
  alias: {
    '@novee/contracts': source('./packages/contracts/src/index.ts'),
    '@novee/db': source('./packages/db/src/index.ts'),
  },
};

export default defineConfig({
  resolve: workspaceSources,
  test: {
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    // Database tests need a Postgres: they run with `task test:db` (vitest.db.config.ts).
    exclude: ['**/node_modules/**', '**/*.db.test.ts'],
    passWithNoTests: true,
  },
});
