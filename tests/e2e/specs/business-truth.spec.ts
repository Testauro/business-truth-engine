import {
  BASKETS,
  CARDS,
  CUSTOMER,
  PAST_DEADLINE_MS,
  PAST_DELAYED_INVOICE_MS,
  RULE,
} from '../data/test-data.js';
import { expect, test } from '../fixtures/test.js';
import type { DemoApi, DemoFault } from '../api/demo-api.js';
import type { CheckoutPage } from '../pages/checkout.page.js';

/**
 * Drive the real checkout UI with the ordinary assertions, then independently
 * verify the order, the payment and the invoice from the systems of record.
 */
async function checkoutAndVerifyBusinessState(
  checkout: CheckoutPage,
  api: DemoApi,
): Promise<{ orderId: string; paymentId: string }> {
  const basket = BASKETS.twoLineFreeShipping;
  await checkout.goto();
  await checkout.setBasket(basket.quantities);
  await checkout.fillCustomer(CUSTOMER.id);
  await checkout.fillCard(CARDS.valid);
  const orderPage = await checkout.submit();
  await orderPage.expectPaymentReceived(basket.total);
  const orderId = await orderPage.orderId();

  // Independent checks against the systems of record, not the page.
  const order = await api.getOrder(orderId);
  expect(order).toMatchObject({
    status: 'paid',
    totalCents: 5_097,
    currency: 'USD',
    customerId: CUSTOMER.id,
  });
  if (order.paymentId === null) throw new Error('paid order without payment id');
  const payment = await api.getPayment(order.paymentId);
  expect(payment).toMatchObject({
    orderId,
    amount: basket.total,
    currency: 'USD',
    status: 'captured',
  });
  return { orderId, paymentId: order.paymentId };
}

async function seed(api: DemoApi, faults: readonly DemoFault[]): Promise<void> {
  await api.setFaults(faults);
}

test.describe('business truth: invoice-created-once', () => {
  test('happy path: PENDING while the window is open, PASS once the deadline has passed with complete evidence', async ({
    checkout,
    api,
    bte,
  }) => {
    const { orderId } = await checkoutAndVerifyBusinessState(checkout, api);
    expect((await api.getInvoices(orderId)).invoices).toHaveLength(1);

    bte.correlate({ orderId });
    await bte.collect();
    const early = await bte.evaluate(RULE.invoiceCreatedOnce, orderId);
    expect(early.verdict?.verdict).toBe('PENDING');
    expect(early.verdict?.reasons.map((r) => r.code)).toEqual(['WINDOW_OPEN']);

    await api.advanceClock(PAST_DEADLINE_MS);
    const verdict = await bte.expectInvariant(RULE.invoiceCreatedOnce, orderId);
    expect(verdict.reasons.map((r) => r.code)).toContain('OUTCOME_CONFIRMED');
    expect(verdict.expectations[0]?.source.completeThroughDeadline).toBe(true);
  });

  test('missing invoice: the UI test passes, BTE returns FAIL with the missing outcome', async ({
    checkout,
    api,
    bte,
  }) => {
    await seed(api, ['missing-invoice']);
    const { orderId, paymentId } = await checkoutAndVerifyBusinessState(checkout, api);
    expect((await api.getInvoices(orderId)).invoices).toHaveLength(0);

    await api.advanceClock(PAST_DEADLINE_MS);
    const verdict = await bte.expectVerdict(RULE.invoiceCreatedOnce, orderId, 'FAIL');
    const missing = verdict.reasons.find((r) => r.code === 'MISSING_EXPECTED_OUTCOME');
    expect(missing?.evidenceIds).toContain(`order.paid:${orderId}:${paymentId}`);
    expect(verdict.expectations[0]?.distinctInWindow).toBe(0);

    await expect(bte.expectInvariant(RULE.invoiceCreatedOnce, orderId)).rejects.toThrow(
      /expected BTE verdict PASS but got FAIL[\s\S]*MISSING_EXPECTED_OUTCOME/,
    );
  });

  test('duplicate invoice: FAIL citing both invoice events', async ({ checkout, api, bte }) => {
    await seed(api, ['duplicate-invoice']);
    const { orderId } = await checkoutAndVerifyBusinessState(checkout, api);
    const { invoices } = await api.getInvoices(orderId);
    expect(invoices).toHaveLength(2);

    await api.advanceClock(PAST_DEADLINE_MS);
    const verdict = await bte.expectVerdict(RULE.invoiceCreatedOnce, orderId, 'FAIL');
    const duplicate = verdict.reasons.find((r) => r.code === 'DUPLICATE_OUTCOME');
    expect(duplicate?.evidenceIds).toEqual(
      invoices.map((invoice) => `invoice.created:${invoice.invoiceId}`),
    );
    expect(verdict.expectations[0]?.distinctInWindow).toBe(2);
  });

  test('incorrect amount: FAIL naming the invoice value and the paid value', async ({
    checkout,
    api,
    bte,
  }) => {
    await seed(api, ['wrong-amount']);
    const { orderId, paymentId } = await checkoutAndVerifyBusinessState(checkout, api);
    const { invoices } = await api.getInvoices(orderId);
    expect(invoices[0]?.amount).toBe(24.99);

    await api.advanceClock(PAST_DEADLINE_MS);
    const verdict = await bte.expectVerdict(RULE.invoiceCreatedOnce, orderId, 'FAIL');
    const mismatch = verdict.reasons.find((r) => r.code === 'ASSERTION_MISMATCH');
    expect(mismatch?.message).toContain('"amount" is 24.99, expected equals 50.97');
    expect(mismatch?.evidenceIds).toEqual([
      `invoice.created:${invoices[0]?.invoiceId}`,
      `order.paid:${orderId}:${paymentId}`,
    ]);
  });

  test('unknown evidence: invoicing unavailable yields UNKNOWN, never PASS, and recovers to a real verdict', async ({
    checkout,
    api,
    bte,
  }) => {
    await seed(api, ['invoicing-unavailable']);
    const { orderId } = await checkoutAndVerifyBusinessState(checkout, api);
    expect((await api.getInvoices(orderId)).status).toBe(503);

    await api.advanceClock(PAST_DEADLINE_MS);
    const unknown = await bte.expectVerdict(RULE.invoiceCreatedOnce, orderId, 'UNKNOWN');
    expect(unknown.reasons.map((r) => r.code)).toContain('SOURCE_UNAVAILABLE');
    expect(unknown.expectations[0]?.source.status).toBe('unavailable');
    await expect(bte.expectInvariant(RULE.invoiceCreatedOnce, orderId)).rejects.toThrow(
      /expected BTE verdict PASS but got UNKNOWN[\s\S]*SOURCE_UNAVAILABLE/,
    );

    // The invoice was created all along; once the source answers, the truth is knowable.
    await api.setFaults([]);
    await api.advanceClock(1_000);
    await bte.expectInvariant(RULE.invoiceCreatedOnce, orderId);
  });

  test('delayed invoice: PENDING, then FAIL as a late outcome once it materialises', async ({
    checkout,
    api,
    bte,
  }) => {
    await seed(api, ['delayed-invoice']);
    const { orderId } = await checkoutAndVerifyBusinessState(checkout, api);
    expect((await api.state()).pendingInvoices).toBe(1);

    await api.advanceClock(60_000);
    await bte.collect();
    expect((await bte.evaluate(RULE.invoiceCreatedOnce, orderId)).verdict?.verdict).toBe('PENDING');

    const advanced = await api.advanceClock(PAST_DELAYED_INVOICE_MS - 60_000);
    expect(advanced.invoicesIssued).toBe(1);
    const verdict = await bte.expectVerdict(RULE.invoiceCreatedOnce, orderId, 'FAIL');
    expect(verdict.reasons.map((r) => r.code)).toContain('LATE_OUTCOME');
    expect(verdict.expectations[0]?.observations[0]?.placement).toBe('late');
  });

  test('collecting the same evidence twice does not fake a duplicate invoice', async ({
    checkout,
    api,
    bte,
  }) => {
    const { orderId } = await checkoutAndVerifyBusinessState(checkout, api);
    await api.advanceClock(PAST_DEADLINE_MS);
    // Two collections deliver every event twice; the engine must count each once.
    await bte.collect();
    await bte.collect();
    const verdict = await bte.expectInvariant(RULE.invoiceCreatedOnce, orderId);
    expect(verdict.reasons.map((r) => r.code)).toContain('REDELIVERY_DEDUPLICATED');
    expect(verdict.expectations[0]?.distinctInWindow).toBe(1);
  });

  test('settle never upgrades PENDING to PASS: without advancing the clock it reports PENDING explicitly', async ({
    checkout,
    api,
    bte,
  }) => {
    const { orderId } = await checkoutAndVerifyBusinessState(checkout, api);
    await expect(
      bte.settle(RULE.invoiceCreatedOnce, orderId, { timeout: 1_500, intervals: [200] }),
    ).rejects.toThrow(/did not settle[\s\S]*WINDOW_OPEN/);
  });
});
