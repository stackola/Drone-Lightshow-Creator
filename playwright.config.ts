import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

// Use a system Chromium when one is provided (e.g. PW_CHROMIUM=/path/to/chrome),
// otherwise Playwright's own download (`npx playwright install chromium`).
const executablePath = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  use: { baseURL: 'http://localhost:5173', trace: 'off' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: { executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
  webServer: { command: 'pnpm dev --port 5173 --strictPort', port: 5173, reuseExistingServer: true },
})
