import { afterEach, describe, expect, it } from 'vitest';
import { parseEvidenceNdjson } from '@bte/evidence';
import { CATALOG, type Invoice, type Order, type Payment } from '../src/index.js';
import {
  CHECKOUT_FORM,
  EXPECTED_TOTAL,
  checkoutViaUi,
  startDemo,
  type Harness,
} from './helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.demo.app.close();
  h = undefined;
});

describe('checkout UI', () => {
  it('renders the catalog with accessible form controls', async () => {
    h = await startDemo();
    const response = await h.demo.app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    for (const product of CATALOG) {
      expect(response.body).toContain(product.name);
      expect(response.body).toContain(`id="qty-${product.sku}"`);
    }
    expect(response.body).toContain('<label for="cardNumber">');
  });

  it('places an order, captures payment, and confirms success to the customer', async () => {
    h = await startDemo();
    const { orderId, page } = await checkoutViaUi(h);
    expect(orderId).toBe('ord_0001');
    expect(page).toContain('Order confirmed. Payment received: $50.97');
    expect(page).toContain('data-testid="order-total">$50.97');
    const order = h.demo.orders.require(orderId);
    expect(order.status).toBe('paid');
    expect(order.shippingCents).toBe(0);
    expect(order.totalCents).toBe(Math.round(EXPECTED_TOTAL * 100));
  });

  it('charges shipping under the free-shipping threshold', async () => {
    h = await startDemo();
    const response = await h.demo.app.inject({
      method: 'POST',
      url: '/checkout',
      payload: { ...CHECKOUT_FORM, 'qty_BTE-TEE': '1', 'qty_BTE-MUG': '0' },
    });
    expect(response.statusCode).toBe(303);
    const order = h.demo.orders.require('ord_0001');
    expect(order.subtotalCents).toBe(2_499);
    expect(order.shippingCents).toBe(499);
    expect(order.totalCents).toBe(2_998);
  });

  it('rejects an empty cart and an invalid card without creating an order', async () => {
    h = await startDemo();
    const empty = await h.demo.app.inject({
      method: 'POST',
      url: '/checkout',
      payload: { ...CHECKOUT_FORM, 'qty_BTE-TEE': '0', 'qty_BTE-MUG': '0' },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.body).toContain('Add at least one item');
    const badCard = await h.demo.app.inject({
      method: 'POST',
      url: '/checkout',
      payload: { ...CHECKOUT_FORM, cardNumber: '12' },
    });
    expect(badCard.statusCode).toBe(400);
    expect(h.demo.orders.list()).toHaveLength(0);
  });

  it('shows a decline and leaves the order unpaid', async () => {
    h = await startDemo();
    const response = await h.demo.app.inject({
      method: 'POST',
      url: '/checkout',
      payload: { ...CHECKOUT_FORM, cardNumber: '4242424242420000' },
    });
    expect(response.statusCode).toBe(402);
    expect(response.body).toContain('Your card was declined');
    expect(h.demo.orders.require('ord_0001').status).toBe('created');
    expect(h.demo.invoicing.list()).toHaveLength(0);
  });

  it('escapes customer-controlled text in HTML', async () => {
    h = await startDemo();
    const response = await h.demo.app.inject({
      method: 'POST',
      url: '/checkout',
      payload: { ...CHECKOUT_FORM, customerId: '<script>alert(1)</script>' },
    });
    expect(response.statusCode).toBe(303);
    const page = await h.demo.app.inject({ method: 'GET', url: '/orders/ord_0001' });
    expect(page.body).not.toContain('<script>alert(1)</script>');
  });

  it('returns 404 for an unknown order', async () => {
    h = await startDemo();
    const response = await h.demo.app.inject({ method: 'GET', url: '/orders/ord_9999' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'order ord_9999 not found' });
  });
});

describe('JSON API', () => {
  it('creates, pays, and reads an order; invoicing reacts', async () => {
    h = await startDemo();
    const created = await h.demo.app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { customerId: 'cus_api', lines: [{ sku: 'BTE-BOOK', quantity: 2 }] },
    });
    expect(created.statusCode).toBe(201);
    const order = created.json<Order>();
    expect(order.totalCents).toBe(7_800);

    const paid = await h.demo.app.inject({
      method: 'POST',
      url: `/api/orders/${order.orderId}/pay`,
      payload: { cardNumber: '5555444433331111' },
    });
    expect(paid.statusCode).toBe(201);
    const payment = paid.json<Payment>();
    expect(payment).toMatchObject({
      orderId: order.orderId,
      amount: 78,
      currency: 'USD',
      status: 'captured',
      cardLast4: '1111',
    });

    const fetched = await h.demo.app.inject({ method: 'GET', url: `/api/orders/${order.orderId}` });
    expect(fetched.json<Order>()).toMatchObject({ status: 'paid', paymentId: payment.paymentId });

    const invoices = await h.demo.app.inject({
      method: 'GET',
      url: `/api/invoices?orderId=${order.orderId}`,
    });
    expect(invoices.json<Invoice[]>()).toEqual([
      expect.objectContaining({
        invoiceId: 'inv_0001',
        orderId: order.orderId,
        amount: 78,
        currency: 'USD',
      }),
    ]);
  });

  it('refuses to pay twice and validates input', async () => {
    h = await startDemo();
    const created = await h.demo.app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { customerId: 'cus_api', lines: [{ sku: 'BTE-MUG', quantity: 1 }] },
    });
    const { orderId } = created.json<Order>();
    const first = await h.demo.app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      payload: { cardNumber: '4242424242424242' },
    });
    expect(first.statusCode).toBe(201);
    const second = await h.demo.app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/pay`,
      payload: { cardNumber: '4242424242424242' },
    });
    expect(second.statusCode).toBe(409);
    const badSku = await h.demo.app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { customerId: 'x', lines: [{ sku: 'NOPE', quantity: 1 }] },
    });
    expect(badSku.statusCode).toBe(400);
    const badBody = await h.demo.app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: { customerId: '' },
    });
    expect(badBody.statusCode).toBe(400);
    expect(badBody.json()).toHaveProperty('error', 'invalid request');
    const missing = await h.demo.app.inject({
      method: 'POST',
      url: '/api/orders/ord_4242/pay',
      payload: { cardNumber: '4242424242424242' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('reports 503 when invoicing is unavailable, while checkout still succeeds', async () => {
    h = await startDemo(['invoicing-unavailable']);
    const { page } = await checkoutViaUi(h);
    expect(page).toContain('Payment received');
    const invoices = await h.demo.app.inject({ method: 'GET', url: '/api/invoices' });
    expect(invoices.statusCode).toBe(503);
    expect(invoices.json()).toEqual({ error: 'invoicing system of record is unavailable' });
  });
});

describe('admin and evidence endpoints', () => {
  it('toggles faults via JSON and HTML form, rejecting unknown names', async () => {
    h = await startDemo();
    const put = await h.demo.app.inject({
      method: 'PUT',
      url: '/admin/faults',
      payload: { faults: ['wrong-amount', 'missing-invoice'] },
    });
    expect(put.json()).toEqual({ active: ['missing-invoice', 'wrong-amount'] });
    const get = await h.demo.app.inject({
      method: 'GET',
      url: '/admin/faults',
      headers: { accept: 'application/json' },
    });
    expect(get.json()).toMatchObject({ active: ['missing-invoice', 'wrong-amount'] });
    const form = await h.demo.app.inject({
      method: 'POST',
      url: '/admin/faults',
      payload: { faults: 'duplicate-invoice' },
    });
    expect(form.statusCode).toBe(303);
    expect(h.demo.faults.list()).toEqual(['duplicate-invoice']);
    const html = await h.demo.app.inject({ method: 'GET', url: '/admin/faults' });
    expect(html.body).toContain('value="duplicate-invoice" checked');
    const clear = await h.demo.app.inject({ method: 'POST', url: '/admin/faults', payload: {} });
    expect(clear.statusCode).toBe(303);
    expect(h.demo.faults.list()).toEqual([]);
    const bad = await h.demo.app.inject({
      method: 'PUT',
      url: '/admin/faults',
      payload: { faults: ['explode'] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('collects evidence on demand and serves it as NDJSON', async () => {
    h = await startDemo();
    await checkoutViaUi(h);
    const collect = await h.demo.app.inject({ method: 'POST', url: '/evidence/collect' });
    expect(collect.json()).toMatchObject({
      recordCount: 4,
      sources: { orders: 'available', invoicing: 'available' },
      totalRecords: 4,
    });
    const ndjson = await h.demo.app.inject({ method: 'GET', url: '/evidence' });
    expect(ndjson.headers['content-type']).toContain('application/x-ndjson');
    const records = parseEvidenceNdjson(ndjson.body, '/evidence');
    expect(records.map((r) => (r.kind === 'event' ? r.type : `source:${r.source}`))).toEqual([
      'order.paid',
      'source:orders',
      'invoice.created',
      'source:invoicing',
    ]);
  });

  it('exposes state for debugging', async () => {
    h = await startDemo(['delayed-invoice']);
    await checkoutViaUi(h);
    const state = await h.demo.app.inject({ method: 'GET', url: '/admin/state' });
    expect(state.json()).toMatchObject({
      now: '2026-01-15T10:00:00.000Z',
      faults: ['delayed-invoice'],
      pendingInvoices: 1,
    });
  });
});

describe('clock control', () => {
  it('reports a controllable clock and advances it, issuing delayed invoices', async () => {
    h = await startDemo(['delayed-invoice']);
    await checkoutViaUi(h);
    const before = await h.demo.app.inject({ method: 'GET', url: '/admin/clock' });
    expect(before.json()).toEqual({ now: '2026-01-15T10:00:00.000Z', controllable: true });
    const advanced = await h.demo.app.inject({
      method: 'POST',
      url: '/admin/clock/advance',
      payload: { ms: 150_000 },
    });
    expect(advanced.json()).toEqual({
      now: '2026-01-15T10:02:30.000Z',
      advancedMs: 150_000,
      invoicesIssued: 1,
    });
    const bad = await h.demo.app.inject({
      method: 'POST',
      url: '/admin/clock/advance',
      payload: { ms: -1 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('refuses to advance a system clock', async () => {
    const { SystemClock } = await import('@bte/core');
    const { buildDemo } = await import('../src/index.js');
    const demo = buildDemo({ clock: new SystemClock() });
    await demo.app.ready();
    const response = await demo.app.inject({
      method: 'POST',
      url: '/admin/clock/advance',
      payload: { ms: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect((await demo.app.inject({ method: 'GET', url: '/admin/clock' })).json()).toMatchObject({
      controllable: false,
    });
    await demo.app.close();
  });

  it('the event bus keeps an ordered log of published events', async () => {
    h = await startDemo();
    await checkoutViaUi(h);
    expect(h.demo.bus.log.map((e) => e.type)).toEqual(['order.paid']);
    expect(h.demo.bus.now()).toBe('2026-01-15T10:00:00.000Z');
  });
});
