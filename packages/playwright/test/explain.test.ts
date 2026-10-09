import { describe, expect, it } from 'vitest';
import type { RuleVerdict } from '@bte/core';
import { explainVerdict } from '../src/explain.js';

const verdict: RuleVerdict = {
  ruleId: 'invoice-created-once',
  ruleVersion: 1,
  verdict: 'FAIL',
  correlationKey: 'orderId',
  correlationValue: '"ord_0001"',
  trigger: {
    eventId: 'order.paid:ord_0001:pay_0001',
    type: 'order.paid',
    occurredAt: '2026-01-15T10:00:00.000Z',
    collectedAt: '2026-01-15T10:00:00.000Z',
    deliveries: 1,
  },
  evaluatedAt: '2026-01-15T10:03:00.000Z',
  triggerSource: {
    source: 'orders',
    trusted: true,
    status: 'available',
    authoritative: true,
    completeThrough: '2026-01-15T10:03:00.000Z',
    watermarkClamped: false,
    completeThroughDeadline: true,
    observedAt: '2026-01-15T10:03:00.000Z',
    note: null,
  },
  expectations: [
    {
      expectationId: 'invoice',
      type: 'invoice.created',
      verdict: 'FAIL',
      deadline: '2026-01-15T10:02:00.000Z',
      windowStart: '2026-01-15T09:59:55.000Z',
      cardinality: { min: 1, max: 1 },
      correlation: {
        triggerPath: 'orderId',
        observationPath: 'orderId',
        keys: ['"ord_0001"'],
        hops: [],
      },
      distinctInWindow: 0,
      observations: [],
      aggregates: [],
      source: {
        source: 'invoicing',
        trusted: true,
        status: 'available',
        authoritative: true,
        completeThrough: '2026-01-15T10:03:00.000Z',
        watermarkClamped: false,
        completeThroughDeadline: true,
        observedAt: '2026-01-15T10:03:00.000Z',
        note: null,
      },
      reasons: [],
    },
  ],
  reasons: [
    {
      code: 'MISSING_EXPECTED_OUTCOME',
      message: '0 of 1 required invoice.created observed',
      evidenceIds: ['source:invoicing@2026-01-15T10:03:00.000Z', 'order.paid:ord_0001:pay_0001'],
    },
  ],
};

describe('explainVerdict', () => {
  it('names the rule, correlation, trigger, expectation state and every reason with evidence ids', () => {
    const text = explainVerdict(verdict);
    expect(text).toContain('BTE FAIL: rule invoice-created-once@v1 for orderId="ord_0001"');
    expect(text).toContain('trigger order.paid order.paid:ord_0001:pay_0001');
    expect(text).toContain(
      'trigger source orders: trusted (available, authoritative, complete through 2026-01-15T10:03:00.000Z)',
    );
    expect(text).toContain('expectation "invoice" (invoice.created): FAIL; 0 distinct in window');
    expect(text).toContain(
      'source invoicing (available, authoritative, complete through 2026-01-15T10:03:00.000Z)',
    );
    expect(text).toContain(
      '- MISSING_EXPECTED_OUTCOME: 0 of 1 required invoice.created observed [evidence: source:invoicing@2026-01-15T10:03:00.000Z, order.paid:ord_0001:pay_0001]',
    );
  });
});
