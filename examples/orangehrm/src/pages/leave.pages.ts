import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Leave > Apply. Private instances only; never used against the public demo. */
export class ApplyLeavePage {
  readonly heading: Locator;
  readonly leaveType: Locator;
  readonly fromDate: Locator;
  readonly toDate: Locator;
  readonly apply: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Apply Leave' });
    this.leaveType = page
      .locator('.oxd-input-group', { hasText: 'Leave Type' })
      .locator('.oxd-select-text');
    this.fromDate = page.locator('.oxd-input-group', { hasText: 'From Date' }).locator('input');
    this.toDate = page.locator('.oxd-input-group', { hasText: 'To Date' }).locator('input');
    this.apply = page.getByRole('button', { name: 'Apply' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/web/index.php/leave/applyLeave');
    await expect(this.heading).toBeVisible();
  }

  async submit(leaveTypeName: string, fromDate: string, toDate: string): Promise<void> {
    await this.leaveType.click();
    await this.page.getByRole('option', { name: leaveTypeName }).click();
    await this.fromDate.fill(fromDate);
    await this.toDate.fill(toDate);
    await this.apply.click();
    await expect(this.page.getByText('Successfully Saved')).toBeVisible();
  }
}

/** Leave > Leave List (supervisor/admin view) with approve action. */
export class LeaveListPage {
  readonly heading: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Leave List' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/web/index.php/leave/viewLeaveList');
    await expect(this.heading).toBeVisible();
  }

  rowFor(employeeName: string, fromDate: string): Locator {
    return this.page
      .locator('.oxd-table-card', { hasText: employeeName })
      .filter({ hasText: fromDate });
  }

  async approve(employeeName: string, fromDate: string): Promise<void> {
    const row = this.rowFor(employeeName, fromDate);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(this.page.getByText('Successfully Updated')).toBeVisible();
    await expect(row).toContainText('Scheduled');
  }
}
