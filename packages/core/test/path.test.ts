import { describe, expect, it } from 'vitest';
import { getPath, jsonEquals, stableKey } from '../src/index.js';

describe('getPath', () => {
  const doc = { a: { b: [{ c: 1 }, { c: 2 }] }, n: null, z: 0 };
  it('walks objects and arrays', () => {
    expect(getPath(doc, 'a.b.1.c')).toBe(2);
    expect(getPath(doc, 'z')).toBe(0);
    expect(getPath(doc, '')).toBe(doc);
  });
  it('returns undefined for missing or non-traversable segments', () => {
    expect(getPath(doc, 'a.x')).toBeUndefined();
    expect(getPath(doc, 'n.x')).toBeUndefined();
    expect(getPath(doc, 'a.b.x')).toBeUndefined();
    expect(getPath(doc, 'z.q')).toBeUndefined();
    expect(getPath(undefined, 'a')).toBeUndefined();
  });
});

describe('jsonEquals', () => {
  it('compares structurally without coercion', () => {
    expect(jsonEquals(49.99, 49.99)).toBe(true);
    expect(jsonEquals('49.99', 49.99)).toBe(false);
    expect(jsonEquals({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(jsonEquals({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEquals(null, undefined)).toBe(false);
    expect(jsonEquals([1], { 0: 1 })).toBe(false);
  });
});

describe('stableKey', () => {
  it('is independent of key order', () => {
    expect(stableKey({ b: 1, a: [true, null] })).toBe(stableKey({ a: [true, null], b: 1 }));
    expect(stableKey('x')).toBe('"x"');
    expect(stableKey(undefined)).toBe('undefined');
  });
});
