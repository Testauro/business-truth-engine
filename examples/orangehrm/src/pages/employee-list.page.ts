import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface EmployeeRow {
  empNumber: number;
  employeeId: string;
  firstAndMiddle: string;
  lastName: string;
}

/** PIM > Employee List. Selection is made reproducible by sorting and taking the first row. */
export class EmployeeListPage {
  readonly heading: Locator;
  readonly table: Locator;
  readonly rows: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Employee Information' });
    this.table = page.locator('.oxd-table');
    this.rows = this.table.locator('.oxd-table-card');
  }

  async goto(): Promise<void> {
    await this.page.goto('/web/index.php/pim/viewEmployeeList');
    await expect(this.heading).toBeVisible();
    await expect(this.rows.first()).toBeVisible();
  }

  /** The first row of the list as currently displayed; empNumber is read from the row's details link. */
  async firstRow(): Promise<EmployeeRow> {
    const row = this.rows.first();
    const cells = row.locator('.oxd-table-cell');
    await expect(cells).toHaveCount(await cells.count());
    const texts = await cells.allInnerTexts();
    // Columns: [checkbox] Id | First (& Middle) Name | Last Name | Job Title | Employment Status | Sub Unit | Supervisor | Actions
    const [, employeeId = '', firstAndMiddle = '', lastName = ''] = texts.map((t) => t.trim());
    await row.click();
    await this.page.waitForURL(/\/pim\/viewPersonalDetails\/empNumber\/(\d+)/);
    const match = /\/empNumber\/(\d+)/.exec(this.page.url());
    if (match?.[1] === undefined) throw new Error('could not read empNumber from the details URL');
    return { empNumber: Number(match[1]), employeeId, firstAndMiddle, lastName };
  }
}
