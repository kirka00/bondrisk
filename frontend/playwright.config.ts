import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    locale: 'ru-RU',
    colorScheme: 'light',
  },
  projects: [
    { name: 'chrome', testMatch: /e2e\/\d\d-.*\.spec\.ts/, use: { channel: 'chrome', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', testMatch: /e2e\/mobile\/.*\.spec\.ts/, use: { ...devices['iPhone 14'], browserName: 'chromium', channel: 'chrome' } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
