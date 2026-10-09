import { ManualClock } from '@bte/core';
import { buildDemo, type DemoApp } from '@bte/demo';

export interface DemoServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

export const DEMO_CLOCK_START = '2026-01-15T10:00:00.000Z';

/**
 * Starts a real HTTP listener for the demo in this worker process with a
 * controllable clock, or attaches to an external one (BTE_E2E_BASE_URL).
 */
export async function startDemoServer(): Promise<DemoServer> {
  const external = process.env['BTE_E2E_BASE_URL'];
  if (external !== undefined && external !== '') {
    return { baseUrl: external.replace(/\/$/, ''), stop: () => Promise.resolve() };
  }
  const manualClock = new ManualClock(DEMO_CLOCK_START);
  const demo: DemoApp = buildDemo({ clock: manualClock, manualClock, faults: [] });
  const baseUrl = await demo.app.listen({ port: 0, host: '127.0.0.1' });
  return {
    baseUrl,
    stop: async () => {
      await demo.app.close();
    },
  };
}
