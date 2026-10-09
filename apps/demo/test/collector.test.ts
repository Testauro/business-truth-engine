import { describe, expect, it } from 'vitest';
import { ManualClock } from '@bte/core';
import {
  EvidenceCollector,
  InvoicingUnavailableError,
  type Invoice,
  type Order,
} from '../src/index.js';

const paidOrder: Order = {
  orderId: 'ord_0001',
  customerId: 'cus_demo',
  currency: 'USD',
  lines: [],
  subtotalCents: 5_097,
  shippingCents: 0,
  totalCents: 5_097,
  status: 'paid',
  createdAt: '2026-01-15T10:00:00.000Z',
  paidAt: '2026-01-15T10:00:00.000Z',
  paymentId: 'pay_0001',
};

const invoice: Invoice = {
  invoiceId: 'inv_0001',
  orderId: 'ord_0001',
  paymentId: 'pay_0001',
  customerId: 'cus_demo',
  amount: 50.97,
  currency: 'USD',
  createdAt: '2026-01-15T10:00:00.000Z',
};

describe('EvidenceCollector', () => {
  it('derives events from authoritative state and attests both sources with a watermark', () => {
    const clock = new ManualClock('2026-01-15T10:02:05.000Z');
    const collector = new EvidenceCollector({
      clock,
      orders: { listPaidOrders: () => [paidOrder] },
      invoices: { listInvoices: () => [invoice] },
    });
    const result = collector.collect();
    expect(result.collectedAt).toBe('2026-01-15T10:02:05.000Z');
    expect(result.records).toEqual([
      expect.objectContaining({
        kind: 'event',
        eventId: 'order.paid:ord_0001:pay_0001',
        type: 'order.paid',
        source: 'orders',
        occurredAt: '2026-01-15T10:00:00.000Z',
        collectedAt: '2026-01-15T10:02:05.000Z',
        deliveryId: 'dlv_0001',
        payload: {
          orderId: 'ord_0001',
          paymentId: 'pay_0001',
          customerId: 'cus_demo',
          amount: 50.97,
          currency: 'USD',
        },
      }),
      expect.objectContaining({
        kind: 'source',
        source: 'orders',
        status: 'available',
        authoritative: true,
        completeThrough: '2026-01-15T10:02:05.000Z',
      }),
      expect.objectContaining({
        kind: 'event',
        eventId: 'invoice.created:inv_0001',
        type: 'invoice.created',
        source: 'invoicing',
        deliveryId: 'dlv_0002',
        payload: {
          invoiceId: 'inv_0001',
          orderId: 'ord_0001',
          paymentId: 'pay_0001',
          amount: 50.97,
          currency: 'USD',
        },
      }),
      expect.objectContaining({
        kind: 'source',
        source: 'invoicing',
        status: 'available',
        authoritative: true,
        completeThrough: '2026-01-15T10:02:05.000Z',
      }),
    ]);
  });

  it('records the invoicing source as unavailable instead of pretending there are no invoices', () => {
    const collector = new EvidenceCollector({
      clock: new ManualClock('2026-01-15T10:02:05.000Z'),
      orders: { listPaidOrders: () => [paidOrder] },
      invoices: {
        listInvoices: () => {
          throw new InvoicingUnavailableError();
        },
      },
    });
    const result = collector.collect();
    expect(result.sources).toEqual({ orders: 'available', invoicing: 'unavailable' });
    const invoicing = result.records.find((r) => r.kind === 'source' && r.source === 'invoicing');
    expect(invoicing).toMatchObject({
      status: 'unavailable',
      authoritative: true,
      note: 'invoicing system of record is unavailable',
    });
    expect(invoicing).not.toHaveProperty('completeThrough');
    expect(
      result.records.filter((r) => r.kind === 'event' && r.type === 'invoice.created'),
    ).toHaveLength(0);
  });

  it('emits each event twice with distinct delivery ids under duplicate-delivery, and the set still dedups', () => {
    const collector = new EvidenceCollector({
      clock: new ManualClock('2026-01-15T10:02:05.000Z'),
      orders: { listPaidOrders: () => [paidOrder] },
      invoices: { listInvoices: () => [invoice] },
      duplicateDelivery: () => true,
    });
    const result = collector.collect();
    const events = result.records.filter((r) => r.kind === 'event');
    expect(events).toHaveLength(4);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(2);
    expect(new Set(events.map((e) => e.deliveryId)).size).toBe(4);
    expect(collector.snapshot().size).toBe(2);
  });

  it('repeated collections append (never overwrite) and the latest attestation wins', () => {
    const clock = new ManualClock('2026-01-15T10:00:30.000Z');
    let available = false;
    const collector = new EvidenceCollector({
      clock,
      orders: { listPaidOrders: () => [paidOrder] },
      invoices: {
        listInvoices: () => {
          if (!available) throw new InvoicingUnavailableError();
          return [invoice];
        },
      },
    });
    collector.collect();
    clock.advance(60_000);
    available = true;
    collector.collect();
    expect(collector.records).toHaveLength(3 + 4);
    const snapshot = collector.snapshot();
    expect(snapshot.sourceStatus('invoicing')).toMatchObject({
      status: 'available',
      observedAt: '2026-01-15T10:01:30.000Z',
    });
    expect(snapshot.event('order.paid:ord_0001:pay_0001')?.deliveries).toHaveLength(2);
  });

  it('refuses to fabricate a payment for an order marked paid without one', () => {
    const collector = new EvidenceCollector({
      clock: new ManualClock('2026-01-15T10:00:30.000Z'),
      orders: { listPaidOrders: () => [{ ...paidOrder, paymentId: null }] },
      invoices: { listInvoices: () => [] },
    });
    expect(() => collector.collect()).toThrow(/without payment details/);
  });
});
