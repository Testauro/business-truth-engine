import { describe, expect, it } from 'vitest';
import { EvidenceSet, parseRule } from '../src/index.js';
import {
  AFTER_DEADLINE,
  at,
  codes,
  invoiceCreated,
  invoiceRuleInput,
  invoicingStatus,
  orderPaid,
  single,
} from './helpers.js';

const ordersStatus = (overrides: Partial<ReturnType<typeof invoicingStatus>> = {}) => ({
  ...invoicingStatus(),
  source: 'orders',
  ...overrides,
});

const ruleWithTriggerSource = parseRule({
  ...invoiceRuleInput,
  trigger: { ...invoiceRuleInput.trigger, source: 'orders' },
});

describe('attestation selection is total and conservative', () => {
  it('same instant, available vs unavailable: unavailable wins in either order', () => {
    const up = invoicingStatus({ observedAt: at(1_000), status: 'available' });
    const down = invoicingStatus({
      observedAt: at(1_000),
      status: 'unavailable',
      completeThrough: undefined,
    });
    expect(EvidenceSet.from([up, down]).sourceStatus('invoicing')?.status).toBe('unavailable');
    expect(EvidenceSet.from([down, up]).sourceStatus('invoicing')?.status).toBe('unavailable');
  });

  it('same instant, both available: no watermark beats a watermark, earlier watermark beats later', () => {
    const none = invoicingStatus({ observedAt: at(1_000), completeThrough: undefined });
    const early = invoicingStatus({ observedAt: at(1_000), completeThrough: at(500) });
    const late = invoicingStatus({ observedAt: at(1_000), completeThrough: at(900) });
    for (const order of [
      [none, early, late],
      [late, early, none],
      [early, none, late],
    ]) {
      expect(EvidenceSet.from(order).sourceStatus('invoicing')?.completeThrough).toBeUndefined();
    }
    for (const order of [
      [early, late],
      [late, early],
    ]) {
      expect(EvidenceSet.from(order).sourceStatus('invoicing')?.completeThrough).toBe(at(500));
    }
  });

  it('a later attestation always supersedes an earlier one, however conservative the earlier was', () => {
    const olderDown = invoicingStatus({
      observedAt: at(1_000),
      status: 'unavailable',
      completeThrough: undefined,
    });
    const newerUp = invoicingStatus({ observedAt: at(2_000) });
    expect(EvidenceSet.from([newerUp, olderDown]).sourceStatus('invoicing')?.status).toBe(
      'available',
    );
  });
});

describe('a source cannot vouch for the future', () => {
  it('a watermark beyond the attestation instant is clamped: absence is not proven, verdict is PENDING', () => {
    const verdict = single(at(180_000), [
      orderPaid(),
      invoicingStatus({ observedAt: at(60_000), completeThrough: at(300_000) }),
    ]);
    expect(verdict.verdict).toBe('PENDING');
    expect(codes(verdict)).toEqual(['SOURCE_INCOMPLETE']);
    const source = verdict.expectations[0]?.source;
    expect(source?.watermarkClamped).toBe(true);
    expect(source?.completeThrough).toBe(at(60_000));
    expect(verdict.reasons[0]?.message).toContain('watermark clamped to the attestation instant');
  });

  it('a watermark at or before the attestation instant is used as attested', () => {
    const verdict = single(at(180_000), [
      orderPaid(),
      invoicingStatus({ observedAt: at(180_000), completeThrough: at(150_000) }),
    ]);
    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.expectations[0]?.source.watermarkClamped).toBe(false);
  });
});

describe('trigger source trust', () => {
  const happy = [orderPaid(), invoiceCreated(), invoicingStatus()];

  it('without trigger.source the rule behaves as before and reports no trigger assessment', () => {
    const verdict = single(AFTER_DEADLINE, happy);
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.triggerSource).toBeNull();
  });

  it('with trigger.source and a trusted orders attestation: PASS, assessment reported', () => {
    const verdict = single(AFTER_DEADLINE, [...happy, ordersStatus()], ruleWithTriggerSource);
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.triggerSource).toMatchObject({ source: 'orders', trusted: true });
  });

  it.each([
    [
      'unavailable',
      ordersStatus({ status: 'unavailable', completeThrough: undefined }),
      'SOURCE_UNAVAILABLE',
    ],
    ['non-authoritative', ordersStatus({ authoritative: false }), 'SOURCE_NOT_AUTHORITATIVE'],
  ] as const)(
    'an %s trigger source forces UNKNOWN even when the invoice looks fine',
    (_label, status, code) => {
      const verdict = single(AFTER_DEADLINE, [...happy, status], ruleWithTriggerSource);
      expect(verdict.verdict).toBe('UNKNOWN');
      expect(codes(verdict)[0]).toBe(code);
      expect(verdict.reasons[0]?.message).toContain('trigger source "orders"');
      expect(verdict.expectations[0]?.verdict).toBe('PASS');
    },
  );

  it('a missing trigger attestation forces UNKNOWN', () => {
    const verdict = single(AFTER_DEADLINE, happy, ruleWithTriggerSource);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(codes(verdict)[0]).toBe('SOURCE_STATUS_MISSING');
  });

  it('an untrusted trigger even overrides a FAIL from a duplicate invoice', () => {
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
        invoicingStatus(),
        ordersStatus({ status: 'unavailable', completeThrough: undefined }),
      ],
      ruleWithTriggerSource,
    );
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(verdict.expectations[0]?.verdict).toBe('FAIL');
    expect(codes(verdict)).toContain('DUPLICATE_OUTCOME');
  });

  it('trigger events from other sources are ignored when trigger.source is set', () => {
    const verdicts = single;
    const fromCache = orderPaid({ source: 'orders-cache' });
    expect(() =>
      verdicts(
        AFTER_DEADLINE,
        [fromCache, invoicingStatus(), ordersStatus()],
        ruleWithTriggerSource,
      ),
    ).toThrow(/expected one verdict, got 0/);
  });
});

describe('unavailable sources quote their attestation note', () => {
  it('the SOURCE_UNAVAILABLE reason carries the note so the cause is visible in the verdict', () => {
    const verdict = single(AFTER_DEADLINE, [
      orderPaid(),
      invoicingStatus({
        status: 'unavailable',
        completeThrough: undefined,
        note: 'collect failed: ECONNREFUSED',
      }),
    ]);
    expect(verdict.verdict).toBe('UNKNOWN');
    expect(verdict.reasons[0]?.message).toContain('(collect failed: ECONNREFUSED)');
    expect(verdict.expectations[0]?.source.note).toBe('collect failed: ECONNREFUSED');
  });
});
