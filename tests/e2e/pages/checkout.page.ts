import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { PRODUCT_LABELS } from '../data/test-data.js';
import { OrderPage } from './order.page.js';

/** Page object for `/`. Locators are role/label based; no CSS selectors. */
export class CheckoutPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly customerId: Locator;
  readonly cardNumber: Locator;
  readonly placeOrder: Locator;
  readonly alert: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Checkout' });
    this.customerId = page.getByLabel('Customer id');
    this.cardNumber = page.getByLabel('Card number');
    this.placeOrder = page.getByRole('button', { name: 'Place order and pay' });
    this.alert = page.getByRole('alert');
  }

  async goto(): Promise<this> {
    await this.page.goto('/');
    await expect(this.heading).toBeVisible();
    return this;
  }

  quantity(sku: string): Locator {
    const label = PRODUCT_LABELS[sku];
    if (label === undefined) throw new Error(`unknown sku ${sku}`);
    return this.page.getByRole('spinbutton', { name: label });
  }

  async setBasket(quantities: Readonly<Record<string, number>>): Promise<void> {
    for (const sku of Object.keys(PRODUCT_LABELS)) {
      await this.quantity(sku).fill(String(quantities[sku] ?? 0));
    }
  }

  async fillCustomer(customerId: string): Promise<void> {
    await this.customerId.fill(customerId);
  }

  async fillCard(cardNumber: string): Promise<void> {
    await this.cardNumber.fill(cardNumber);
  }

  /** Submit and land on the order confirmation page. */
  async submit(): Promise<OrderPage> {
    await this.placeOrder.click();
    const orderPage = new OrderPage(this.page);
    await expect(orderPage.heading).toBeVisible();
    return orderPage;
  }

  /** Submit expecting the form to re-render with an error. */
  async submitExpectingError(message: string | RegExp): Promise<void> {
    await this.placeOrder.click();
    await expect(this.alert).toContainText(message);
  }
}
