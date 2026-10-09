import { describe, expect, it } from 'vitest';
import { FixedClock, ManualClock, SystemClock, toEpochMillis, toIso } from '../src/index.js';

describe('clocks', () => {
  it('FixedClock accepts epoch millis, ISO strings and Dates', () => {
    expect(new FixedClock(1_000).now()).toBe(1_000);
    expect(new FixedClock('1970-01-01T00:00:01.000Z').now()).toBe(1_000);
    expect(new FixedClock(new Date(1_000)).now()).toBe(1_000);
  });

  it('rejects invalid instants loudly', () => {
    expect(() => new FixedClock('not a date')).toThrow(/Invalid timestamp/);
    expect(() => new FixedClock(Number.NaN)).toThrow(/Invalid epoch millis/);
    expect(() => toEpochMillis(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('ManualClock only moves forward, by explicit amounts', () => {
    const clock = new ManualClock('2026-01-15T10:00:00.000Z');
    expect(clock.advance(1_500)).toBe(Date.parse('2026-01-15T10:00:01.500Z'));
    expect(toIso(clock.now())).toBe('2026-01-15T10:00:01.500Z');
    expect(clock.set('2026-01-15T10:01:00.000Z')).toBe(Date.parse('2026-01-15T10:01:00.000Z'));
    expect(() => clock.set('2026-01-15T10:00:00.000Z')).toThrow(/cannot move backwards/);
    expect(() => clock.advance(-1)).toThrow(/non-negative/);
    expect(() => clock.advance(Number.NaN)).toThrow(TypeError);
    expect(clock.advance(0)).toBe(clock.now());
  });

  it('SystemClock reads the wall clock', () => {
    const before = Date.now();
    const now = new SystemClock().now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
