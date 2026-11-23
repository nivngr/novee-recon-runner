import { defineConfig } from 'vitest/config';
import { workspaceSources } from './vitest.config.js';

// Used by `task test:db`, which starts a throwaway Postgres and applies the migrations first.
export default defineConfig({
  resolve: workspaceSources,
  test: {
    include: ['packages/*/src/**/*.db.test.ts'],
    fileParallelism: false,
  },
});
