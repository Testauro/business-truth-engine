import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { money } from '../data/test-data.js';

/** Page object for `/orders/:orderId`, the confirmation the customer sees. */
export class OrderPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly status: Locator;
  readonly total: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /^Order ord_/ });
    this.status = page.getByRole('status');
    this.total = page.getByTestId('order-total');
  }

  async orderId(): Promise<string> {
    const id = await this.page.getByTestId('order-id').textContent();
    if (id === null || id.trim() === '') throw new Error('order id not rendered');
    return id.trim();
  }

  /** The ordinary checkout assertions: confirmation, amount charged, payment reference. */
  async expectPaymentReceived(total: number): Promise<void> {
    await expect(this.status).toContainText('Order confirmed. Payment received');
    await expect(this.status).toContainText(money(total));
    await expect(this.status).toContainText(/payment pay_\d+/);
    await expect(this.total).toHaveText(money(total));
  }
}
