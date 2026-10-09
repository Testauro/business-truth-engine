import { BASKETS, CARDS, CUSTOMER, PAST_DEADLINE_MS, RULE } from '../data/test-data.js';
import { test } from '../fixtures/test.js';

/**
 * The demonstration, run with `pnpm test:e2e:demonstration`. It is excluded
 * from the gate because the second test FAILS BY DESIGN: the same checkout
 * passes every ordinary UI assertion, and BTE then proves the invoice is
 * missing. Compare the two results in the report.
 */
test.describe('@demonstration missing invoice', () => {
  test.describe.configure({ mode: 'serial' });

  test('ordinary checkout UI test (passes)', async ({ checkout, api }) => {
    await api.setFaults(['missing-invoice']);
    await checkout.goto();
    await checkout.setBasket(BASKETS.twoLineFreeShipping.quantities);
    await checkout.fillCustomer(CUSTOMER.id);
    await checkout.fillCard(CARDS.valid);
    const order = await checkout.submit();
    await order.expectPaymentReceived(BASKETS.twoLineFreeShipping.total);
  });

  test('same checkout verified by BTE (fails by design)', async ({ checkout, api, bte }) => {
    await api.setFaults(['missing-invoice']);
    await checkout.goto();
    await checkout.setBasket(BASKETS.twoLineFreeShipping.quantities);
    await checkout.fillCustomer(CUSTOMER.id);
    await checkout.fillCard(CARDS.valid);
    const order = await checkout.submit();
    await order.expectPaymentReceived(BASKETS.twoLineFreeShipping.total);
    const orderId = await order.orderId();

    await api.advanceClock(PAST_DEADLINE_MS);
    await bte.expectInvariant(RULE.invoiceCreatedOnce, orderId);
  });
});
