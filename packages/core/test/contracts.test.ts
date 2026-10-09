import { describe, expect, it } from 'vitest';
import { parseEvidenceRecord } from '../src/index.js';

describe('parseEvidenceRecord', () => {
  it('accepts valid records and rejects unknown kinds', () => {
    expect(
      parseEvidenceRecord({
        kind: 'source',
        source: 's',
        observedAt: '2026-01-01T00:00:00Z',
        status: 'available',
        authoritative: true,
      }).kind,
    ).toBe('source');
    expect(() => parseEvidenceRecord({ kind: 'nope' })).toThrow();
  });
});
