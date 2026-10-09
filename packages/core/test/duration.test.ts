import { describe, expect, it } from 'vitest';
import { isDuration, parseDuration } from '../src/index.js';

describe('parseDuration', () => {
  it.each([
    ['120s', 120_000],
    ['2m', 120_000],
    ['500ms', 500],
    ['1.5h', 5_400_000],
    ['1d', 86_400_000],
    [' 10 s ', 10_000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', '120', 's', '-5s', '5 seconds', '1w'])('rejects %j', (input) => {
    expect(() => parseDuration(input)).toThrow(TypeError);
    expect(isDuration(input)).toBe(false);
  });
});
