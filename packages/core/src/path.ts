/**
 * Minimal dotted-path accessor used by correlation keys and assertions.
 * Supports `a.b.c` and numeric segments for arrays (`items.0.sku`).
 * Returns `undefined` when any segment is missing.
 */
export function getPath(value: unknown, path: string): unknown {
  if (path === '') return value;
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Structural equality for JSON-like values (no coercion). */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEquals(item, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keysA = Object.keys(ra).sort();
    const keysB = Object.keys(rb).sort();
    if (!jsonEquals(keysA, keysB)) return false;
    return keysA.every((key) => jsonEquals(ra[key], rb[key]));
  }
  return false;
}

/** Stable string form of a JSON-like value, used for grouping keys. */
export function stableKey(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableKey(record[key])}`)
    .join(',');
  return `{${body}}`;
}
