import { defineConfig, devices } from '@playwright/test';

// The R8 browser test runs against the deployed stack (`task test:e2e` port-forwards the web app first).
export default defineConfig({
  testDir: './e2e',
  timeout: 8 * 60_000,
  // Videos are proof (D15); Playwright clears this folder at the start of each run.
  outputDir: '../../proofs/videos/r8',
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    video: 'on',
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
});
