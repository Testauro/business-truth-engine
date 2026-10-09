import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EvidenceRecord } from '@bte/core';
import { EvidenceSet, FixedClock, evaluateRules, stableKey } from '@bte/core';
import { readAllEvidence } from '@bte/evidence';
import { loadRules } from '@bte/rules';
import pg from 'pg';
import { EvidenceStoreError, PostgresEvidenceStore, redactConnectionString } from '../src/index.js';

const url = process.env['BTE_TEST_POSTGRES_URL'];
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixtures = path.join(repoRoot, 'examples', 'fixtures');

if (url === undefined || url === '') {
  console.warn('BTE_TEST_POSTGRES_URL is not set: skipping PostgreSQL evidence store tests');
}

describe.skipIf(url === undefined || url === '')('PostgresEvidenceStore', () => {
  const schema = `bte_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  let store: PostgresEvidenceStore;
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    store = new PostgresEvidenceStore(pool, { schema });
    await store.migrate();
    await store.migrate(); // idempotent
  });

  afterAll(async () => {
    await store.destroy();
    await pool.end();
  });

  async function fixture(name: string): Promise<EvidenceRecord[]> {
    return readAllEvidence([path.join(fixtures, `${name}.ndjson`)]);
  }

  it('rejects unsafe schema names', () => {
    expect(() => new PostgresEvidenceStore(pool, { schema: 'bad;drop' })).toThrow(
      /invalid SQL identifier/,
    );
  });

  it('round-trips every fixture: what goes in comes out, validated, in a deterministic order', async () => {
    const files = (await readdir(fixtures)).filter((f) => f.endsWith('.ndjson')).sort();
    let total = 0;
    for (const file of files) {
      const records = await readAllEvidence([path.join(fixtures, file)]);
      total += records.length;
      await store.appendAll(records);
    }
    const loaded = await store.load();
    // Fixtures repeat identical records across files; identical rows are stored once.
    expect(loaded.length).toBeLessThan(total);
    // JSONB does not preserve key order, so compare by a canonical key.
    const sortKey = (r: EvidenceRecord): string => stableKey(r);
    const expected = new Set<string>();
    for (const file of files)
      for (const r of await readAllEvidence([path.join(fixtures, file)])) expected.add(sortKey(r));
    expect(new Set(loaded.map(sortKey))).toEqual(expected);
    const again = await store.load();
    expect(again).toEqual(loaded);
  });

  it('re-ingesting is idempotent: identical rows are reported as duplicates and counts do not grow', async () => {
    const before = await store.counts();
    const result = await store.appendAll(await fixture('normal'));
    expect(result).toEqual({
      events: { inserted: 0, duplicates: 2 },
      sources: { inserted: 0, duplicates: 2 },
    });
    expect(await store.counts()).toEqual(before);
  });

  it('keeps genuine redeliveries (other delivery id) and the engine still counts the event once', async () => {
    const [, order] = await fixture('normal');
    if (order?.kind !== 'event') throw new Error('fixture shape changed');
    const redelivered: EvidenceRecord = {
      ...order,
      deliveryId: 'retry-9',
      collectedAt: '2026-01-15T10:00:09.000Z',
    };
    const result = await store.append(redelivered);
    expect(result.events.inserted).toBe(1);
    const set = await store.snapshot({ correlation: { path: 'orderId', value: 'ord_1001' } });
    expect(set.event(order.eventId)?.deliveries.length).toBeGreaterThanOrEqual(2);
    expect(
      set.eventsOfType('order.paid').filter((e) => e.canonical.eventId === order.eventId),
    ).toHaveLength(1);
  });

  it('filters by type, source and correlation while always returning attestations', async () => {
    const onlyInvoices = await store.load({ types: ['invoice.created'] });
    expect(
      onlyInvoices.filter((r) => r.kind === 'event').every((r) => r.type === 'invoice.created'),
    ).toBe(true);
    expect(onlyInvoices.some((r) => r.kind === 'source')).toBe(true);

    const ord2002 = await store.load({ correlation: { path: 'orderId', value: 'ord_2002' } });
    const events = ord2002.filter((r) => r.kind === 'event');
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((r) => r.payload['orderId'] === 'ord_2002')).toBe(true);

    const invoicingOnly = await store.load({ sources: ['invoicing'] });
    expect(invoicingOnly.every((r) => r.source === 'invoicing')).toBe(true);
    await expect(store.load({ correlation: { path: 'a;b', value: 1 } })).rejects.toThrow(
      /invalid payload path/,
    );
  });

  it('as-of loading (collectedUntil) replays exactly the evidence that existed at an instant', async () => {
    const early = await store.load({ collectedUntil: '2026-01-15T10:00:00.300Z' });
    expect(
      early.every(
        (r) => (r.kind === 'event' ? r.collectedAt : r.observedAt) <= '2026-01-15T10:00:00.300Z',
      ),
    ).toBe(true);
    expect(early.some((r) => r.kind === 'event' && r.type === 'invoice.created')).toBe(false);
    const later = await store.load({ collectedUntil: '2026-01-15T10:03:00.000Z' });
    expect(later.length).toBeGreaterThan(early.length);
  });

  it('evaluates identically from the store and from NDJSON', async () => {
    const rules = await loadRules(path.join(repoRoot, 'rules'));
    const clock = new FixedClock('2026-01-15T10:03:00Z');
    const dedicated = new PostgresEvidenceStore(pool, { schema: `${schema}_dup` });
    await dedicated.migrate();
    try {
      const records = await fixture('duplicate-invoice');
      await dedicated.appendAll(records);
      const fromStore = evaluateRules(rules, await dedicated.snapshot(), { clock });
      const fromFile = evaluateRules(rules, EvidenceSet.from(records), { clock });
      expect(fromStore).toEqual(fromFile);
      expect(fromStore[0]?.verdict).toBe('FAIL');
      expect(fromStore[0]?.reasons.map((r) => r.code)).toEqual(['DUPLICATE_OUTCOME']);
    } finally {
      await dedicated.destroy();
    }
  });

  it('is append-only at the database level: updates and deletes are refused', async () => {
    await expect(pool.query(`DELETE FROM ${schema}.evidence_events`)).rejects.toThrow(
      /append-only/,
    );
    await expect(
      pool.query(`UPDATE ${schema}.evidence_sources SET status = 'unavailable'`),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to hand back rows that violate the contract, even if written around the API', async () => {
    const rogue = new PostgresEvidenceStore(pool, { schema: `${schema}_rogue` });
    await rogue.migrate();
    try {
      await pool.query(
        `INSERT INTO ${schema}_rogue.evidence_sources (source, observed_at, status, authoritative, record, record_hash)
         VALUES ('x', now(), 'available', true, '{"kind":"source","source":"x"}'::jsonb, 'h')`,
      );
      await expect(rogue.load()).rejects.toThrow(EvidenceStoreError);
      await expect(rogue.load()).rejects.toThrow(/stored evidence violates the contract/);
    } finally {
      await rogue.destroy();
    }
  });

  it('rejects invalid records before touching the database and rolls back the batch', async () => {
    const before = await store.counts();
    const good = (await fixture('normal'))[0];
    if (good === undefined) throw new Error('fixture shape changed');
    const bad = { kind: 'event', eventId: 'e' } as unknown as EvidenceRecord;
    await expect(store.appendAll([{ ...good, source: 'batch-test' }, bad])).rejects.toThrow();
    expect(await store.counts()).toEqual(before);
  });

  it('redacts passwords in connection strings', () => {
    expect(redactConnectionString('postgres://bte:secret@localhost:5432/bte')).toBe(
      'postgres://bte:***@localhost:5432/bte',
    );
    expect(redactConnectionString('not a url')).toBe('<connection string>');
    expect(redactConnectionString('postgres://localhost/bte')).toBe('postgres://localhost/bte');
  });
});
