import { defineConfig } from '@playwright/test';

const docPort = process.env.DOCUSAURUS_PORT ? Number(process.env.DOCUSAURUS_PORT) : 3009;
const docUrl = `http://127.0.0.1:${docPort}`;

console.log('PLAYWRIGHT DEV CONFIG LOADED', { docPort, docUrl });

export default defineConfig({
  testDir: './tests',
  testMatch: /i18n-dev\.spec\.ts/,
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `${docUrl}/`,
    actionTimeout: 15000,
    navigationTimeout: 45000,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: `npx docusaurus start --host=127.0.0.1 --port=${docPort}`,
    url: `${docUrl}/`,
    timeout: 240000,
    reuseExistingServer: true,
  },
});
