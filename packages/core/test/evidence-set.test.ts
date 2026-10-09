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
