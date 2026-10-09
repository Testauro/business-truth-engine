import { BASKETS, CARDS, CUSTOMER } from '../data/test-data.js';
import { expect, test } from '../fixtures/test.js';

/**
 * The ordinary UI suite. These are the assertions a team normally ships with,
 * and they are correct: the checkout really does work. They say nothing about
 * invoices, which is why they stay green when invoicing is broken.
 */
test.describe('checkout UI', () => {
  test('places an order and confirms payment', async ({ checkout }) => {
    await checkout.goto();
    await checkout.setBasket(BASKETS.twoLineFreeShipping.quantities);
    await checkout.fillCustomer(CUSTOMER.id);
    await checkout.fillCard(CARDS.valid);
    const order = await checkout.submit();
    await order.expectPaymentReceived(BASKETS.twoLineFreeShipping.total);
    await expect(order.page).toHaveURL(/\/orders\/ord_\d+$/);
  });

  test('charges shipping below the free-shipping threshold', async ({ checkout }) => {
    await checkout.goto();
    await checkout.setBasket(BASKETS.singleWithShipping.quantities);
    await checkout.fillCard(CARDS.valid);
    const order = await checkout.submit();
    await order.expectPaymentReceived(BASKETS.singleWithShipping.total);
    await expect(order.page.getByRole('row', { name: /Shipping/ })).toContainText('$4.99');
  });

  test('shows a decline without confirming the order', async ({ checkout, page }) => {
    await checkout.goto();
    await checkout.setBasket(BASKETS.singleWithShipping.quantities);
    await checkout.fillCard(CARDS.declined);
    await checkout.submitExpectingError('Your card was declined');
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('rejects an empty cart', async ({ checkout }) => {
    await checkout.goto();
    await checkout.setBasket({});
    await checkout.submitExpectingError('Add at least one item');
  });
});
