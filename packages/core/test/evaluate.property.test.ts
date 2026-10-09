import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EvidenceEvent, EvidenceRecord, SourceStatus } from '../src/index.js';
import { EvidenceSet, FixedClock, evaluateRule } from '../src/index.js';
import { AFTER_DEADLINE, T0_MS, invoiceRule, invoicingStatus, orderPaid } from './helpers.js';

const isoOffset = (ms: number): string => new Date(T0_MS + ms).toISOString();

const invoiceArb = fc.record({
  eventId: fc.constantFrom('a', 'b', 'c', 'd'),
  invoiceId: fc.constantFrom('inv_1', 'inv_2', 'inv_3'),
  occurredOffset: fc.integer({ min: -10_000, max: 200_000 }),
  collectedOffset: fc.integer({ min: 0, max: 250_000 }),
  amount: fc.constantFrom(49.99, 4.99),
  currency: fc.constantFrom('USD', 'EUR'),
  orderId: fc.constantFrom('ord_1', 'ord_2'),
});

const statusArb: fc.Arbitrary<SourceStatus> = fc
  .record({
    status: fc.constantFrom('available', 'unavailable'),
    authoritative: fc.boolean(),
    completeOffset: fc.option(fc.integer({ min: 0, max: 300_000 }), { nil: undefined }),
  })
  .map(({ status, authoritative, completeOffset }) =>
    invoicingStatus({
      status,
      authoritative,
      completeThrough: completeOffset === undefined ? undefined : isoOffset(completeOffset),
    }),
  );

const recordsArb: fc.Arbitrary<EvidenceRecord[]> = fc
  .tuple(fc.array(invoiceArb, { maxLength: 6 }), fc.option(statusArb, { nil: undefined }))
  .map(([invoices, status]) => {
    const records: EvidenceRecord[] = [orderPaid()];
    for (const invoice of invoices) {
      records.push({
        kind: 'event',
        eventId: invoice.eventId,
        type: 'invoice.created',
        source: 'invoicing',
        occurredAt: isoOffset(invoice.occurredOffset),
        collectedAt: isoOffset(invoice.collectedOffset),
        payload: {
          invoiceId: invoice.invoiceId,
          orderId: invoice.orderId,
          amount: invoice.amount,
          currency: invoice.currency,
        },
      });
    }
    if (status !== undefined) records.push(status);
    return records;
  });

const nowArb = fc.integer({ min: -1_000, max: 400_000 }).map(isoOffset);

function run(records: readonly EvidenceRecord[], now: string) {
  return evaluateRule(invoiceRule, EvidenceSet.from(records), { clock: new FixedClock(now) });
}

describe('evaluator properties', () => {
  it('is invariant under permutation of the evidence', () => {
    fc.assert(
      fc.property(recordsArb, nowArb, fc.infiniteStream(fc.nat()), (records, now, seeds) => {
        const shuffled = [...records];
        const iterator = seeds[Symbol.iterator]();
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = (iterator.next().value as number) % (i + 1);
          const a = shuffled[i];
          const b = shuffled[j];
          if (a !== undefined && b !== undefined) {
            shuffled[i] = b;
            shuffled[j] = a;
          }
        }
        expect(run(shuffled, now)).toEqual(run(records, now));
      }),
    );
  });

  it('is invariant under exact redelivery of any event', () => {
    fc.assert(
      fc.property(recordsArb, nowArb, fc.nat(), (records, now, pick) => {
        const events = records.filter((r): r is EvidenceEvent => r.kind === 'event');
        const chosen = events[pick % events.length];
        if (chosen === undefined) return;
        const redelivered: EvidenceRecord = {
          ...chosen,
          collectedAt: isoOffset(999_999),
          deliveryId: 'retry',
        };
        const baseline = run(records, now);
        const withRetry = run([...records, redelivered], now);
        expect(withRetry.map((v) => v.verdict)).toEqual(baseline.map((v) => v.verdict));
        expect(withRetry.map((v) => v.expectations[0]?.distinctInWindow)).toEqual(
          baseline.map((v) => v.expectations[0]?.distinctInWindow),
        );
      }),
    );
  });

  it('never returns PASS or FAIL without an available, authoritative source', () => {
    fc.assert(
      fc.property(recordsArb, nowArb, (records, now) => {
        const status = EvidenceSet.from(records).sourceStatus('invoicing');
        const trusted = status?.status === 'available' && status.authoritative;
        for (const verdict of run(records, now)) {
          if (!trusted) expect(['PENDING', 'UNKNOWN']).toContain(verdict.verdict);
          if (verdict.verdict === 'PASS') expect(trusted).toBe(true);
          if (verdict.verdict === 'FAIL') expect(trusted).toBe(true);
        }
      }),
    );
  });

  it('never returns PASS for a bounded expectation unless the window is closed and the source is complete past the deadline', () => {
    fc.assert(
      fc.property(recordsArb, nowArb, (records, now) => {
        for (const verdict of run(records, now)) {
          for (const expectation of verdict.expectations) {
            if (expectation.verdict !== 'PASS') continue;
            expect(Date.parse(now)).toBeGreaterThanOrEqual(Date.parse(expectation.deadline));
            expect(expectation.source.completeThroughDeadline).toBe(true);
            expect(expectation.distinctInWindow).toBe(1);
          }
        }
      }),
    );
  });

  it('every verdict carries at least one reason that references evidence or the window', () => {
    fc.assert(
      fc.property(recordsArb, nowArb, (records, now) => {
        for (const verdict of run(records, now)) {
          expect(verdict.reasons.length).toBeGreaterThan(0);
          expect(verdict.ruleId).toBe('invoice-created-once');
        }
      }),
    );
  });

  it('a PASS at the post-deadline instant stays PASS for any later instant with the same evidence', () => {
    fc.assert(
      fc.property(recordsArb, fc.integer({ min: 0, max: 10_000_000 }), (records, extra) => {
        const base = run(records, AFTER_DEADLINE);
        const later = run(records, new Date(Date.parse(AFTER_DEADLINE) + extra).toISOString());
        base.forEach((verdict, index) => {
          if (verdict.verdict === 'PASS' || verdict.verdict === 'FAIL') {
            expect(later[index]?.verdict).toBe(verdict.verdict);
          }
        });
      }),
    );
  });
});
