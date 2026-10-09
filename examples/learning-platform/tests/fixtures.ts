import { fileURLToPath } from 'node:url';
import { createBteFixtures, type Bte, type BteWorkerState } from '@bte/playwright';
import { test as base, expect, type APIRequestContext } from '@playwright/test';

const projectDir = fileURLToPath(new URL('..', import.meta.url));

/** Small client for the stub's test controls and the enrollment page. */
export class Lms {
  constructor(private readonly request: APIRequestContext) {}
  async reset(): Promise<void> {
    await this.request.post('/admin/reset');
  }
  async fault(
    name: 'none' | 'missing-access' | 'wrong-course' | 'access-api-down' | 'delayed-access',
  ): Promise<void> {
    await this.request.put('/admin/fault', { data: { fault: name } });
  }
  async now(): Promise<number> {
    const body = (await (await this.request.get('/admin/clock')).json()) as { now: string };
    return Date.parse(body.now);
  }
  async advance(ms: number): Promise<void> {
    await this.request.post('/admin/clock/advance', { data: { ms } });
  }
}

const bteFixtures = createBteFixtures({ config: { cwd: projectDir } });

export const test = base.extend<{ lms: Lms; bte: Bte }, { bteState: BteWorkerState }>({
  bteState: bteFixtures.bteState,
  lms: async ({ request }, use) => {
    const lms = new Lms(request);
    await lms.reset();
    await use(lms);
    await lms.reset();
  },
  // Evaluate at the platform's controllable clock instead of the wall clock.
  bte: async ({ bteState, lms }, use, testInfo) => {
    const { createBte } = await import('@bte/playwright');
    await use(createBte(bteState, { now: () => lms.now() }, testInfo));
  },
});

export { expect };
