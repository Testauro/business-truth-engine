import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface EmployeeDetails {
  empNumber: number;
  firstName: string;
  middleName: string;
  lastName: string;
  employeeId: string;
}

/** PIM > Personal Details form (read-only use). */
export class EmployeeDetailsPage {
  readonly heading: Locator;
  readonly firstName: Locator;
  readonly middleName: Locator;
  readonly lastName: Locator;
  readonly employeeId: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Personal Details' });
    this.firstName = page.getByPlaceholder('First Name');
    this.middleName = page.getByPlaceholder('Middle Name');
    this.lastName = page.getByPlaceholder('Last Name');
    // The Employee Id input has no label association; it is the input in the "Employee Id" group.
    this.employeeId = page.locator('.oxd-input-group', { hasText: 'Employee Id' }).locator('input');
  }

  async goto(empNumber: number): Promise<void> {
    await this.page.goto(`/web/index.php/pim/viewPersonalDetails/empNumber/${empNumber}`);
    await this.waitLoaded();
  }

  async waitLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.firstName).toBeVisible();
    // The form is populated asynchronously; the last name is required, so wait for it.
    await expect(this.lastName).not.toHaveValue('');
  }

  async read(): Promise<EmployeeDetails> {
    const match = /\/empNumber\/(\d+)/.exec(this.page.url());
    if (match?.[1] === undefined) throw new Error('not on a personal details page');
    return {
      empNumber: Number(match[1]),
      firstName: await this.firstName.inputValue(),
      middleName: await this.middleName.inputValue(),
      lastName: await this.lastName.inputValue(),
      employeeId: await this.employeeId.inputValue(),
    };
  }
}
