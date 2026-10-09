import { fileURLToPath } from 'node:url';
import { createBteFixtures, type Bte, type BteWorkerState } from '@bte/playwright';
import { test as base, expect } from '@playwright/test';
import { DemoApi } from '../api/demo-api.js';
import { CheckoutPage } from '../pages/checkout.page.js';
import { startDemoServer, type DemoServer } from './demo-server.js';

const e2eDir = fileURLToPath(new URL('..', import.meta.url));

interface WorkerFixtures {
  demoServer: DemoServer;
  bteState: BteWorkerState;
}

interface TestFixtures {
  api: DemoApi;
  checkout: CheckoutPage;
  bte: Bte;
}

/**
 * The demo's Playwright `test`: its own fixtures (server, API client, page
 * objects) plus BTE's, added with `createBteFixtures` exactly as a third
 * party would. Sources come from tests/e2e/bte.config.ts (generic HTTP
 * adapter over the demo's JSON API); the demo's clock drives evaluation time.
 */
const bteFixtures = createBteFixtures({ config: { cwd: e2eDir, env: process.env } });

export const test = base.extend<TestFixtures, WorkerFixtures>({
  demoServer: [
    async ({}, use) => {
      const server = await startDemoServer();
      process.env['BTE_DEMO_BASE_URL'] = server.baseUrl;
      await use(server);
      await server.stop();
    },
    { scope: 'worker' },
  ],
  // bteState must see BTE_DEMO_BASE_URL, so it depends on demoServer.
  bteState: [
    async ({ demoServer: _server }, use) => {
      await bteFixtures.bteState[0]({}, use);
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ demoServer }, use) => {
    await use(demoServer.baseUrl);
  },
  api: async ({ request }, use) => {
    const api = new DemoApi(request);
    await api.setFaults([]);
    await use(api);
    await api.setFaults([]);
  },
  checkout: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },
  bte: async ({ bteState, api }, use, testInfo) => {
    // Evaluate at the demo's (controllable) clock rather than the wall clock.
    const { createBte } = await import('@bte/playwright');
    const bte = createBte(bteState, { now: () => api.now() }, testInfo);
    await use(bte);
  },
});

export { expect };
