import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4322',
    trace: 'on-first-retry',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'], browserName: 'chromium' } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @bj/api dev',
      url: 'http://127.0.0.1:4100/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @bj/admin exec vite --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173/admin/',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node node_modules/astro/bin/astro.mjs preview --host 127.0.0.1 --port 4322',
      cwd: './apps/web',
      url: 'http://127.0.0.1:4322',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
