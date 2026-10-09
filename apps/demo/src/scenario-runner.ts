import type { Clock, ManualClock } from '@bte/core';
import type { EvidenceCollector } from './evidence/collector.js';
import { DELAYED_INVOICE_MS } from './domain/invoicing.js';
import { buildDemo, type DemoApp } from './http/app.js';
import type { Fault } from './faults.js';

export interface ScenarioOptions {
  clock: ManualClock;
  faults: readonly Fault[];
  /** Milliseconds to advance after checkout before the final collection. Default: past the 120s deadline. */
  settleMs?: number;
}

export interface ScenarioResult {
  demo: DemoApp;
  clock: Clock;
  collector: EvidenceCollector;
  orderId: string;
  paymentId: string;
  total: number;
  /** What the customer saw: the order page said payment was received. */
  uiConfirmed: boolean;
}

export const DEFAULT_SETTLE_MS = 121_000;

/**
 * The same checkout a Playwright test would drive, executed in-process via
 * Fastify's inject. Evidence is collected right after checkout (window open)
 * and again after the clock has moved past the deadline.
 */
export async function runScenario(options: ScenarioOptions): Promise<ScenarioResult> {
  const demo = buildDemo({ clock: options.clock, faults: options.faults });
  const { app } = demo;
  await app.ready();

  const checkout = await app.inject({
    method: 'POST',
    url: '/checkout',
    payload: {
      customerId: 'cus_demo',
      cardNumber: '4242424242424242',
      'qty_BTE-TEE': '1',
      'qty_BTE-MUG': '2',
    },
  });
  if (checkout.statusCode !== 303) {
    throw new Error(`checkout failed: ${checkout.statusCode} ${checkout.body}`);
  }
  const location = checkout.headers.location;
  if (typeof location !== 'string') throw new Error('checkout did not redirect');
  const orderId = location.replace('/orders/', '');

  const page = await app.inject({ method: 'GET', url: location });
  const uiConfirmed = page.statusCode === 200 && page.body.includes('Payment received');

  const order = demo.orders.require(orderId);
  if (order.paymentId === null) throw new Error('order is not paid');

  demo.collector.collect();
  const settle = options.settleMs ?? Math.max(DEFAULT_SETTLE_MS, DELAYED_INVOICE_MS + 1_000);
  options.clock.advance(settle);
  demo.invoicing.tick();
  demo.collector.collect();

  await app.close();
  return {
    demo,
    clock: options.clock,
    collector: demo.collector,
    orderId,
    paymentId: order.paymentId,
    total: Math.round(order.totalCents) / 100,
    uiConfirmed,
  };
}
