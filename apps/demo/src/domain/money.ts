/** Money is kept as integer minor units (cents) internally and exposed as a 2-decimal number. */
export type Cents = number;

export function toAmount(cents: Cents): number {
  return Math.round(cents) / 100;
}

export function formatMoney(cents: Cents, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(toAmount(cents));
}
