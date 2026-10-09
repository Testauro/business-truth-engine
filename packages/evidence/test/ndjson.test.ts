import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EvidenceRecord } from '@bte/core';
import {
  EvidenceParseError,
  InMemoryEvidenceStore,
  appendEvidenceNdjson,
  parseEvidenceNdjson,
  readAllEvidence,
  writeEvidenceNdjson,
} from '../src/index.js';

const fixtures = fileURLToPath(new URL('../../../examples/fixtures/', import.meta.url));

describe('NDJSON evidence', () => {
  it('reads a fixture file, skipping comments and blank lines', async () => {
    const records = await readAllEvidence([path.join(fixtures, 'normal.ndjson')]);
    expect(records.map((r) => r.kind)).toEqual(['source', 'event', 'event', 'source']);
  });

  it('reports invalid JSON with file and line', () => {
    expect(() => parseEvidenceNdjson('{"kind":"event"}\n\n{not json', 'x.ndjson')).toThrow(
      EvidenceParseError,
    );
    try {
      parseEvidenceNdjson('\n{not json', 'x.ndjson');
    } catch (error) {
      expect((error as EvidenceParseError).line).toBe(2);
      expect((error as Error).message).toMatch(/^x\.ndjson:2: invalid JSON/);
    }
  });

  it('reports contract violations with the offending path', () => {
    try {
      parseEvidenceNdjson(
        '{"kind":"event","eventId":"e","type":"t","source":"s","occurredAt":"nope","collectedAt":"2026-01-01T00:00:00Z","payload":{}}',
        'x.ndjson',
      );
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceParseError);
      expect((error as EvidenceParseError).issues.join(' ')).toContain('occurredAt');
    }
  });

  it('rejects unknown record kinds and extra keys', () => {
    expect(() => parseEvidenceNdjson('{"kind":"metric"}')).toThrow(EvidenceParseError);
    expect(() =>
      parseEvidenceNdjson(
        '{"kind":"source","source":"s","observedAt":"2026-01-01T00:00:00Z","status":"available","authoritative":true,"extra":1}',
      ),
    ).toThrow(EvidenceParseError);
  });

  it('round-trips through write/append/read', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-evidence-'));
    const file = path.join(dir, 'out.ndjson');
    const event: EvidenceRecord = {
      kind: 'event',
      eventId: 'e1',
      type: 'order.paid',
      source: 'orders',
      occurredAt: '2026-01-01T00:00:00.000Z',
      collectedAt: '2026-01-01T00:00:01.000Z',
      payload: { orderId: 'o1' },
    };
    const status: EvidenceRecord = {
      kind: 'source',
      source: 'orders',
      observedAt: '2026-01-01T00:00:02.000Z',
      status: 'available',
      authoritative: true,
    };
    await writeEvidenceNdjson(file, [event]);
    await appendEvidenceNdjson(file, status);
    expect((await readFile(file, 'utf8')).split('\n').filter(Boolean)).toHaveLength(2);
    expect(await readAllEvidence([file])).toEqual([event, status]);
  });
});

describe('InMemoryEvidenceStore', () => {
  it('validates on append and snapshots to a deduplicated set', () => {
    const store = new InMemoryEvidenceStore();
    const event: EvidenceRecord = {
      kind: 'event',
      eventId: 'e1',
      type: 'order.paid',
      source: 'orders',
      occurredAt: '2026-01-01T00:00:00.000Z',
      collectedAt: '2026-01-01T00:00:01.000Z',
      payload: {},
    };
    store.appendAll([event, { ...event, collectedAt: '2026-01-01T00:00:05.000Z' }]);
    expect(store.records).toHaveLength(2);
    expect(store.snapshot().size).toBe(1);
    expect(() => {
      store.append({ ...event, occurredAt: 'bad' });
    }).toThrow();
  });
});
