import { describe, expect, it } from 'vitest';
import { EvidenceSet } from '../src/index.js';
import { at, invoiceCreated, invoicingStatus, orderPaid } from './helpers.js';

describe('EvidenceSet', () => {
  it('collapses redeliveries of the same eventId and keeps the earliest-collected delivery', () => {
    const first = invoiceCreated({ collectedAt: at(5_300), deliveryId: 'd-1' });
    const second = invoiceCreated({ collectedAt: at(9_000), deliveryId: 'd-2' });
    const set = EvidenceSet.from([second, first]);
    expect(set.size).toBe(1);
    const event = set.event('evt-inv-1');
    expect(event?.canonical.deliveryId).toBe('d-1');
    expect(event?.deliveries).toHaveLength(2);
    expect(event?.conflicting).toBe(false);
  });

  it('flags redeliveries whose business content disagrees', () => {
    const first = invoiceCreated({ deliveryId: 'd-1' });
    const second = invoiceCreated({
      deliveryId: 'd-2',
      collectedAt: at(9_000),
      payload: { invoiceId: 'inv_1', orderId: 'ord_1', amount: 1, currency: 'USD' },
    });
    expect(EvidenceSet.from([first, second]).event('evt-inv-1')?.conflicting).toBe(true);
  });

  it('keeps distinct eventIds distinct even with identical payloads', () => {
    const a = invoiceCreated({ eventId: 'a' });
    const b = invoiceCreated({ eventId: 'b' });
    expect(EvidenceSet.from([a, b]).eventsOfType('invoice.created')).toHaveLength(2);
  });

  it('is independent of record order', () => {
    const records = [orderPaid(), invoiceCreated(), invoicingStatus()];
    const forward = EvidenceSet.from(records);
    const reversed = EvidenceSet.from([...records].reverse());
    expect(reversed.events).toEqual(forward.events);
    expect(reversed.sources).toEqual(forward.sources);
  });

  it('uses the latest attestation per source', () => {
    const older = invoicingStatus({ observedAt: at(1_000), status: 'unavailable' });
    const newer = invoicingStatus({ observedAt: at(2_000), status: 'available' });
    expect(EvidenceSet.from([newer, older]).sourceStatus('invoicing')?.status).toBe('available');
    expect(EvidenceSet.from([older, newer]).sourceStatus('invoicing')?.status).toBe('available');
  });

  it('sorts events by occurredAt, then collectedAt, then eventId', () => {
    const late = invoiceCreated({ eventId: 'z', occurredAt: at(10) });
    const early = invoiceCreated({ eventId: 'a', occurredAt: at(5) });
    const sameTimeB = invoiceCreated({ eventId: 'b', occurredAt: at(5), collectedAt: at(5) });
    const ids = EvidenceSet.from([late, early, sameTimeB])
      .eventsOfType('invoice.created')
      .map((e) => e.canonical.eventId);
    expect(ids).toEqual(['b', 'a', 'z']);
  });
});

describe('EvidenceSet edge cases', () => {
  it('on an attestation tie, the non-authoritative (conservative) one wins regardless of order', () => {
    const trusted = invoicingStatus({ observedAt: at(1_000), authoritative: true });
    const cached = invoicingStatus({ observedAt: at(1_000), authoritative: false });
    expect(EvidenceSet.from([trusted, cached]).sourceStatus('invoicing')?.authoritative).toBe(
      false,
    );
    expect(EvidenceSet.from([cached, trusted]).sourceStatus('invoicing')?.authoritative).toBe(
      false,
    );
  });

  it('orders deliveries by collectedAt, then deliveryId, and falls back to empty ids', () => {
    const a = invoiceCreated({ collectedAt: at(5_000), deliveryId: 'b' });
    const b = invoiceCreated({ collectedAt: at(5_000), deliveryId: 'a' });
    const c = invoiceCreated({ collectedAt: at(5_000) });
    const set = EvidenceSet.from([a, b, c]);
    expect(set.event('evt-inv-1')?.deliveries.map((d) => d.deliveryId)).toEqual([
      undefined,
      'a',
      'b',
    ]);
  });

  it('exposes empty sets and sorted sources', () => {
    expect(EvidenceSet.empty().size).toBe(0);
    expect(EvidenceSet.empty().events).toEqual([]);
    const set = EvidenceSet.from([invoicingStatus(), { ...invoicingStatus(), source: 'orders' }]);
    expect(set.sources.map((s) => s.source)).toEqual(['invoicing', 'orders']);
  });

  it('breaks occurredAt/collectedAt ties by eventId then deliveryId in type listings', () => {
    const x = invoiceCreated({ eventId: 'same', deliveryId: 'y' });
    const y = invoiceCreated({ eventId: 'same', deliveryId: 'x' });
    const z = invoiceCreated({ eventId: 'other' });
    const ids = EvidenceSet.from([x, y, z])
      .eventsOfType('invoice.created')
      .map((e) => e.canonical.eventId);
    expect(ids).toEqual(['other', 'same']);
  });
});

describe('EvidenceSet determinism under full ties', () => {
  it('picks the same canonical delivery when eventId, collectedAt and deliveryId all tie but content differs', () => {
    const cheap = invoiceCreated({
      payload: { invoiceId: 'inv_1', orderId: 'ord_1', amount: 1, currency: 'USD' },
    });
    const dear = invoiceCreated({
      payload: { invoiceId: 'inv_1', orderId: 'ord_1', amount: 49.99, currency: 'USD' },
    });
    const forward = EvidenceSet.from([cheap, dear]).event('evt-inv-1');
    const reversed = EvidenceSet.from([dear, cheap]).event('evt-inv-1');
    expect(forward?.canonical).toEqual(reversed?.canonical);
    expect(forward?.conflicting).toBe(true);
    expect(reversed?.deliveries).toEqual(forward?.deliveries);
  });
});
