import type { EvidenceEvent, EvidenceRecord, Rule, RuleInput, SourceStatus } from '../src/index.js';
import { EvidenceSet, FixedClock, evaluateRule, parseRule } from '../src/index.js';
import type { RuleVerdict } from '../src/index.js';

export const T0 = '2026-01-15T10:00:00.000Z';
export const T0_MS = Date.parse(T0);
export const DEADLINE_MS = T0_MS + 120_000;
export const AFTER_DEADLINE = new Date(DEADLINE_MS + 60_000).toISOString();
export const BEFORE_DEADLINE = new Date(T0_MS + 60_000).toISOString();

export function at(offsetMs: number): string {
  return new Date(T0_MS + offsetMs).toISOString();
}

export const invoiceRuleInput: RuleInput = {
  id: 'invoice-created-once',
  version: 1,
  trigger: { type: 'order.paid', correlationKey: 'orderId' },
  expectations: [
    {
      id: 'invoice',
      type: 'invoice.created',
      source: 'invoicing',
      distinctBy: 'invoiceId',
      window: { within: '120s', before: '5s' },
      cardinality: 'exactly-one',
      assertions: [
        { field: 'orderId', op: 'equals', expected: { trigger: 'orderId' } },
        { field: 'amount', op: 'equals', expected: { trigger: 'amount' } },
        { field: 'currency', op: 'equals', expected: { trigger: 'currency' } },
      ],
    },
  ],
};

export const invoiceRule: Rule = parseRule(invoiceRuleInput);

export function ruleWith(overrides: Partial<RuleInput['expectations'][number]>): Rule {
  const base = invoiceRuleInput.expectations[0];
  if (base === undefined) throw new Error('unreachable');
  return parseRule({ ...invoiceRuleInput, expectations: [{ ...base, ...overrides }] });
}

export interface EventOverrides {
  eventId?: string;
  occurredAt?: string;
  collectedAt?: string;
  deliveryId?: string;
  source?: string;
  payload?: Record<string, unknown>;
}

export function orderPaid(overrides: EventOverrides = {}): EvidenceEvent {
  return {
    kind: 'event',
    eventId: overrides.eventId ?? 'evt-order-1',
    type: 'order.paid',
    source: overrides.source ?? 'orders',
    occurredAt: overrides.occurredAt ?? T0,
    collectedAt: overrides.collectedAt ?? at(200),
    ...(overrides.deliveryId === undefined ? {} : { deliveryId: overrides.deliveryId }),
    payload: overrides.payload ?? {
      orderId: 'ord_1',
      paymentId: 'pay_1',
      amount: 49.99,
      currency: 'USD',
    },
  };
}

export function invoiceCreated(overrides: EventOverrides = {}): EvidenceEvent {
  return {
    kind: 'event',
    eventId: overrides.eventId ?? 'evt-inv-1',
    type: 'invoice.created',
    source: overrides.source ?? 'invoicing',
    occurredAt: overrides.occurredAt ?? at(5_000),
    collectedAt: overrides.collectedAt ?? at(5_300),
    ...(overrides.deliveryId === undefined ? {} : { deliveryId: overrides.deliveryId }),
    payload: overrides.payload ?? {
      invoiceId: 'inv_1',
      orderId: 'ord_1',
      amount: 49.99,
      currency: 'USD',
    },
  };
}

export function invoicingStatus(overrides: Partial<SourceStatus> = {}): SourceStatus {
  return {
    kind: 'source',
    source: 'invoicing',
    observedAt: AFTER_DEADLINE,
    status: 'available',
    authoritative: true,
    completeThrough: AFTER_DEADLINE,
    ...overrides,
  };
}

export function evaluateAt(
  now: string,
  records: readonly EvidenceRecord[],
  rule: Rule = invoiceRule,
): RuleVerdict[] {
  return evaluateRule(rule, EvidenceSet.from(records), { clock: new FixedClock(now) });
}

export function single(
  now: string,
  records: readonly EvidenceRecord[],
  rule: Rule = invoiceRule,
): RuleVerdict {
  const verdicts = evaluateAt(now, records, rule);
  if (verdicts.length !== 1) throw new Error(`expected one verdict, got ${verdicts.length}`);
  const verdict = verdicts[0];
  if (verdict === undefined) throw new Error('unreachable');
  return verdict;
}

export function codes(verdict: RuleVerdict): string[] {
  return verdict.reasons.map((reason) => reason.code);
}
