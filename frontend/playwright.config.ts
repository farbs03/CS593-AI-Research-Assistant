import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// E2E runs the real React app (vite dev) against the real FastAPI app, with only external
// services (LLM, paper search, PDF download) stubbed by backend/tests/e2e_server.py.
const backendDir = path.resolve(import.meta.dirname, '../backend')
const python = path.join(backendDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // tests share one backend + database
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `"${python}" -m tests.e2e_server --port 8000`,
      cwd: backendDir,
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
