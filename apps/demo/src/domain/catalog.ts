import type { Cents } from './money.js';

export interface Product {
  sku: string;
  name: string;
  unitPriceCents: Cents;
}

export const CURRENCY = 'USD';
export const FREE_SHIPPING_THRESHOLD_CENTS: Cents = 5_000;
export const SHIPPING_CENTS: Cents = 499;

export const CATALOG: readonly Product[] = [
  { sku: 'BTE-TEE', name: 'Business Truth T-shirt', unitPriceCents: 2_499 },
  { sku: 'BTE-MUG', name: 'Evidence Mug', unitPriceCents: 1_299 },
  { sku: 'BTE-BOOK', name: 'Invariants as Code (paperback)', unitPriceCents: 3_900 },
];

export function findProduct(sku: string): Product | undefined {
  return CATALOG.find((product) => product.sku === sku);
}
