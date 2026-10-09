import { describe, expect, it } from 'vitest';
import type { EvidenceSource } from '../src/index.js';
import { MappingError, attestation, collectAll, mapItems } from '../src/index.js';

const NOW = Date.parse('2026-01-15T10:03:00.000Z');

describe('attestation', () => {
  it('builds a contract-valid attestation with optional watermark and note', () => {
    expect(attestation('ledger', NOW, { completeThrough: NOW, note: 'snapshot' })).toEqual({
      kind: 'source',
      source: 'ledger',
      observedAt: '2026-01-15T10:03:00.000Z',
      status: 'available',
      authoritative: true,
      completeThrough: '2026-01-15T10:03:00.000Z',
      note: 'snapshot',
    });
    expect(
      attestation('cache', NOW, { status: 'unavailable', authoritative: false }),
    ).not.toHaveProperty('completeThrough');
  });
});

describe('collectAll', () => {
  const good: EvidenceSource = {
    name: 'orders',
    collect: () => Promise.resolve([attestation('orders', NOW, { completeThrough: NOW })]),
  };
  const broken: EvidenceSource = {
    name: 'invoicing',
    authoritative: true,
    collect: () => Promise.reject(new Error('ECONNREFUSED 10.0.0.5:5432')),
  };

  it('merges records and turns a throwing source into an unavailable attestation, never into silence', async () => {
    const result = await collectAll([good, broken], { now: NOW });
    expect(result.failures).toEqual([{ source: 'invoicing', error: 'ECONNREFUSED 10.0.0.5:5432' }]);
    expect(result.records).toHaveLength(2);
    expect(result.records[1]).toMatchObject({
      kind: 'source',
      source: 'invoicing',
      status: 'unavailable',
      authoritative: true,
      note: 'collect failed: ECONNREFUSED 10.0.0.5:5432',
    });
  });

  it('passes the context through and keeps source order', async () => {
    const seen: unknown[] = [];
    const probe: EvidenceSource = {
      name: 'p',
      collect: (ctx) => {
        seen.push(ctx);
        return Promise.resolve([]);
      },
    };
    await collectAll([probe], { now: NOW, correlation: { orderId: 'o1' } });
    expect(seen).toEqual([{ now: NOW, correlation: { orderId: 'o1' } }]);
  });
});

describe('mapItems', () => {
  const mapping = {
    type: 'enrollment.confirmed',
    items: 'data.enrollments',
    eventId: { template: 'enrollment:${id}' },
    occurredAt: 'confirmedAt',
    deliveryId: 'revision',
    payload: {
      enrollmentId: 'id',
      learnerId: 'learner.id',
      courseId: 'course',
      tier: { const: 'standard' },
    },
  } as const;
  const body = {
    data: {
      enrollments: [
        {
          id: 'e1',
          confirmedAt: '2026-01-15T10:00:00Z',
          revision: 3,
          learner: { id: 'l1' },
          course: 'c1',
        },
        { id: 'e2', confirmedAt: 1768471200000, revision: 1, learner: { id: 'l2' }, course: 'c2' },
      ],
    },
  };

  it('maps paths, templates, constants and both timestamp forms into contract-valid events', () => {
    const result = mapItems(mapping, body, { source: 'lms', collectedAt: NOW });
    expect(result.problems).toEqual([]);
    expect(result.events).toEqual([
      {
        kind: 'event',
        eventId: 'enrollment:e1',
        type: 'enrollment.confirmed',
        source: 'lms',
        occurredAt: '2026-01-15T10:00:00.000Z',
        collectedAt: '2026-01-15T10:03:00.000Z',
        deliveryId: '3',
        payload: { enrollmentId: 'e1', learnerId: 'l1', courseId: 'c1', tier: 'standard' },
      },
      expect.objectContaining({
        eventId: 'enrollment:e2',
        occurredAt: '2026-01-15T10:00:00.000Z',
        deliveryId: '1',
      }),
    ]);
  });

  it('a template whose placeholder is missing yields no value, never a truncated id', () => {
    const result = mapItems(
      { ...mapping, items: undefined },
      { confirmedAt: '2026-01-15T10:00:00Z', learner: { id: 'l' }, course: 'c', id: undefined },
      { source: 's', collectedAt: NOW },
    );
    expect(result.events).toEqual([]);
    expect(result.problems.map((p) => p.field)).toEqual(['eventId', 'payload.enrollmentId']);
  });

  it('reports every problem with item index and field instead of dropping items', () => {
    const bad = {
      data: {
        enrollments: [
          { id: 'e1', confirmedAt: 'yesterday', learner: {}, course: 'c1' },
          { confirmedAt: '2026-01-15T10:00:00Z', learner: { id: 'l' }, course: 'c' },
        ],
      },
    };
    const result = mapItems(mapping, bad, { source: 'lms', collectedAt: NOW });
    expect(result.events).toEqual([]);
    expect(result.problems).toEqual([
      {
        index: 0,
        field: 'occurredAt',
        message: 'expected ISO-8601 or epoch millis, got "yesterday"',
      },
      { index: 0, field: 'payload.learnerId', message: 'no value at the mapped path' },
      { index: 1, field: 'eventId', message: 'expected a string or number, got undefined' },
      { index: 1, field: 'payload.enrollmentId', message: 'no value at the mapped path' },
    ]);
    const error = new MappingError('lms', result.problems);
    expect(error.message).toContain('mapping for source "lms" failed on 4 item(s): #0 occurredAt');
  });

  it('{ now: true } stamps a state snapshot with the collection instant', () => {
    const snapshot = {
      type: 'employee.record',
      items: 'data',
      eventId: { template: 'employee:${empNumber}' },
      occurredAt: { now: true },
      payload: { empNumber: 'empNumber', lastName: 'lastName', seenAt: { now: true } },
    } as const;
    const result = mapItems(
      snapshot,
      { data: { empNumber: 7, lastName: 'Doe' } },
      { source: 'hr', collectedAt: NOW },
    );
    expect(result.problems).toEqual([]);
    expect(result.events[0]).toMatchObject({
      eventId: 'employee:7',
      occurredAt: '2026-01-15T10:03:00.000Z',
      payload: { empNumber: 7, lastName: 'Doe', seenAt: NOW },
    });
  });

  it('applies filters, accepts a bare array or a single object, and tolerates a missing items path', () => {
    const single = mapItems(
      { ...mapping, items: undefined, filter: { path: 'course', equals: 'c1' } },
      {
        id: 'x',
        confirmedAt: '2026-01-15T10:00:00Z',
        revision: 1,
        learner: { id: 'l' },
        course: 'c1',
      },
      { source: 's', collectedAt: NOW },
    );
    expect(single.events).toHaveLength(1);
    const filtered = mapItems(
      { ...mapping, items: undefined, filter: { path: 'course', equals: 'c9' } },
      [
        {
          id: 'x',
          confirmedAt: '2026-01-15T10:00:00Z',
          revision: 1,
          learner: { id: 'l' },
          course: 'c1',
        },
      ],
      { source: 's', collectedAt: NOW },
    );
    expect(filtered.events).toHaveLength(0);
    expect(mapItems(mapping, { data: {} }, { source: 's', collectedAt: NOW })).toEqual({
      events: [],
      problems: [],
    });
  });
});
