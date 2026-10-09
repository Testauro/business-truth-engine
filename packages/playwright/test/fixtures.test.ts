import { describe, expect, it } from 'vitest';
import type { TestInfo } from '@playwright/test';
import type { EvidenceSource, Rule } from '@bte/core';
import { attestation, parseRule } from '@bte/core';
import { createBte, loadBteWorkerState } from '../src/fixtures.js';

const NOW = Date.parse('2026-01-15T10:03:00.000Z');
const rule: Rule = parseRule({
  id: 'thing-done',
  version: 1,
  trigger: { type: 'thing.started', correlationKey: 'thingId' },
  expectations: [
    { type: 'thing.done', source: 'worker', window: { within: '60s' }, cardinality: 'exactly-one' },
  ],
});

function fakeTestInfo(): TestInfo & { attached: string[] } {
  const attached: string[] = [];
  const info = {
    annotations: [] as { type: string; description?: string }[],
    attach: (name: string) => {
      attached.push(name);
      return Promise.resolve();
    },
    attached,
  };
  return info as unknown as TestInfo & { attached: string[] };
}

const started = (id: string) => ({
  kind: 'event' as const,
  eventId: `start:${id}`,
  type: 'thing.started',
  source: 'app',
  occurredAt: '2026-01-15T10:00:00.000Z',
  collectedAt: '2026-01-15T10:03:00.000Z',
  payload: { thingId: id },
});

describe('createBte', () => {
  it('records correlation as annotations, collects from sources with it, and evaluates from the accumulated records', async () => {
    const seen: unknown[] = [];
    const worker: EvidenceSource = {
      name: 'worker',
      collect: (ctx) => {
        seen.push(ctx.correlation);
        return Promise.resolve([
          started('t1'),
          attestation('worker', ctx.now, { completeThrough: ctx.now }),
        ]);
      },
    };
    const info = fakeTestInfo();
    const bte = createBte(
      { rules: [rule], sources: [worker], loaded: null },
      { now: () => NOW },
      info,
    );
    bte.correlate({ thingId: 't1', tenant: { id: 9 } });
    expect(info.annotations).toEqual([
      { type: 'bte-correlation:thingId', description: 't1' },
      { type: 'bte-correlation:tenant', description: '{"id":9}' },
    ]);
    expect(bte.correlation).toEqual({ thingId: 't1', tenant: { id: 9 } });
    const records = await bte.collect();
    expect(seen).toEqual([{ thingId: 't1', tenant: { id: 9 } }]);
    expect(records).toHaveLength(2);
    expect(bte.records).toHaveLength(2);
    const evaluation = await bte.evaluate('thing-done', 't1');
    expect(evaluation.verdict?.verdict).toBe('FAIL');
    await expect(
      bte.expectInvariant('thing-done', 't1', { timeout: 500, intervals: [50] }),
    ).rejects.toThrow(/got FAIL/);
    expect(info.attached.some((name) => name.endsWith('.verdict.json'))).toBe(true);
  });

  it('annotates unavailable sources and lets tests add their own records', async () => {
    const broken: EvidenceSource = {
      name: 'worker',
      collect: () => Promise.reject(new Error('boom')),
    };
    const info = fakeTestInfo();
    const bte = createBte(
      { rules: [rule], sources: [broken], loaded: null },
      { now: () => NOW },
      info,
    );
    await bte.collect();
    expect(info.annotations).toEqual([
      { type: 'bte-source-unavailable', description: 'worker: boom' },
    ]);
    bte.addRecords([started('t2')]);
    expect(bte.records.map((r) => r.kind)).toEqual(['source', 'event']);
    const verdict = await bte.expectVerdict('thing-done', 't2', 'UNKNOWN', {
      timeout: 500,
      intervals: [50],
    });
    expect(verdict.reasons[0]?.code).toBe('SOURCE_UNAVAILABLE');
  });

  it('uses config.now when no clock is given and rejects half-programmatic options', async () => {
    const loaded = { config: { now: '2026-01-15T10:03:00.000Z' } } as unknown as NonNullable<
      Parameters<typeof createBte>[0]['loaded']
    >;
    const info = fakeTestInfo();
    const bte = createBte({ rules: [rule], sources: [], loaded }, {}, info);
    const evaluation = await bte.evaluate('thing-done', 'none');
    expect(evaluation.evaluatedAt).toBe(NOW);
    await expect(loadBteWorkerState({ rules: [rule] })).rejects.toThrow(
      /pass both `rules` and `sources`/,
    );
    const state = await loadBteWorkerState({ rules: [rule], sources: [] });
    expect(state.loaded).toBeNull();
  });
});
