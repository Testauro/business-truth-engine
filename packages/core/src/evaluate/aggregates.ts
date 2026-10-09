import type { Aggregate } from '../contracts/rule.js';
import { getPath, jsonEquals, stableKey } from '../path.js';
import type { AggregateSummary } from '../verdict.js';

function describe(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function label(aggregate: Aggregate): string {
  return aggregate.field === undefined
    ? `${aggregate.fn}()`
    : `${aggregate.fn}(${aggregate.field})`;
}

function compare(op: Aggregate['op'], actual: number, expected: unknown): boolean | null {
  // Aggregates only accept numeric operators (AggregateOperatorSchema).
  if (op === 'equals') return jsonEquals(actual, expected);
  if (op === 'notEquals') return !jsonEquals(actual, expected);
  if (typeof expected !== 'number') return null;
  switch (op) {
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
  }
}

/**
 * Compute one aggregate over the payloads of the distinct in-window
 * observations and compare it with its operand. Pure; the caller decides
 * whether the observation set is complete enough to evaluate at all.
 */
export function evaluateAggregate(
  aggregate: Aggregate,
  observations: readonly Record<string, unknown>[],
  triggerPayload: Record<string, unknown>,
): AggregateSummary {
  const base = {
    fn: aggregate.fn,
    field: aggregate.field ?? null,
    op: aggregate.op,
  };
  let expected: unknown;
  if ('trigger' in aggregate.expected) {
    expected = getPath(triggerPayload, aggregate.expected.trigger);
    if (expected === undefined) {
      return {
        ...base,
        value: null,
        expected,
        status: 'indeterminate',
        message: `${label(aggregate)}: trigger payload has no value at "${aggregate.expected.trigger}"`,
      };
    }
  } else {
    expected = aggregate.expected.value;
  }

  let value: number | null;
  if (aggregate.fn === 'count') {
    value = observations.length;
  } else {
    const field = aggregate.field ?? '';
    const raw = observations.map((payload) => getPath(payload, field));
    if (aggregate.fn === 'distinctCount') {
      value = new Set(raw.filter((v) => v !== undefined).map(stableKey)).size;
    } else {
      const bad = raw.findIndex((v) => typeof v !== 'number' || !Number.isFinite(v));
      if (bad !== -1) {
        return {
          ...base,
          value: null,
          expected,
          status: 'fail',
          message: `${label(aggregate)}: observation ${bad + 1} of ${raw.length} has ${describe(raw[bad])} at "${field}", not a finite number`,
        };
      }
      const numbers = raw as number[];
      if (numbers.length === 0 && aggregate.fn !== 'sum') {
        return {
          ...base,
          value: null,
          expected,
          status: 'fail',
          message: `${label(aggregate)}: no observations to aggregate (expected ${aggregate.op} ${describe(expected)})`,
        };
      }
      switch (aggregate.fn) {
        case 'sum':
          value = numbers.reduce((a, b) => a + b, 0);
          break;
        case 'min':
          value = Math.min(...numbers);
          break;
        case 'max':
          value = Math.max(...numbers);
          break;
        case 'avg':
          value = numbers.reduce((a, b) => a + b, 0) / numbers.length;
          break;
      }
      // Money-style sums accumulate binary noise (0.1 + 0.2); compare at 1e-9 precision.
      value = Math.round(value * 1e9) / 1e9;
    }
  }

  const ok = compare(aggregate.op, value, expected);
  if (ok === null) {
    return {
      ...base,
      value,
      expected,
      status: 'fail',
      message: `${label(aggregate)} ${aggregate.op} is not defined against ${describe(expected)}`,
    };
  }
  return {
    ...base,
    value,
    expected,
    status: ok ? 'pass' : 'fail',
    message: `${label(aggregate)} is ${value} over ${observations.length} observation${observations.length === 1 ? '' : 's'}, expected ${aggregate.op} ${describe(expected)}`,
  };
}
