import { defineConfig } from '@playwright/test';

const docPort = process.env.DOCUSAURUS_PORT ? Number(process.env.DOCUSAURUS_PORT) : 3009;
const docUrl = `http://127.0.0.1:${docPort}`;
const appUrl = `${docUrl}/Megacubo/`;
console.log('PLAYWRIGHT CONFIG LOADED', { docPort, docUrl, appUrl });

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: appUrl,
    actionTimeout: 10000,
    navigationTimeout: 30000,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: `node ./scripts/serve-build.mjs --port ${docPort}`,
    url: appUrl,
    timeout: 180000,
    reuseExistingServer: false,
  },
});
