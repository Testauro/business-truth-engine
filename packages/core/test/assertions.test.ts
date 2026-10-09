import { describe, expect, it } from 'vitest';
import type { Assertion } from '../src/index.js';
import { evaluateAssertion } from '../src/index.js';

const trigger = { orderId: 'ord_1', amount: 49.99, currency: 'USD', items: 3, name: 'b' };

function assertion(
  partial: Partial<Assertion> & Pick<Assertion, 'field' | 'op' | 'expected'>,
): Assertion {
  return partial;
}

describe('evaluateAssertion', () => {
  it('equals / notEquals compare structurally against trigger paths and literals', () => {
    expect(
      evaluateAssertion(
        assertion({ field: 'amount', op: 'equals', expected: { trigger: 'amount' } }),
        { amount: 49.99 },
        trigger,
      ).status,
    ).toBe('pass');
    expect(
      evaluateAssertion(
        assertion({ field: 'amount', op: 'equals', expected: { value: '49.99' } }),
        { amount: 49.99 },
        trigger,
      ).status,
    ).toBe('fail');
    expect(
      evaluateAssertion(
        assertion({ field: 'currency', op: 'notEquals', expected: { value: 'EUR' } }),
        { currency: 'USD' },
        trigger,
      ).status,
    ).toBe('pass');
    expect(
      evaluateAssertion(
        assertion({ field: 'currency', op: 'notEquals', expected: { trigger: 'currency' } }),
        { currency: 'USD' },
        trigger,
      ).status,
    ).toBe('fail');
    expect(
      evaluateAssertion(
        assertion({ field: 'tags', op: 'equals', expected: { value: null } }),
        { tags: null },
        trigger,
      ).status,
    ).toBe('pass');
  });

  it.each([
    ['gt', 4, 3, 'pass'],
    ['gt', 3, 3, 'fail'],
    ['gte', 3, 3, 'pass'],
    ['gte', 2, 3, 'fail'],
    ['lt', 2, 3, 'pass'],
    ['lt', 3, 3, 'fail'],
    ['lte', 3, 3, 'pass'],
    ['lte', 4, 3, 'fail'],
  ] as const)('%s %s vs %s -> %s', (op, actual, expected, status) => {
    const outcome = evaluateAssertion(
      assertion({ field: 'n', op, expected: { value: expected } }),
      { n: actual },
      trigger,
    );
    expect(outcome.status).toBe(status);
  });

  it('orders strings lexicographically and refuses mixed or non-ordered types', () => {
    expect(
      evaluateAssertion(
        assertion({ field: 'name', op: 'gt', expected: { trigger: 'name' } }),
        { name: 'c' },
        trigger,
      ).status,
    ).toBe('pass');
    const mixed = evaluateAssertion(
      assertion({ field: 'n', op: 'gt', expected: { value: 3 } }),
      { n: '4' },
      trigger,
    );
    expect(mixed.status).toBe('fail');
    expect(mixed.status === 'fail' && mixed.message).toContain('is not defined for "4" and 3');
    const objects = evaluateAssertion(
      assertion({ field: 'o', op: 'lte', expected: { value: true } }),
      { o: { a: 1 } },
      trigger,
    );
    expect(objects.status).toBe('fail');
  });

  it('a missing observation field fails; a missing trigger field is indeterminate', () => {
    const missingObservation = evaluateAssertion(
      assertion({ field: 'amount', op: 'equals', expected: { trigger: 'amount' } }),
      {},
      trigger,
    );
    expect(missingObservation.status).toBe('fail');
    expect(missingObservation.status === 'fail' && missingObservation.message).toContain(
      'observation has no value at "amount"',
    );
    const missingTrigger = evaluateAssertion(
      assertion({ field: 'amount', op: 'equals', expected: { trigger: 'tax' } }),
      { amount: 1 },
      trigger,
    );
    expect(missingTrigger.status).toBe('indeterminate');
    expect(missingTrigger.status === 'indeterminate' && missingTrigger.message).toContain(
      'trigger payload has no value at "tax"',
    );
  });

  it('describes nested values and undefined in messages', () => {
    const outcome = evaluateAssertion(
      assertion({ field: 'a.b', op: 'equals', expected: { value: 2 } }),
      { a: { b: [1] } },
      trigger,
    );
    expect(outcome.status === 'fail' && outcome.message).toBe('"a.b" is [1], expected equals 2');
  });
});

describe('regex and set-membership operators', () => {
  it('matches / notMatches test strings against a compiled pattern, honouring flags', () => {
    const matches = assertion({
      field: 'invoiceId',
      op: 'matches',
      expected: { pattern: '^inv_[0-9]{4,}$' },
    });
    expect(evaluateAssertion(matches, { invoiceId: 'inv_0001' }, trigger).status).toBe('pass');
    const miss = evaluateAssertion(matches, { invoiceId: 'INV-1' }, trigger);
    expect(miss.status).toBe('fail');
    expect(miss.status === 'fail' && miss.message).toBe(
      '"invoiceId" is "INV-1", expected matches /^inv_[0-9]{4,}$/',
    );
    const ci = assertion({
      field: 'invoiceId',
      op: 'matches',
      expected: { pattern: '^inv_', flags: 'i' },
    });
    expect(evaluateAssertion(ci, { invoiceId: 'INV_7' }, trigger).status).toBe('pass');
    const not = assertion({ field: 'invoiceId', op: 'notMatches', expected: { pattern: 'draft' } });
    expect(evaluateAssertion(not, { invoiceId: 'inv_draft_1' }, trigger).status).toBe('fail');
    expect(evaluateAssertion(not, { invoiceId: 'inv_1' }, trigger).status).toBe('pass');
  });

  it('a global pattern does not carry lastIndex state between evaluations', () => {
    const g = assertion({ field: 'ref', op: 'matches', expected: { pattern: 'x', flags: 'g' } });
    expect(evaluateAssertion(g, { ref: 'x' }, trigger).status).toBe('pass');
    expect(evaluateAssertion(g, { ref: 'x' }, trigger).status).toBe('pass');
  });

  it('matches against a non-string observation value is a mismatch, not a crash', () => {
    const out = evaluateAssertion(
      assertion({ field: 'n', op: 'matches', expected: { pattern: '1' } }),
      { n: 1 },
      trigger,
    );
    expect(out.status).toBe('fail');
    expect(out.status === 'fail' && out.message).toContain('is not defined for 1 and /1/');
  });

  it('in / notIn use structural membership against a literal array or a trigger array', () => {
    const inLit = assertion({ field: 'currency', op: 'in', expected: { value: ['USD', 'EUR'] } });
    expect(evaluateAssertion(inLit, { currency: 'EUR' }, trigger).status).toBe('pass');
    const out = evaluateAssertion(inLit, { currency: 'JPY' }, trigger);
    expect(out.status).toBe('fail');
    expect(out.status === 'fail' && out.message).toBe(
      '"currency" is "JPY", expected in ["USD","EUR"]',
    );
    const notIn = assertion({ field: 'currency', op: 'notIn', expected: { value: ['JPY'] } });
    expect(evaluateAssertion(notIn, { currency: 'JPY' }, trigger).status).toBe('fail');
    const fromTrigger = assertion({
      field: 'warehouse',
      op: 'in',
      expected: { trigger: 'allowed' },
    });
    expect(
      evaluateAssertion(fromTrigger, { warehouse: 'ams' }, { ...trigger, allowed: ['ams', 'fra'] })
        .status,
    ).toBe('pass');
    expect(
      evaluateAssertion(fromTrigger, { warehouse: 'lhr' }, { ...trigger, allowed: ['ams', 'fra'] })
        .status,
    ).toBe('fail');
    const structural = assertion({ field: 'tag', op: 'in', expected: { value: [1, null, true] } });
    expect(evaluateAssertion(structural, { tag: null }, trigger).status).toBe('pass');
    expect(evaluateAssertion(structural, { tag: '1' }, trigger).status).toBe('fail');
  });

  it('a trigger operand that is not an array makes `in` indeterminate', () => {
    const out = evaluateAssertion(
      assertion({ field: 'w', op: 'in', expected: { trigger: 'currency' } }),
      { w: 'USD' },
      trigger,
    );
    expect(out.status).toBe('indeterminate');
    expect(out.status === 'indeterminate' && out.message).toContain('not an array; in needs a set');
  });
});
