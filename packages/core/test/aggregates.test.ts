import { describe, expect, it } from 'vitest';
import type { Aggregate, EvidenceEvent, Rule } from '../src/index.js';
import { RuleSchema, evaluateAggregate, parseRule } from '../src/index.js';
import {
  AFTER_DEADLINE,
  BEFORE_DEADLINE,
  at,
  codes,
  invoicingStatus,
  orderPaid,
  single,
} from './helpers.js';

const trigger = { orderId: 'ord_1', amount: 100, currency: 'USD', parcels: 2 };
const agg = (partial: Partial<Aggregate> & Pick<Aggregate, 'fn' | 'op' | 'expected'>): Aggregate =>
  partial;

describe('evaluateAggregate', () => {
  const payloads = [
    { amount: 40.1, currency: 'USD' },
    { amount: 59.9, currency: 'USD' },
    { amount: 0.2, currency: 'EUR' },
  ];

  it.each([
    ['sum', 100.2],
    ['min', 0.2],
    ['max', 59.9],
    ['avg', 33.4],
  ] as const)('%s(amount) computes without floating-point noise', (fn, value) => {
    const out = evaluateAggregate(
      agg({ fn, field: 'amount', op: 'equals', expected: { value } }),
      payloads,
      trigger,
    );
    expect(out).toMatchObject({ status: 'pass', value });
  });

  it('count ignores field; distinctCount counts distinct values', () => {
    expect(
      evaluateAggregate(
        agg({ fn: 'count', op: 'equals', expected: { trigger: 'parcels' } }),
        payloads.slice(0, 2),
        trigger,
      ),
    ).toMatchObject({ status: 'pass', value: 2, expected: 2 });
    expect(
      evaluateAggregate(
        agg({ fn: 'distinctCount', field: 'currency', op: 'equals', expected: { value: 2 } }),
        payloads,
        trigger,
      ),
    ).toMatchObject({ status: 'pass', value: 2 });
  });

  it('compares with every operator', () => {
    const sum = (op: Aggregate['op'], expected: number): string =>
      evaluateAggregate(
        agg({ fn: 'sum', field: 'amount', op, expected: { value: expected } }),
        payloads,
        trigger,
      ).status;
    expect(sum('lte', 100.2)).toBe('pass');
    expect(sum('lt', 100.2)).toBe('fail');
    expect(sum('gte', 100.2)).toBe('pass');
    expect(sum('gt', 100.2)).toBe('fail');
    expect(sum('notEquals', 1)).toBe('pass');
  });

  it('fails on non-numeric or missing fields, naming the observation', () => {
    const out = evaluateAggregate(
      agg({ fn: 'sum', field: 'amount', op: 'lte', expected: { value: 1 } }),
      [{ amount: 1 }, { amount: '2' }],
      trigger,
    );
    expect(out.status).toBe('fail');
    expect(out.message).toContain('observation 2 of 2 has "2" at "amount", not a finite number');
    expect(
      evaluateAggregate(
        agg({ fn: 'max', field: 'amount', op: 'lte', expected: { value: 1 } }),
        [{}],
        trigger,
      ).status,
    ).toBe('fail');
  });

  it('sum over nothing is 0; min/max/avg over nothing fail', () => {
    expect(
      evaluateAggregate(
        agg({ fn: 'sum', field: 'amount', op: 'equals', expected: { value: 0 } }),
        [],
        trigger,
      ),
    ).toMatchObject({ status: 'pass', value: 0 });
    const out = evaluateAggregate(
      agg({ fn: 'min', field: 'amount', op: 'gte', expected: { value: 0 } }),
      [],
      trigger,
    );
    expect(out).toMatchObject({ status: 'fail', value: null });
    expect(out.message).toContain('no observations to aggregate');
  });

  it('is indeterminate when the trigger operand is missing, and fails ordered ops against non-numbers', () => {
    expect(
      evaluateAggregate(
        agg({ fn: 'sum', field: 'amount', op: 'lte', expected: { trigger: 'nope' } }),
        payloads,
        trigger,
      ).status,
    ).toBe('indeterminate');
    const out = evaluateAggregate(
      agg({ fn: 'sum', field: 'amount', op: 'lte', expected: { value: 'x' as unknown as number } }),
      payloads,
      trigger,
    );
    expect(out.status).toBe('fail');
    expect(out.message).toContain('is not defined against');
  });
});

describe('aggregate rule schema', () => {
  const base = {
    id: 'r',
    version: 1,
    trigger: { type: 'order.paid', correlationKey: 'orderId' },
    expectations: [
      {
        type: 'refund.issued',
        source: 'payments',
        window: { within: '1d' },
        cardinality: { min: 0, max: 5 },
      },
    ],
  };
  it('requires a field for everything but count', () => {
    const withField = {
      ...base,
      expectations: [
        {
          ...base.expectations[0],
          aggregates: [{ fn: 'sum', field: 'amount', op: 'lte', expected: { trigger: 'amount' } }],
        },
      ],
    };
    expect(RuleSchema.safeParse(withField).success).toBe(true);
    const countNoField = {
      ...base,
      expectations: [
        {
          ...base.expectations[0],
          aggregates: [{ fn: 'count', op: 'lte', expected: { value: 5 } }],
        },
      ],
    };
    expect(RuleSchema.safeParse(countNoField).success).toBe(true);
    const sumNoField = {
      ...base,
      expectations: [
        { ...base.expectations[0], aggregates: [{ fn: 'sum', op: 'lte', expected: { value: 5 } }] },
      ],
    };
    const result = RuleSchema.safeParse(sumNoField);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('field is required');
    const badFn = {
      ...base,
      expectations: [
        {
          ...base.expectations[0],
          aggregates: [{ fn: 'median', field: 'amount', op: 'lte', expected: { value: 5 } }],
        },
      ],
    };
    expect(RuleSchema.safeParse(badFn).success).toBe(false);
  });
});

describe('aggregates inside the evaluator', () => {
  const refundRule: Rule = parseRule({
    id: 'refunds-within-payment',
    version: 1,
    trigger: { type: 'order.paid', correlationKey: 'orderId' },
    expectations: [
      {
        id: 'refunds',
        type: 'refund.issued',
        source: 'invoicing',
        distinctBy: 'refundId',
        window: { within: '120s' },
        cardinality: { min: 0, max: 5 },
        assertions: [{ field: 'currency', op: 'equals', expected: { trigger: 'currency' } }],
        aggregates: [
          { fn: 'sum', field: 'amount', op: 'lte', expected: { trigger: 'amount' } },
          { fn: 'count', op: 'lte', expected: { value: 5 } },
        ],
      },
    ],
  });

  function refund(id: string, amount: number, extra: Partial<EvidenceEvent> = {}): EvidenceEvent {
    return {
      kind: 'event',
      eventId: `evt-${id}`,
      type: 'refund.issued',
      source: 'invoicing',
      occurredAt: at(10_000),
      collectedAt: at(10_500),
      payload: { refundId: id, orderId: 'ord_1', amount, currency: 'USD' },
      ...extra,
    };
  }

  it('PASS when the refunds sum to at most the payment, with aggregate values reported', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [orderPaid(), refund('r1', 20), refund('r2', 29.99), invoicingStatus()],
      refundRule,
    );
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.expectations[0]?.aggregates).toEqual([
      expect.objectContaining({
        fn: 'sum',
        field: 'amount',
        value: 49.99,
        expected: 49.99,
        status: 'pass',
      }),
      expect.objectContaining({ fn: 'count', value: 2, status: 'pass' }),
    ]);
    expect(verdict.reasons[0]?.message).toContain('2 aggregates satisfied');
  });

  it('PASS with zero refunds: sum is 0 and the obligation is vacuously met once complete', () => {
    const verdict = single(AFTER_DEADLINE, [orderPaid(), invoicingStatus()], refundRule);
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.expectations[0]?.aggregates[0]).toMatchObject({ value: 0, status: 'pass' });
  });

  it('FAIL when refunds exceed the payment, citing every refund and the trigger', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [orderPaid(), refund('r1', 30), refund('r2', 30), invoicingStatus()],
      refundRule,
    );
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['AGGREGATE_MISMATCH']);
    expect(verdict.reasons[0]?.message).toContain(
      'sum(amount) is 60 over 2 observations, expected lte 49.99',
    );
    expect(verdict.reasons[0]?.evidenceIds).toEqual(['evt-r1', 'evt-r2', 'evt-order-1']);
  });

  it('PENDING while the window is open even if the running sum already exceeds the payment', () => {
    const verdict = single(
      BEFORE_DEADLINE,
      [
        orderPaid(),
        refund('r1', 60),
        invoicingStatus({ observedAt: BEFORE_DEADLINE, completeThrough: BEFORE_DEADLINE }),
      ],
      refundRule,
    );
    expect(verdict.verdict).toBe('PENDING');
    expect(verdict.expectations[0]?.aggregates[0]?.status).toBe('not-evaluated');
  });

  it('UNKNOWN without a completeness watermark: a partial sum is not a verdict', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [orderPaid(), refund('r1', 10), invoicingStatus({ completeThrough: undefined })],
      refundRule,
    );
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['NO_COMPLETENESS_ATTESTATION']);
  });

  it('per-observation mismatches still fail early, before any aggregate runs', () => {
    const verdict = single(
      BEFORE_DEADLINE,
      [
        orderPaid(),
        refund('r1', 10, {
          payload: { refundId: 'r1', orderId: 'ord_1', amount: 10, currency: 'EUR' },
        }),
        invoicingStatus({ observedAt: BEFORE_DEADLINE, completeThrough: BEFORE_DEADLINE }),
      ],
      refundRule,
    );
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['ASSERTION_MISMATCH']);
  });

  it('aggregates run over distinct outcomes: a redelivered refund is summed once', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [
        orderPaid(),
        refund('r1', 30),
        refund('r1', 30, { eventId: 'evt-r1-again', collectedAt: at(11_000) }),
        invoicingStatus(),
      ],
      refundRule,
    );
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.expectations[0]?.aggregates[0]).toMatchObject({ value: 30 });
  });

  it('UNKNOWN when the trigger lacks the aggregate operand', () => {
    const verdict = single(
      AFTER_DEADLINE,
      [
        orderPaid({ payload: { orderId: 'ord_1', currency: 'USD' } }),
        refund('r1', 1),
        invoicingStatus(),
      ],
      refundRule,
    );
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['CORRELATION_VALUE_MISSING']);
  });

  it('an unbounded expectation with aggregates still waits for completeness instead of passing early', () => {
    const rule = parseRule({
      ...refundRule,
      expectations: [{ ...refundRule.expectations[0], cardinality: 'at-least-one' }],
    });
    const verdict = single(
      BEFORE_DEADLINE,
      [
        orderPaid(),
        refund('r1', 1),
        invoicingStatus({ observedAt: BEFORE_DEADLINE, completeThrough: BEFORE_DEADLINE }),
      ],
      rule,
    );
    expect(verdict.verdict).toBe('PENDING');
  });
});
