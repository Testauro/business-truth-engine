const UNITS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/;

/**
 * Parse a human duration such as `120s`, `2m`, `500ms`, `1.5h` into
 * milliseconds. Throws on anything else so rule files fail loudly.
 */
export function parseDuration(input: string): number {
  const match = DURATION_RE.exec(input.trim());
  if (!match) {
    throw new TypeError(
      `Invalid duration "${input}". Expected <number><unit> with unit in ms, s, m, h, d.`,
    );
  }
  const [, amount, unit] = match;
  const multiplier = unit === undefined ? undefined : UNITS[unit];
  if (amount === undefined || multiplier === undefined) {
    throw new TypeError(`Invalid duration "${input}".`);
  }
  return Math.round(Number(amount) * multiplier);
}

export function isDuration(input: string): boolean {
  return DURATION_RE.test(input.trim());
}
