import { describe, expect, it } from 'vitest';
import { EvidenceSet, FixedClock, evaluateRules, evaluateTrigger } from '../src/index.js';
import {
  AFTER_DEADLINE,
  BEFORE_DEADLINE,
  DEADLINE_MS,
  T0_MS,
  at,
  codes,
  evaluateAt,
  invoiceCreated,
  invoiceRule,
  invoicingStatus,
  orderPaid,
  ruleWith,
  single,
} from './helpers.js';

describe('invoice-created-once: verdicts', () => {
  it('PASS: exactly one matching invoice, authoritative source complete past the deadline', () => {
    const verdict = single(AFTER_DEADLINE, [orderPaid(), invoiceCreated(), invoicingStatus()]);
    expect(verdict.verdict).toBe('PASS');
    expect(codes(verdict)).toEqual(['OUTCOME_CONFIRMED']);
    const [expectation] = verdict.expectations;
    expect(expectation?.distinctInWindow).toBe(1);
    expect(expectation?.source.completeThroughDeadline).toBe(true);
    expect(verdict.reasons[0]?.evidenceIds).toEqual(
      expect.arrayContaining(['evt-order-1', 'evt-inv-1', `source:invoicing@${AFTER_DEADLINE}`]),
    );
  });

  it('FAIL: no invoice after the deadline when the source is complete', () => {
    const verdict = single(AFTER_DEADLINE, [orderPaid(), invoicingStatus()]);
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['MISSING_EXPECTED_OUTCOME']);
  });

  it('FAIL: two distinct invoices for one order', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({
        eventId: 'evt-inv-1',
        payload: { invoiceId: 'inv_1', orderId: 'ord_1', amount: 49.99, currency: 'USD' },
      }),
      invoiceCreated({
        eventId: 'evt-inv-2',
        payload: { invoiceId: 'inv_2', orderId: 'ord_1', amount: 49.99, currency: 'USD' },
      }),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['DUPLICATE_OUTCOME']);
    expect(verdict.reasons[0]?.evidenceIds).toEqual(['evt-inv-1', 'evt-inv-2']);
  });

  it('FAIL: duplicates are confirmed even while the window is still open', () => {
    const verdict = single(BEFORE_DEADLINE, [
      orderPaid(),
      invoiceCreated({
        eventId: 'a',
        payload: { invoiceId: 'inv_1', orderId: 'ord_1', amount: 49.99, currency: 'USD' },
      }),
      invoiceCreated({
        eventId: 'b',
        payload: { invoiceId: 'inv_2', orderId: 'ord_1', amount: 49.99, currency: 'USD' },
      }),
      invoicingStatus({ observedAt: BEFORE_DEADLINE, completeThrough: BEFORE_DEADLINE }),
    ]);
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toContain('DUPLICATE_OUTCOME');
  });

  it('FAIL: wrong amount', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({
        payload: { invoiceId: 'inv_1', orderId: 'ord_1', amount: 4.99, currency: 'USD' },
      }),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['ASSERTION_MISMATCH']);
    expect(verdict.reasons[0]?.message).toContain('"amount" is 4.99, expected equals 49.99');
    expect(verdict.reasons[0]?.evidenceIds).toEqual(['evt-inv-1', 'evt-order-1']);
  });

  it('FAIL: wrong currency, even before the deadline', () => {
    const verdict = single(BEFORE_DEADLINE, [
      orderPaid(),
      invoiceCreated({
        payload: { invoiceId: 'inv_1', orderId: 'ord_1', amount: 49.99, currency: 'EUR' },
      }),
      invoicingStatus({ observedAt: BEFORE_DEADLINE, completeThrough: BEFORE_DEADLINE }),
    ]);
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['ASSERTION_MISMATCH']);
  });

  it('FAIL: a mismatched invoice is not rescued by a second, correct one', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({
        eventId: 'bad',
        payload: { invoiceId: 'inv_1', orderId: 'ord_1', amount: 1, currency: 'USD' },
      }),
      invoiceCreated({
        eventId: 'good',
        payload: { invoiceId: 'inv_2', orderId: 'ord_1', amount: 49.99, currency: 'USD' },
      }),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['ASSERTION_MISMATCH', 'DUPLICATE_OUTCOME']);
  });

  it('PENDING: before the deadline with nothing observed', () => {
    const verdict = single(BEFORE_DEADLINE, [
      orderPaid(),
      invoicingStatus({ observedAt: BEFORE_DEADLINE, completeThrough: BEFORE_DEADLINE }),
    ]);
    expect(verdict.verdict).toBe('PENDING');
    expect(codes(verdict)).toEqual(['WINDOW_OPEN']);
  });

  it('PENDING: before the deadline with one good invoice (a duplicate could still arrive)', () => {
    const verdict = single(BEFORE_DEADLINE, [
      orderPaid(),
      invoiceCreated(),
      invoicingStatus({ observedAt: BEFORE_DEADLINE, completeThrough: BEFORE_DEADLINE }),
    ]);
    expect(verdict.verdict).toBe('PENDING');
    expect(codes(verdict)).toEqual(['WINDOW_OPEN']);
  });

  it('PASS early: an at-least-one expectation resolves as soon as an authoritative observation exists', () => {
    const rule = ruleWith({ cardinality: 'at-least-one' });
    const verdict = single(
      BEFORE_DEADLINE,
      [
        orderPaid(),
        invoiceCreated(),
        invoicingStatus({ observedAt: BEFORE_DEADLINE, completeThrough: BEFORE_DEADLINE }),
      ],
      rule,
    );
    expect(verdict.verdict).toBe('PASS');
  });

  it('PENDING: after the deadline, healthy source whose watermark lags behind the deadline', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoicingStatus({ completeThrough: at(90_000) }),
    ]);
    expect(verdict.verdict).toBe('PENDING');
    expect(codes(verdict)).toEqual(['SOURCE_INCOMPLETE']);
  });

  it('UNKNOWN: source unavailable, even though no error was observed', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoicingStatus({ status: 'unavailable', completeThrough: undefined }),
    ]);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['SOURCE_UNAVAILABLE']);
  });

  it('UNKNOWN: source unavailable before the deadline notes the open window but is still UNKNOWN', () => {
    const verdict = single(BEFORE_DEADLINE, [
      orderPaid(),
      invoicingStatus({
        observedAt: BEFORE_DEADLINE,
        status: 'unavailable',
        completeThrough: undefined,
      }),
    ]);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['SOURCE_UNAVAILABLE', 'WINDOW_OPEN']);
  });

  it('UNKNOWN: no attestation at all for the source, even with a matching invoice', () => {
    const verdict = single(AFTER_DEADLINE, [orderPaid(), invoiceCreated()]);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['SOURCE_STATUS_MISSING']);
    expect(verdict.expectations[0]?.source.status).toBe('missing');
  });

  it('UNKNOWN: non-authoritative source cannot confirm anything', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated(),
      invoicingStatus({ authoritative: false }),
    ]);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['SOURCE_NOT_AUTHORITATIVE']);
  });

  it('UNKNOWN: available source without a completeness watermark cannot prove absence', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated(),
      invoicingStatus({ completeThrough: undefined }),
    ]);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['NO_COMPLETENESS_ATTESTATION']);
  });

  it('UNKNOWN: conflicting redeliveries of the same event', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({ deliveryId: 'd-1' }),
      invoiceCreated({
        deliveryId: 'd-2',
        collectedAt: at(8_000),
        payload: {
          invoiceId: 'inv_1',
          orderId: 'ord_1',
          amount: 49.99,
          currency: 'USD',
          extra: true,
        },
      }),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['REDELIVERY_DEDUPLICATED', 'CONFLICTING_REDELIVERY']);
  });

  it('UNKNOWN: the trigger lacks a value the assertion needs', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid({ payload: { orderId: 'ord_1', currency: 'USD' } }),
      invoiceCreated(),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['CORRELATION_VALUE_MISSING']);
  });

  it('UNKNOWN: the trigger has no correlation value', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid({ payload: { amount: 1, currency: 'USD' } }),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)).toEqual(['CORRELATION_VALUE_MISSING']);
    expect(verdict.correlationValue).toBe('');
  });
});

describe('deduplication and ordering', () => {
  it('PASS: the same invoice delivered twice counts once', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({ deliveryId: 'd-1' }),
      invoiceCreated({ deliveryId: 'd-2', collectedAt: at(9_000) }),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('PASS');
    expect(codes(verdict)).toEqual(['REDELIVERY_DEDUPLICATED', 'OUTCOME_CONFIRMED']);
    expect(verdict.expectations[0]?.observations[0]?.deliveries).toBe(2);
  });

  it('a redelivered trigger is evaluated once', () => {
    const verdicts = evaluateAt(AFTER_DEADLINE, [
      orderPaid({ deliveryId: 'a' }),
      orderPaid({ deliveryId: 'b', collectedAt: at(400) }),
      invoiceCreated(),
      invoicingStatus(),
    ]);
    expect(verdicts).toHaveLength(1);
    const first = verdicts[0];
    if (first === undefined) throw new Error('unreachable');
    expect(first.trigger.deliveries).toBe(2);
    expect(codes(first)).toContain('REDELIVERY_DEDUPLICATED');
  });

  it('two distinct event ids sharing one invoiceId count as one outcome', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({ eventId: 'a' }),
      invoiceCreated({ eventId: 'b', occurredAt: at(6_000) }),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.expectations[0]?.distinctInWindow).toBe(1);
  });

  it('without distinctBy, distinct event ids are distinct outcomes', () => {
    const rule = ruleWith({ distinctBy: undefined });
    const verdict = single(
      AFTER_DEADLINE,
      [
        orderPaid(),
        invoiceCreated({ eventId: 'a' }),
        invoiceCreated({ eventId: 'b' }),
        invoicingStatus(),
      ],
      rule,
    );
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['DUPLICATE_OUTCOME']);
  });

  it('the verdict does not depend on evidence order', () => {
    const records = [orderPaid(), invoiceCreated(), invoicingStatus()];
    const forward = single(AFTER_DEADLINE, records);
    const reversed = single(AFTER_DEADLINE, [...records].reverse());
    expect(reversed).toEqual(forward);
  });

  it('an invoice collected before the order was collected still correlates (out-of-order collection)', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid({ collectedAt: at(30_000) }),
      invoiceCreated({ collectedAt: at(5_300) }),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('PASS');
  });

  it('ignores observations from other sources and other orders', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({ eventId: 'cache', source: 'invoicing-cache' }),
      invoiceCreated({
        eventId: 'other',
        payload: { invoiceId: 'x', orderId: 'ord_9', amount: 1, currency: 'USD' },
      }),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['MISSING_EXPECTED_OUTCOME']);
    expect(verdict.expectations[0]?.observations).toHaveLength(0);
  });
});

describe('time boundaries', () => {
  const complete = invoicingStatus();

  it('occurredAt exactly at the deadline is in the window', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({ occurredAt: new Date(DEADLINE_MS).toISOString() }),
      complete,
    ]);
    expect(verdict.verdict).toBe('PASS');
  });

  it('occurredAt one millisecond after the deadline is late -> FAIL', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({ occurredAt: new Date(DEADLINE_MS + 1).toISOString() }),
      complete,
    ]);
    expect(verdict.verdict).toBe('FAIL');
    expect(codes(verdict)).toEqual(['LATE_OUTCOME', 'MISSING_EXPECTED_OUTCOME']);
    expect(verdict.expectations[0]?.observations[0]?.placement).toBe('late');
  });

  it('occurredAt within the before-tolerance is in the window; beyond it is early and not counted', () => {
    const inside = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({ occurredAt: at(-5_000) }),
      complete,
    ]);
    expect(inside.verdict).toBe('PASS');
    const outside = single(AFTER_DEADLINE, [
      orderPaid(),
      invoiceCreated({ occurredAt: at(-5_001) }),
      complete,
    ]);
    expect(outside.verdict).toBe('FAIL');
    expect(codes(outside)).toEqual(['EARLY_OUTCOME', 'MISSING_EXPECTED_OUTCOME']);
  });

  it('now exactly at the deadline closes the window', () => {
    const atDeadline = new Date(DEADLINE_MS).toISOString();
    const status = invoicingStatus({ observedAt: atDeadline, completeThrough: atDeadline });
    expect(single(atDeadline, [orderPaid(), status]).verdict).toBe('FAIL');
    expect(single(new Date(DEADLINE_MS - 1).toISOString(), [orderPaid(), status]).verdict).toBe(
      'PENDING',
    );
  });

  it('completeThrough exactly at the deadline is sufficient; one millisecond earlier is not', () => {
    const atDeadline = new Date(DEADLINE_MS).toISOString();
    expect(
      single(AFTER_DEADLINE, [orderPaid(), invoicingStatus({ completeThrough: atDeadline })])
        .verdict,
    ).toBe('FAIL');
    expect(
      single(AFTER_DEADLINE, [
        orderPaid(),
        invoicingStatus({ completeThrough: new Date(DEADLINE_MS - 1).toISOString() }),
      ]).verdict,
    ).toBe('PENDING');
  });

  it('reports deadline and window start derived from the trigger occurrence time, not collection time', () => {
    const verdict = single(AFTER_DEADLINE, [orderPaid({ collectedAt: at(50_000) }), complete]);
    expect(verdict.expectations[0]?.deadline).toBe(new Date(DEADLINE_MS).toISOString());
    expect(verdict.expectations[0]?.windowStart).toBe(new Date(T0_MS - 5_000).toISOString());
    expect(verdict.evaluatedAt).toBe(AFTER_DEADLINE);
  });
});

describe('cardinality variants', () => {
  it('none: PASS only with a complete source and no observations', () => {
    const rule = ruleWith({ cardinality: 'none', assertions: [] });
    expect(single(AFTER_DEADLINE, [orderPaid(), invoicingStatus()], rule).verdict).toBe('PASS');
    const violated = single(
      AFTER_DEADLINE,
      [orderPaid(), invoiceCreated(), invoicingStatus()],
      rule,
    );
    expect(violated.verdict).toBe('FAIL');
    expect(codes(violated)).toEqual(['UNEXPECTED_OUTCOME']);
    expect(
      single(AFTER_DEADLINE, [orderPaid(), invoicingStatus({ completeThrough: undefined })], rule)
        .verdict,
    ).toBe('UNKNOWN');
  });

  it('explicit {min, max} bounds', () => {
    const rule = ruleWith({ cardinality: { min: 2, max: 3 }, assertions: [] });
    const one = single(AFTER_DEADLINE, [orderPaid(), invoiceCreated(), invoicingStatus()], rule);
    expect(one.verdict).toBe('FAIL');
    expect(codes(one)).toEqual(['MISSING_EXPECTED_OUTCOME']);
    const two = single(
      AFTER_DEADLINE,
      [
        orderPaid(),
        invoiceCreated({ eventId: 'a', payload: { invoiceId: 'i1', orderId: 'ord_1' } }),
        invoiceCreated({ eventId: 'b', payload: { invoiceId: 'i2', orderId: 'ord_1' } }),
        invoicingStatus(),
      ],
      rule,
    );
    expect(two.verdict).toBe('PASS');
  });
});

describe('multi-rule, multi-trigger evaluation', () => {
  it('evaluates each trigger separately and orders output deterministically', () => {
    const records = [
      orderPaid({
        eventId: 'o2',
        occurredAt: at(1_000),
        payload: { orderId: 'ord_2', amount: 1, currency: 'USD' },
      }),
      orderPaid({ eventId: 'o1', payload: { orderId: 'ord_1', amount: 49.99, currency: 'USD' } }),
      invoiceCreated(),
      invoicingStatus(),
    ];
    const verdicts = evaluateRules([invoiceRule], EvidenceSet.from(records), {
      clock: new FixedClock(AFTER_DEADLINE),
    });
    expect(verdicts.map((v) => [v.correlationValue, v.verdict])).toEqual([
      ['"ord_1"', 'PASS'],
      ['"ord_2"', 'FAIL'],
    ]);
  });

  it('combines expectation verdicts with FAIL > UNKNOWN > PENDING > PASS', () => {
    const base = invoiceRule.expectations[0];
    if (base === undefined) throw new Error('unreachable');
    const rule = {
      ...invoiceRule,
      expectations: [
        base,
        { ...base, id: 'receipt', type: 'receipt.sent', source: 'mailer', assertions: [] },
      ],
    };
    const verdict = single(
      AFTER_DEADLINE,
      [orderPaid(), invoiceCreated(), invoicingStatus()],
      rule,
    );
    expect(verdict.expectations.map((e) => e.verdict)).toEqual(['PASS', 'UNKNOWN']);
    expect(verdict.verdict).toBe('UNKNOWN');
  });

  it('refuses to evaluate a trigger of the wrong type', () => {
    const set = EvidenceSet.from([invoiceCreated()]);
    const trigger = set.event('evt-inv-1');
    if (trigger === undefined) throw new Error('unreachable');
    expect(() =>
      evaluateTrigger(invoiceRule, trigger, set, { clock: new FixedClock(AFTER_DEADLINE) }),
    ).toThrow(/triggers on "order.paid"/);
  });
});

describe('trigger integrity and rule ordering', () => {
  it('a trigger whose redeliveries disagree on content yields UNKNOWN even when the invoice is fine', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid({ deliveryId: 'd-1' }),
      orderPaid({
        deliveryId: 'd-2',
        collectedAt: at(900),
        payload: { orderId: 'ord_1', paymentId: 'pay_1', amount: 59.99, currency: 'USD' },
      }),
      invoiceCreated(),
      invoicingStatus(),
    ]);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(verdict.trigger.deliveries).toBe(2);
    expect(codes(verdict).slice(0, 2)).toEqual([
      'REDELIVERY_DEDUPLICATED',
      'CONFLICTING_REDELIVERY',
    ]);
    expect(verdict.reasons[1]?.message).toContain('deliveries of trigger evt-order-1 disagree');
  });

  it('evaluateRules orders output by rule id regardless of input order', () => {
    const receipt = { ...invoiceRule, id: 'receipt-sent' };
    const verdicts = evaluateRules(
      [receipt, invoiceRule],
      EvidenceSet.from([orderPaid(), invoicingStatus()]),
      {
        clock: new FixedClock(AFTER_DEADLINE),
      },
    );
    expect(verdicts.map((v) => v.ruleId)).toEqual(['invoice-created-once', 'receipt-sent']);
    const reversed = evaluateRules(
      [invoiceRule, receipt],
      EvidenceSet.from([orderPaid(), invoicingStatus()]),
      {
        clock: new FixedClock(AFTER_DEADLINE),
      },
    );
    expect(reversed).toEqual(verdicts);
  });
});
