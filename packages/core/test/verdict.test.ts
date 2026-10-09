import { describe, expect, it } from 'vitest';
import { combineVerdicts } from '../src/index.js';

describe('combineVerdicts', () => {
  it('uses FAIL > UNKNOWN > PENDING > PASS precedence', () => {
    expect(combineVerdicts(['PASS', 'PASS'])).toBe('PASS');
    expect(combineVerdicts(['PASS', 'PENDING'])).toBe('PENDING');
    expect(combineVerdicts(['PENDING', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(combineVerdicts(['UNKNOWN', 'FAIL', 'PASS'])).toBe('FAIL');
  });
  it('treats an empty set as UNKNOWN, never PASS', () => {
    expect(combineVerdicts([])).toBe('UNKNOWN');
  });
});
