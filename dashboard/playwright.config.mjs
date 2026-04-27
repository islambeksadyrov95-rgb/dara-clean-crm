import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npx serve . -l 3399',
    port: 3399,
    reuseExistingServer: true,
    timeout: 10000
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } }
  ]
})
