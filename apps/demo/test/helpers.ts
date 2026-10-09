import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rule, RuleVerdict } from '@bte/core';
import { EvidenceSet, FixedClock, ManualClock, evaluateRules } from '@bte/core';
import type { EvidenceRecord } from '@bte/core';
import { loadRules } from '@bte/rules';
import { buildDemo, type DemoApp } from '../src/index.js';
import type { Fault } from '../src/index.js';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const START = '2026-01-15T10:00:00.000Z';

let cachedRules: Rule[] | undefined;
export async function invoiceRules(): Promise<Rule[]> {
  cachedRules ??= await loadRules(path.join(repoRoot, 'rules'));
  return cachedRules;
}

export async function evaluateRecords(
  records: readonly EvidenceRecord[],
  now: number | string,
): Promise<RuleVerdict[]> {
  return evaluateRules(await invoiceRules(), EvidenceSet.from(records), {
    clock: new FixedClock(now),
  });
}

export interface Harness {
  demo: DemoApp;
  clock: ManualClock;
}

export async function startDemo(faults: readonly Fault[] = []): Promise<Harness> {
  const clock = new ManualClock(START);
  const demo = buildDemo({ clock, manualClock: clock, faults });
  await demo.app.ready();
  return { demo, clock };
}

export const CHECKOUT_FORM = {
  customerId: 'cus_demo',
  cardNumber: '4242424242424242',
  'qty_BTE-TEE': '1',
  'qty_BTE-MUG': '2',
};

/** One tee (24.99) + two mugs (25.98) = 50.97, which clears free shipping. */
export const EXPECTED_TOTAL = 50.97;
export const EXPECTED_SUBTOTAL = 50.97;

export async function checkoutViaUi(h: Harness): Promise<{ orderId: string; page: string }> {
  const response = await h.demo.app.inject({
    method: 'POST',
    url: '/checkout',
    payload: CHECKOUT_FORM,
  });
  if (response.statusCode !== 303)
    throw new Error(`checkout failed: ${response.statusCode} ${response.body}`);
  const location = response.headers.location;
  if (typeof location !== 'string') throw new Error('no redirect');
  const page = await h.demo.app.inject({ method: 'GET', url: location });
  return { orderId: location.replace('/orders/', ''), page: page.body };
}

export function codes(verdict: RuleVerdict | undefined): string[] {
  return verdict === undefined ? [] : verdict.reasons.map((reason) => reason.code);
}
