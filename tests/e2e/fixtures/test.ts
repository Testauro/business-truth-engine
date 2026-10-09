import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rule } from '@bte/core';
import { BteVerifier, httpEvidenceSource } from '@bte/playwright';
import { loadRules } from '@bte/rules';
import { test as base, expect } from '@playwright/test';
import { DemoApi } from '../api/demo-api.js';
import { CheckoutPage } from '../pages/checkout.page.js';
import { startDemoServer, type DemoServer } from './demo-server.js';

const rulesDir = fileURLToPath(new URL('../../../rules', import.meta.url));

interface WorkerFixtures {
  demoServer: DemoServer;
  rules: Rule[];
}

interface TestFixtures {
  api: DemoApi;
  checkout: CheckoutPage;
  /** BTE verifier bound to this test's demo server and clock; attaches verdicts to the report. */
  bte: BteVerifier;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  demoServer: [
    async ({}, use) => {
      const server = await startDemoServer();
      await use(server);
      await server.stop();
    },
    { scope: 'worker' },
  ],
  rules: [
    async ({}, use) => {
      await use(await loadRules(path.resolve(rulesDir)));
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ demoServer }, use) => {
    await use(demoServer.baseUrl);
  },
  api: async ({ request }, use) => {
    const api = new DemoApi(request);
    // Every test starts from a clean fault configuration.
    await api.setFaults([]);
    await use(api);
    await api.setFaults([]);
  },
  checkout: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },
  bte: async ({ request, api, rules }, use, testInfo) => {
    const verifier = new BteVerifier({
      rules,
      fetchEvidence: httpEvidenceSource(request, '/evidence'),
      now: () => api.now(),
      refresh: async () => {
        await api.collectEvidence();
      },
      testInfo,
    });
    await use(verifier);
  },
});

export { expect };
