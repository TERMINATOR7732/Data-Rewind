import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect python executable from root virtual environment or system
const venvPythonWin = path.resolve(__dirname, '../.venv/Scripts/python.exe');
const venvPythonUnix = path.resolve(__dirname, '../.venv/bin/python');
let pythonCmd = 'python';
if (fs.existsSync(venvPythonWin)) {
  pythonCmd = `"${venvPythonWin}"`;
} else if (fs.existsSync(venvPythonUnix)) {
  pythonCmd = venvPythonUnix;
}

const testDataDir = path.resolve(__dirname, '../.data_rewind_test_e2e');

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },
  ],
  webServer: [
    {
      command: `${pythonCmd} -m data_rewind.cli serve --host 127.0.0.1 --port 8000`,
      url: 'http://127.0.0.1:8000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        DATA_REWIND_DATA_DIR: testDataDir,
        PYTHONUNBUFFERED: '1',
      },
    },
    {
      command: 'npm run dev -- --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
