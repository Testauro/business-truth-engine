import { z } from 'zod';

/**
 * Seeded business faults. Each one makes the checkout UI look exactly as it
 * does on the happy path while breaking the downstream invoicing invariant.
 */
export const FAULTS = [
  'missing-invoice',
  'duplicate-invoice',
  'wrong-amount',
  'invoicing-unavailable',
  'delayed-invoice',
  'duplicate-delivery',
] as const;
export type Fault = (typeof FAULTS)[number];

export const FaultSchema = z.enum(FAULTS);
export const FaultListSchema = z.array(FaultSchema);

export const FAULT_DESCRIPTIONS: Readonly<Record<Fault, string>> = {
  'missing-invoice': 'invoicing silently drops the order.paid event; no invoice is ever created',
  'duplicate-invoice': 'invoicing creates two distinct invoices for one paid order',
  'wrong-amount': 'invoicing bills only the first line item instead of the paid total',
  'invoicing-unavailable': 'the invoicing system of record refuses queries',
  'delayed-invoice': 'invoicing creates the invoice only after the 120s deadline',
  'duplicate-delivery': 'the evidence pipeline delivers every record twice (at-least-once)',
};

/** Parse `a,b,c` (env var) into faults; unknown names are rejected. */
export function parseFaultList(text: string): Fault[] {
  const names = text
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return FaultListSchema.parse(names);
}

export class FaultController {
  readonly #active = new Set<Fault>();

  constructor(initial: Iterable<Fault> = []) {
    for (const fault of initial) this.#active.add(fault);
  }

  isActive(fault: Fault): boolean {
    return this.#active.has(fault);
  }

  set(faults: Iterable<Fault>): void {
    this.#active.clear();
    for (const fault of faults) this.#active.add(fault);
  }

  list(): Fault[] {
    return FAULTS.filter((fault) => this.#active.has(fault));
  }
}
