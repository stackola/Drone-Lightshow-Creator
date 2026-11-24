import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  use: { baseURL: 'http://localhost:5173', trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: { command: 'pnpm dev --port 5173 --strictPort', port: 5173, reuseExistingServer: true },
})
