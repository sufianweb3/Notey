import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  // A throwaway data dir per run, against the production Node build.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `node scripts/e2e-server.mjs ${PORT}`,
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
