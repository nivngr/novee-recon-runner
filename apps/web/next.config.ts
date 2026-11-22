import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // A self-contained server bundle for the container image.
  output: 'standalone',
  // In a monorepo, trace dependencies from the repo root, not just this app.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
};

export default config;
