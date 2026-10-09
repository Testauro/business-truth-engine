import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock } from '@bte/core';
import { readAllEvidence } from '@bte/evidence';
import { DELAYED_INVOICE_MS, runScenario, type Fault } from '../src/index.js';
import {
  START,
  checkoutViaUi,
  codes,
  evaluateRecords,
  startDemo,
  type Harness,
} from './helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.demo.app.close();
  h = undefined;
});

interface Expectation {
  faults: Fault[];
  verdict: 'PASS' | 'FAIL' | 'PENDING' | 'UNKNOWN';
  reasons: string[];
}

/**
 * The matrix the whole project exists for: the checkout UI confirms success in
 * every row, and only the evidence-based verdict tells them apart.
 */
const MATRIX: Expectation[] = [
  { faults: [], verdict: 'PASS', reasons: ['OUTCOME_CONFIRMED'] },
  { faults: ['missing-invoice'], verdict: 'FAIL', reasons: ['MISSING_EXPECTED_OUTCOME'] },
  { faults: ['duplicate-invoice'], verdict: 'FAIL', reasons: ['DUPLICATE_OUTCOME'] },
  { faults: ['wrong-amount'], verdict: 'FAIL', reasons: ['ASSERTION_MISMATCH'] },
  { faults: ['invoicing-unavailable'], verdict: 'UNKNOWN', reasons: ['SOURCE_UNAVAILABLE'] },
  {
    faults: ['delayed-invoice'],
    verdict: 'FAIL',
    reasons: ['LATE_OUTCOME', 'MISSING_EXPECTED_OUTCOME'],
  },
  { faults: ['duplicate-delivery'], verdict: 'PASS', reasons: ['OUTCOME_CONFIRMED'] },
  {
    faults: ['wrong-amount', 'duplicate-invoice'],
    verdict: 'FAIL',
    reasons: ['ASSERTION_MISMATCH', 'ASSERTION_MISMATCH', 'DUPLICATE_OUTCOME'],
  },
];

/** The scenario collects twice, so every event is a redelivery; that is noise here, asserted once below. */
function significant(verdictCodes: string[]): string[] {
  return verdictCodes.filter((code) => code !== 'REDELIVERY_DEDUPLICATED');
}

describe('seeded faults vs. the invoice-created-once invariant (scenario runner)', () => {
  it.each(MATRIX.map((row) => [row.faults.join('+') || 'none', row] as const))(
    'faults=%s',
    async (_label, row) => {
      const clock = new ManualClock(START);
      const result = await runScenario({ clock, faults: row.faults });
      expect(result.uiConfirmed).toBe(true);
      expect(result.total).toBe(50.97);

      const verdicts = await evaluateRecords(result.collector.records, clock.now());
      expect(verdicts).toHaveLength(1);
      const verdict = verdicts[0];
      expect(verdict?.verdict).toBe(row.verdict);
      expect(significant(codes(verdict))).toEqual(row.reasons);
      expect(codes(verdict)).toContain('REDELIVERY_DEDUPLICATED');
      expect(verdict?.trigger.deliveries).toBe(row.faults.includes('duplicate-delivery') ? 4 : 2);
      expect(verdict?.correlationValue).toBe(`"${result.orderId}"`);
      expect(verdict?.trigger.eventId).toBe(`order.paid:${result.orderId}:${result.paymentId}`);
    },
  );

  it('wrong-amount explains exactly which value disagreed and cites both events', async () => {
    const clock = new ManualClock(START);
    const result = await runScenario({ clock, faults: ['wrong-amount'] });
    const [verdict] = await evaluateRecords(result.collector.records, clock.now());
    const mismatch = verdict?.reasons.find((r) => r.code === 'ASSERTION_MISMATCH');
    expect(mismatch?.message).toContain('"amount" is 24.99, expected equals 50.97');
    expect(mismatch?.evidenceIds).toEqual([
      `invoice.created:inv_0001`,
      `order.paid:${result.orderId}:${result.paymentId}`,
    ]);
  });

  it('wrong-amount on a single-line order with shipping: the gap is the shipping', async () => {
    h = await startDemo(['wrong-amount']);
    const response = await h.demo.app.inject({
      method: 'POST',
      url: '/checkout',
      payload: { customerId: 'cus_demo', cardNumber: '4242424242424242', 'qty_BTE-TEE': '1' },
    });
    expect(response.statusCode).toBe(303);
    h.clock.advance(121_000);
    h.demo.collector.collect();
    const [verdict] = await evaluateRecords(h.demo.collector.records, h.clock.now());
    expect(verdict?.verdict).toBe('FAIL');
    const mismatch = verdict?.reasons.find((r) => r.code === 'ASSERTION_MISMATCH');
    expect(mismatch?.message).toContain('"amount" is 24.99, expected equals 29.98');
    expect(mismatch?.evidenceIds).toEqual([
      'invoice.created:inv_0001',
      'order.paid:ord_0001:pay_0001',
    ]);
  });
});

describe('timeline honesty', () => {
  it('right after checkout the obligation is PENDING, not PASS, even on the happy path', async () => {
    h = await startDemo();
    await checkoutViaUi(h);
    h.clock.advance(5_000);
    h.demo.collector.collect();
    const [verdict] = await evaluateRecords(h.demo.collector.records, h.clock.now());
    expect(verdict?.verdict).toBe('PENDING');
    expect(codes(verdict)).toEqual(['WINDOW_OPEN']);
    expect(verdict?.expectations[0]?.distinctInWindow).toBe(1);
  });

  it('a missing invoice is PENDING before the deadline and FAIL only after a complete collection', async () => {
    h = await startDemo(['missing-invoice']);
    await checkoutViaUi(h);
    h.clock.advance(60_000);
    h.demo.collector.collect();
    const [early] = await evaluateRecords(h.demo.collector.records, h.clock.now());
    expect(early?.verdict).toBe('PENDING');

    // Deadline passed but the last collection was at +60s: source watermark lags.
    h.clock.advance(70_000);
    const [lagging] = await evaluateRecords(h.demo.collector.records, h.clock.now());
    expect(lagging?.verdict).toBe('PENDING');
    expect(codes(lagging)).toEqual(['SOURCE_INCOMPLETE']);

    h.demo.collector.collect();
    const [late] = await evaluateRecords(h.demo.collector.records, h.clock.now());
    expect(late?.verdict).toBe('FAIL');
    expect(codes(late)).toContain('MISSING_EXPECTED_OUTCOME');
  });

  it('a delayed invoice is PENDING while absent, then FAIL as late once it materialises', async () => {
    h = await startDemo(['delayed-invoice']);
    await checkoutViaUi(h);
    h.clock.advance(60_000);
    h.demo.invoicing.tick();
    expect(h.demo.invoicing.list()).toHaveLength(0);
    h.demo.collector.collect();
    const [pending] = await evaluateRecords(h.demo.collector.records, h.clock.now());
    expect(pending?.verdict).toBe('PENDING');

    h.clock.advance(DELAYED_INVOICE_MS);
    h.demo.invoicing.tick();
    expect(h.demo.invoicing.list()).toHaveLength(1);
    h.demo.collector.collect();
    const [failed] = await evaluateRecords(h.demo.collector.records, h.clock.now());
    expect(failed?.verdict).toBe('FAIL');
    expect(codes(failed)).toContain('LATE_OUTCOME');
    expect(failed?.expectations[0]?.observations[0]?.placement).toBe('late');
  });

  it('an unavailable invoicing system that recovers turns UNKNOWN into a real verdict', async () => {
    h = await startDemo(['invoicing-unavailable']);
    await checkoutViaUi(h);
    h.clock.advance(121_000);
    h.demo.collector.collect();
    const [unknown] = await evaluateRecords(h.demo.collector.records, h.clock.now());
    expect(unknown?.verdict).toBe('UNKNOWN');

    h.demo.faults.set([]);
    h.clock.advance(1_000);
    h.demo.collector.collect();
    const [recovered] = await evaluateRecords(h.demo.collector.records, h.clock.now());
    expect(recovered?.verdict).toBe('PASS');
  });

  it('faults toggled through the admin API change only the invoicing outcome, never the checkout', async () => {
    h = await startDemo();
    await h.demo.app.inject({
      method: 'PUT',
      url: '/admin/faults',
      payload: { faults: ['duplicate-invoice'] },
    });
    const { page } = await checkoutViaUi(h);
    expect(page).toContain('Payment received');
    h.clock.advance(121_000);
    await h.demo.app.inject({ method: 'POST', url: '/evidence/collect' });
    const [verdict] = await evaluateRecords(h.demo.collector.records, h.clock.now());
    expect(verdict?.verdict).toBe('FAIL');
    expect(codes(verdict)).toContain('DUPLICATE_OUTCOME');
  });
});

describe('evidence file round trip', () => {
  it('the NDJSON the demo writes evaluates identically to the in-memory records', async () => {
    const clock = new ManualClock(START);
    const result = await runScenario({ clock, faults: ['duplicate-invoice'] });
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-demo-'));
    const file = path.join(dir, 'evidence.ndjson');
    const written = await result.collector.writeTo(file);
    expect(written).toBe(result.collector.records.length);
    const fromFile = await readAllEvidence([file]);
    expect(fromFile).toEqual(result.collector.records);
    const [memory] = await evaluateRecords(result.collector.records, clock.now());
    const [disk] = await evaluateRecords(fromFile, clock.now());
    expect(disk).toEqual(memory);
    expect(disk?.verdict).toBe('FAIL');
  });
});
