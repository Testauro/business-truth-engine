/** Test data for the demo shop. Totals are derived from the catalog in apps/demo. */
export interface Basket {
  name: string;
  quantities: Readonly<Record<string, number>>;
  subtotal: number;
  shipping: number;
  total: number;
}

export const BASKETS = {
  /** One tee (24.99) + two mugs (25.98): clears free shipping. */
  twoLineFreeShipping: {
    name: 'tee + 2 mugs',
    quantities: { 'BTE-TEE': 1, 'BTE-MUG': 2 },
    subtotal: 50.97,
    shipping: 0,
    total: 50.97,
  },
  /** A single tee below the threshold: 24.99 + 4.99 shipping. */
  singleWithShipping: {
    name: 'single tee',
    quantities: { 'BTE-TEE': 1 },
    subtotal: 24.99,
    shipping: 4.99,
    total: 29.98,
  },
} as const satisfies Record<string, Basket>;

export const PRODUCT_LABELS: Readonly<Record<string, string>> = {
  'BTE-TEE': 'Business Truth T-shirt',
  'BTE-MUG': 'Evidence Mug',
  'BTE-BOOK': 'Invariants as Code (paperback)',
};

export const CARDS = {
  valid: '4242424242424242',
  declined: '4242424242420000',
  malformed: '12',
} as const;

export const CUSTOMER = { id: 'cus_e2e' } as const;

export const RULE = { invoiceCreatedOnce: 'invoice-created-once' } as const;

/** The rule window is 120s; this clears it with margin. */
export const PAST_DEADLINE_MS = 121_000;
/** The delayed-invoice fault issues after 150s. */
export const PAST_DELAYED_INVOICE_MS = 151_000;

export function money(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}
