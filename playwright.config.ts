import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 8790;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Serves the built app from dist/, so run `npm run build` first.
  webServer: {
    command: 'node server/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: {
      PORT: String(PORT),
      DATA_DIR: mkdtempSync(path.join(tmpdir(), 'planner-e2e-')),
      GITHUB_TOKEN: '',
    },
  },
});
