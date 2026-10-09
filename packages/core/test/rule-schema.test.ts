import { describe, expect, it } from 'vitest';
import { RuleSchema, parseRule, resolveCardinality } from '../src/index.js';
import { invoiceRuleInput } from './helpers.js';

describe('RuleSchema', () => {
  it('accepts the reference rule and defaults assertions', () => {
    const rule = parseRule({
      ...invoiceRuleInput,
      expectations: [{ ...invoiceRuleInput.expectations[0], assertions: undefined }],
    });
    expect(rule.expectations[0]?.assertions).toEqual([]);
  });

  it.each([
    ['bad id', { id: 'Invoice Once' }],
    ['version 0', { version: 0 }],
    ['unknown key', { extra: true }],
    ['no expectations', { expectations: [] }],
  ])('rejects %s', (_label, patch) => {
    expect(RuleSchema.safeParse({ ...invoiceRuleInput, ...patch }).success).toBe(false);
  });

  it.each([
    ['bad duration', { window: { within: '2 minutes' } }],
    ['bad path', { correlationKey: 'order id' }],
    ['max < min', { cardinality: { min: 2, max: 1 } }],
    ['unfalsifiable', { cardinality: { min: 0 } }],
    ['bad operator', { assertions: [{ field: 'x', op: 'like', expected: { value: 1 } }] }],
    [
      'expected with both forms',
      { assertions: [{ field: 'x', op: 'equals', expected: { value: 1, trigger: 'x' } }] },
    ],
  ])('rejects expectation with %s', (_label, patch) => {
    const base = invoiceRuleInput.expectations[0];
    const result = RuleSchema.safeParse({
      ...invoiceRuleInput,
      expectations: [{ ...base, ...patch }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate expectation ids', () => {
    const base = invoiceRuleInput.expectations[0];
    const result = RuleSchema.safeParse({ ...invoiceRuleInput, expectations: [base, base] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('duplicate expectation id');
  });

  it('resolves cardinality shorthands', () => {
    expect(resolveCardinality('exactly-one')).toEqual({ min: 1, max: 1 });
    expect(resolveCardinality('at-least-one')).toEqual({ min: 1, max: Number.POSITIVE_INFINITY });
    expect(resolveCardinality('none')).toEqual({ min: 0, max: 0 });
    expect(resolveCardinality({ min: 2 })).toEqual({ min: 2, max: Number.POSITIVE_INFINITY });
  });
});

describe('operator operand validation', () => {
  const base = invoiceRuleInput.expectations[0];
  const withAssertion = (a: unknown) =>
    RuleSchema.safeParse({ ...invoiceRuleInput, expectations: [{ ...base, assertions: [a] }] });

  it('accepts regex and set operands in their proper shapes', () => {
    expect(
      withAssertion({
        field: 'invoiceId',
        op: 'matches',
        expected: { pattern: '^inv_', flags: 'i' },
      }).success,
    ).toBe(true);
    expect(
      withAssertion({ field: 'currency', op: 'in', expected: { value: ['USD', 'EUR'] } }).success,
    ).toBe(true);
    expect(
      withAssertion({ field: 'currency', op: 'notIn', expected: { trigger: 'blocked' } }).success,
    ).toBe(true);
    expect(
      withAssertion({ field: 'tags', op: 'equals', expected: { value: ['a', 'b'] } }).success,
    ).toBe(true);
  });

  it.each([
    [
      'invalid regex',
      { field: 'x', op: 'matches', expected: { pattern: '(' } },
      'invalid regular expression',
    ],
    [
      'bad flags',
      { field: 'x', op: 'matches', expected: { pattern: 'a', flags: 'z' } },
      'subset of gimsuy',
    ],
    [
      'matches without pattern',
      { field: 'x', op: 'matches', expected: { value: 'a' } },
      'needs a { pattern } operand',
    ],
    [
      'pattern with equals',
      { field: 'x', op: 'equals', expected: { pattern: 'a' } },
      'only valid with matches',
    ],
    [
      'in with scalar',
      { field: 'x', op: 'in', expected: { value: 'USD' } },
      'needs an array of values',
    ],
  ])('rejects %s', (_label, a, message) => {
    const result = withAssertion(a);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).join('\n')).toContain(message);
  });

  it('aggregates only accept numeric operators and scalar operands', () => {
    const agg = (a: unknown) =>
      RuleSchema.safeParse({ ...invoiceRuleInput, expectations: [{ ...base, aggregates: [a] }] });
    expect(
      agg({ fn: 'sum', field: 'amount', op: 'matches', expected: { pattern: '1' } }).success,
    ).toBe(false);
    expect(agg({ fn: 'count', op: 'in', expected: { value: [1, 2] } }).success).toBe(false);
    expect(agg({ fn: 'sum', field: 'amount', op: 'lte', expected: { value: [1] } }).success).toBe(
      false,
    );
  });
});
