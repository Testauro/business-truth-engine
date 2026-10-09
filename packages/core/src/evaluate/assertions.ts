import type { Assertion, AssertionOperator } from '../contracts/rule.js';
import { getPath, jsonEquals } from '../path.js';

export type AssertionOutcome =
  | { status: 'pass'; assertion: Assertion; actual: unknown; expected: unknown }
  | { status: 'fail'; assertion: Assertion; actual: unknown; expected: unknown; message: string }
  | { status: 'indeterminate'; assertion: Assertion; message: string };

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value instanceof RegExp) return value.toString();
  return JSON.stringify(value);
}

function compareOrdered(op: AssertionOperator, actual: unknown, expected: unknown): boolean | null {
  if (typeof actual === 'number' && typeof expected === 'number') {
    return compareSameType(op, actual, expected);
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    return compareSameType(op, actual, expected);
  }
  return null;
}

function compareSameType<T extends number | string>(
  op: AssertionOperator,
  a: T,
  b: T,
): boolean | null {
  switch (op) {
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    case 'equals':
    case 'notEquals':
    case 'matches':
    case 'notMatches':
    case 'in':
    case 'notIn':
      return null;
  }
}

/**
 * Evaluate one assertion against an observation payload. Missing fields on the
 * observation are failures (the outcome is wrong). Missing or ill-typed
 * operands on the trigger are indeterminate: we cannot judge, so the caller
 * degrades to UNKNOWN.
 */
export function evaluateAssertion(
  assertion: Assertion,
  observationPayload: Record<string, unknown>,
  triggerPayload: Record<string, unknown>,
): AssertionOutcome {
  let expected: unknown;
  if ('pattern' in assertion.expected) {
    // Validated at rule-load time; constructing again here cannot throw.
    expected = new RegExp(assertion.expected.pattern, assertion.expected.flags);
  } else if ('trigger' in assertion.expected) {
    expected = getPath(triggerPayload, assertion.expected.trigger);
    if (expected === undefined) {
      return {
        status: 'indeterminate',
        assertion,
        message: `trigger payload has no value at "${assertion.expected.trigger}"`,
      };
    }
    if ((assertion.op === 'in' || assertion.op === 'notIn') && !Array.isArray(expected)) {
      return {
        status: 'indeterminate',
        assertion,
        message: `trigger payload value at "${assertion.expected.trigger}" is ${describeValue(expected)}, not an array; ${assertion.op} needs a set`,
      };
    }
  } else {
    expected = assertion.expected.value;
  }

  const actual = getPath(observationPayload, assertion.field);
  if (actual === undefined) {
    return {
      status: 'fail',
      assertion,
      actual,
      expected,
      message: `observation has no value at "${assertion.field}" (expected ${assertion.op} ${describeValue(expected)})`,
    };
  }

  let ok: boolean | null;
  switch (assertion.op) {
    case 'equals':
      ok = jsonEquals(actual, expected);
      break;
    case 'notEquals':
      ok = !jsonEquals(actual, expected);
      break;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      ok = compareOrdered(assertion.op, actual, expected);
      break;
    case 'matches':
    case 'notMatches': {
      if (typeof actual !== 'string' || !(expected instanceof RegExp)) {
        ok = null;
        break;
      }
      // A fresh lastIndex for every evaluation: global/sticky patterns must not carry state.
      expected.lastIndex = 0;
      const hit = expected.test(actual);
      ok = assertion.op === 'matches' ? hit : !hit;
      break;
    }
    case 'in':
    case 'notIn': {
      if (!Array.isArray(expected)) {
        ok = null;
        break;
      }
      const member = expected.some((candidate) => jsonEquals(actual, candidate));
      ok = assertion.op === 'in' ? member : !member;
      break;
    }
  }

  if (ok === null) {
    return {
      status: 'fail',
      assertion,
      actual,
      expected,
      message: `"${assertion.field}" ${assertion.op} is not defined for ${describeValue(actual)} and ${describeValue(expected)}`,
    };
  }
  if (!ok) {
    return {
      status: 'fail',
      assertion,
      actual,
      expected,
      message: `"${assertion.field}" is ${describeValue(actual)}, expected ${assertion.op} ${describeValue(expected)}`,
    };
  }
  return { status: 'pass', assertion, actual, expected };
}
