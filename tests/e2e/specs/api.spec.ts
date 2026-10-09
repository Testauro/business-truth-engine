import { CARDS, CUSTOMER } from '../data/test-data.js';
import { expect, test } from '../fixtures/test.js';

test.describe('demo JSON API', () => {
  test('creates, pays and reads an order; invoicing reacts', async ({ api }) => {
    const order = await api.createOrder(CUSTOMER.id, [{ sku: 'BTE-BOOK', quantity: 2 }]);
    expect(order.status).toBe('created');
    expect(order.totalCents).toBe(7_800);

    const payment = await api.pay(order.orderId, CARDS.valid);
    expect(payment).toMatchObject({
      orderId: order.orderId,
      amount: 78,
      currency: 'USD',
      status: 'captured',
    });

    const paid = await api.getOrder(order.orderId);
    expect(paid).toMatchObject({ status: 'paid', paymentId: payment.paymentId });

    const invoices = await api.getInvoices(order.orderId);
    expect(invoices.status).toBe(200);
    expect(invoices.invoices).toHaveLength(1);
    expect(invoices.invoices[0]).toMatchObject({ orderId: order.orderId, amount: 78 });
  });

  test('refuses double payment and declines bad cards', async ({ api }) => {
    const order = await api.createOrder(CUSTOMER.id, [{ sku: 'BTE-MUG', quantity: 1 }]);
    const declined = await api.payRaw(order.orderId, CARDS.declined);
    expect(declined).toEqual({ status: 402, error: 'card declined' });
    await api.pay(order.orderId, CARDS.valid);
    const again = await api.payRaw(order.orderId, CARDS.valid);
    expect(again.status).toBe(409);
  });

  test('faults are toggled at runtime and the clock is controllable', async ({ api }) => {
    expect(await api.setFaults(['wrong-amount', 'missing-invoice'])).toEqual([
      'missing-invoice',
      'wrong-amount',
    ]);
    expect((await api.state()).faults).toEqual(['missing-invoice', 'wrong-amount']);
    const clock = await api.clock();
    expect(clock.controllable).toBe(true);
    const advanced = await api.advanceClock(1_000);
    expect(Date.parse(advanced.now) - Date.parse(clock.now)).toBe(1_000);
  });

  test('invoicing-unavailable makes the invoice query fail while payment still succeeds', async ({
    api,
  }) => {
    await api.setFaults(['invoicing-unavailable']);
    const order = await api.createOrder(CUSTOMER.id, [{ sku: 'BTE-TEE', quantity: 1 }]);
    const payment = await api.pay(order.orderId, CARDS.valid);
    expect(payment.status).toBe('captured');
    expect((await api.getInvoices(order.orderId)).status).toBe(503);
  });
});
