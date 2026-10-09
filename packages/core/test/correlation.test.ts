import { describe, expect, it } from 'vitest';
import type { EvidenceEvent, Rule } from '../src/index.js';
import { EvidenceSet, FixedClock, RuleSchema, evaluateRules, parseRule } from '../src/index.js';
import {
  AFTER_DEADLINE,
  BEFORE_DEADLINE,
  at,
  codes,
  invoiceCreated,
  invoicingStatus,
  orderPaid,
  single,
} from './helpers.js';

/** order.paid -> invoice.created (orderId -> invoiceId) -> ledger.posted (invoiceId), exactly one posting per invoice. */
const chainRule: Rule = parseRule({
  id: 'ledger-posting-per-invoice',
  version: 1,
  trigger: { type: ['order.paid', 'order.reinvoiced'], correlationKey: 'orderId' },
  expectations: [
    {
      id: 'posting',
      type: 'ledger.posted',
      source: 'ledger',
      distinctBy: 'postingId',
      correlation: {
        via: [{ type: 'invoice.created', source: 'invoicing', from: 'orderId', to: 'invoiceId' }],
        observation: 'invoiceId',
      },
      window: { within: '120s', before: '5s' },
      cardinality: 'exactly-one',
      assertions: [{ field: 'amount', op: 'equals', expected: { trigger: 'amount' } }],
    },
  ],
});

function posted(id: string, invoiceId: string, extra: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    kind: 'event',
    eventId: `evt-${id}`,
    type: 'ledger.posted',
    source: 'ledger',
    occurredAt: at(8_000),
    collectedAt: at(8_500),
    payload: { postingId: id, invoiceId, amount: 49.99, currency: 'USD' },
    ...extra,
  };
}
const ledgerStatus = (overrides: Partial<ReturnType<typeof invoicingStatus>> = {}) => ({
  ...invoicingStatus(),
  source: 'ledger',
  ...overrides,
});

describe('correlation chains', () => {
  it('PASS: the posting is found through the invoice, keys and hops are reported', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [orderPaid(), invoiceCreated(), posted('p1', 'inv_1'), invoicingStatus(), ledgerStatus()],
      chainRule,
    );
    expect(verdict.verdict).toBe('PASS');
    expect(codes(verdict)).toEqual(['CORRELATION_HOP', 'OUTCOME_CONFIRMED']);
    expect(verdict.expectations[0]?.correlation).toEqual({
      triggerPath: 'orderId',
      observationPath: 'invoiceId',
      keys: ['"inv_1"'],
      hops: [
        expect.objectContaining({
          type: 'invoice.created',
          source: 'invoicing',
          matched: 1,
          keys: ['"inv_1"'],
          evidenceIds: ['evt-inv-1'],
        }),
      ],
    });
    expect(verdict.reasons[0]?.message).toContain(
      'hop invoice.created from "invoicing": 1 event matched 1 key via "orderId", yielding 1 key via "invoiceId"',
    );
  });

  it('FAIL: the invoice exists but no posting references it', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [orderPaid(), invoiceCreated(), invoicingStatus(), ledgerStatus()],
      chainRule,
    );
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['CORRELATION_HOP', 'MISSING_EXPECTED_OUTCOME']);
  });

  it('FAIL: no invoice at all means no keys and therefore a missing posting, with the hop reporting 0 matches', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [orderPaid(), posted('p1', 'inv_1'), invoicingStatus(), ledgerStatus()],
      chainRule,
    );
    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.expectations[0]?.correlation.hops[0]).toMatchObject({ matched: 0, keys: [] });
    expect(verdict.expectations[0]?.observations).toHaveLength(0);
  });

  it('FAIL: two invoices for the order, each posted once, is two postings against exactly-one', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [
        orderPaid(),
        invoiceCreated({
          eventId: 'a',
          payload: { invoiceId: 'inv_1', orderId: 'ord_1', amount: 49.99, currency: 'USD' },
        }),
        invoiceCreated({
          eventId: 'b',
          payload: { invoiceId: 'inv_2', orderId: 'ord_1', amount: 49.99, currency: 'USD' },
        }),
        posted('p1', 'inv_1'),
        posted('p2', 'inv_2'),
        invoicingStatus(),
        ledgerStatus(),
      ],
      chainRule,
    );
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toContain('DUPLICATE_OUTCOME');
    expect(verdict.expectations[0]?.correlation.keys).toEqual(['"inv_1"', '"inv_2"']);
  });

  it('postings for other invoices are ignored', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [
        orderPaid(),
        invoiceCreated(),
        posted('p1', 'inv_1'),
        posted('p9', 'inv_9'),
        invoicingStatus(),
        ledgerStatus(),
      ],
      chainRule,
    );
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.expectations[0]?.observations.map((o) => o.eventId)).toEqual(['evt-p1']);
  });

  it('UNKNOWN when the hop source is unavailable, even if a posting is visible', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [
        orderPaid(),
        invoiceCreated(),
        posted('p1', 'inv_1'),
        invoicingStatus({ status: 'unavailable', completeThrough: undefined }),
        ledgerStatus(),
      ],
      chainRule,
    );
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['CORRELATION_HOP', 'SOURCE_UNAVAILABLE']);
    expect(verdict.reasons[1]?.message).toContain(
      'hop invoice.created source "invoicing" was unavailable',
    );
  });

  it('PENDING when the hop source lags behind the deadline: a missing invoice is not yet a missing posting', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [orderPaid(), invoicingStatus({ completeThrough: at(60_000) }), ledgerStatus()],
      chainRule,
    );
    expect(verdict.verdict).toBe('PENDING');
    expect(codes(verdict)).toEqual(['CORRELATION_HOP', 'SOURCE_INCOMPLETE']);
    expect(verdict.reasons[1]?.message).toContain(
      'hop invoice.created source "invoicing" is complete only through',
    );
  });

  it('UNKNOWN when the hop source has no watermark, even with the posting present', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [
        orderPaid(),
        invoiceCreated(),
        posted('p1', 'inv_1'),
        invoicingStatus({ completeThrough: undefined }),
        ledgerStatus(),
      ],
      chainRule,
    );
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['CORRELATION_HOP', 'NO_COMPLETENESS_ATTESTATION']);
  });

  it('PENDING before the deadline regardless of the chain', () => {
    const verdict = single(
      BEFORE_DEADLINE,
      [
        orderPaid(),
        invoiceCreated(),
        posted('p1', 'inv_1'),
        invoicingStatus({ observedAt: BEFORE_DEADLINE, completeThrough: BEFORE_DEADLINE }),
        ledgerStatus({ observedAt: BEFORE_DEADLINE, completeThrough: BEFORE_DEADLINE }),
      ],
      chainRule,
    );
    expect(verdict.verdict).toBe('PENDING');
  });

  it('hop events outside the window do not contribute keys', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [
        orderPaid(),
        invoiceCreated({ occurredAt: at(130_000) }),
        posted('p1', 'inv_1'),
        invoicingStatus(),
        ledgerStatus(),
      ],
      chainRule,
    );
    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.expectations[0]?.correlation.hops[0]?.matched).toBe(0);
  });

  it('assertions still compare the final observation with the trigger', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [
        orderPaid(),
        invoiceCreated(),
        posted('p1', 'inv_1', {
          payload: { postingId: 'p1', invoiceId: 'inv_1', amount: 1, currency: 'USD' },
        }),
        invoicingStatus(),
        ledgerStatus(),
      ],
      chainRule,
    );
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toContain('ASSERTION_MISMATCH');
  });

  it('two hops chain through an intermediate key', () => {
    const rule = parseRule({
      ...chainRule,
      expectations: [
        {
          ...chainRule.expectations[0],
          type: 'bank.settled',
          source: 'bank',
          distinctBy: 'settlementId',
          correlation: {
            via: [
              { type: 'invoice.created', source: 'invoicing', from: 'orderId', to: 'invoiceId' },
              { type: 'ledger.posted', source: 'ledger', from: 'invoiceId', to: 'postingId' },
            ],
            observation: 'postingId',
          },
          assertions: [],
        },
      ],
    });
    const settled: EvidenceEvent = {
      kind: 'event',
      eventId: 'evt-s1',
      type: 'bank.settled',
      source: 'bank',
      occurredAt: at(9_000),
      collectedAt: at(9_500),
      payload: { settlementId: 's1', postingId: 'p1' },
    };
    const bankStatus = { ...invoicingStatus(), source: 'bank' };
    const verdict = single(
      AFTER_DEADLINE,
      [
        orderPaid(),
        invoiceCreated(),
        posted('p1', 'inv_1'),
        settled,
        invoicingStatus(),
        ledgerStatus(),
        bankStatus,
      ],
      rule,
    );
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.expectations[0]?.correlation.hops.map((h) => h.keys)).toEqual([
      ['"inv_1"'],
      ['"p1"'],
    ]);
  });
});

describe('alternative trigger types', () => {
  it('evaluates every listed trigger type, ordered by occurrence', () => {
    const reinvoiced = orderPaid({
      eventId: 'evt-reinv',
      occurredAt: at(1_000),
      payload: { orderId: 'ord_2', amount: 10, currency: 'USD' },
    });
    const records = [
      orderPaid(),
      { ...reinvoiced, type: 'order.reinvoiced' },
      invoiceCreated(),
      posted('p1', 'inv_1'),
      invoicingStatus(),
      ledgerStatus(),
    ];
    const verdicts = evaluateRules([chainRule], EvidenceSet.from(records), {
      clock: new FixedClock(AFTER_DEADLINE),
    });
    expect(verdicts.map((v) => [v.trigger.type, v.correlationValue, v.verdict])).toEqual([
      ['order.paid', '"ord_1"', 'PASS'],
      ['order.reinvoiced', '"ord_2"', 'FAIL'],
    ]);
  });

  it('rejects an empty type list and both correlationKey and correlation.observation', () => {
    expect(
      RuleSchema.safeParse({ ...chainRule, trigger: { ...chainRule.trigger, type: [] } }).success,
    ).toBe(false);
    const both = {
      ...chainRule,
      expectations: [{ ...chainRule.expectations[0], correlationKey: 'x' }],
    };
    const result = RuleSchema.safeParse(both);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('not both');
  });
});
