import type { Clock } from '@bte/core';
import { toIso } from '@bte/core';
import type { DomainEvent, EventBus, OrderPaidEvent } from './events.js';
import type { FaultController } from '../faults.js';
import type { IdSequence } from './ids.js';
import { toAmount } from './money.js';
import type { OrderService } from './orders.js';

export interface Invoice {
  invoiceId: string;
  orderId: string;
  paymentId: string;
  customerId: string;
  amount: number;
  currency: string;
  createdAt: string;
}

export class InvoicingUnavailableError extends Error {
  constructor() {
    super('invoicing system of record is unavailable');
    this.name = 'InvoicingUnavailableError';
  }
}

export const DELAYED_INVOICE_MS = 150_000;

interface ScheduledInvoice {
  event: OrderPaidEvent;
  dueAt: number;
}

/**
 * Invoicing system of record. Reacts to `order.paid`. This is where the
 * seeded business faults live: the checkout and payment paths are untouched,
 * so the UI and the payment both report success regardless.
 */
export class InvoicingService {
  readonly #invoices = new Map<string, Invoice>();
  readonly #scheduled: ScheduledInvoice[] = [];
  readonly #clock: Clock;
  readonly #ids: IdSequence;
  readonly #orders: OrderService;
  readonly #faults: FaultController;

  constructor(
    clock: Clock,
    ids: IdSequence,
    orders: OrderService,
    bus: EventBus,
    faults: FaultController,
  ) {
    this.#clock = clock;
    this.#ids = ids;
    this.#orders = orders;
    this.#faults = faults;
    bus.subscribe((event) => {
      this.#handle(event);
    });
  }

  #handle(event: DomainEvent): void {
    if (this.#faults.isActive('missing-invoice')) return;
    if (this.#faults.isActive('delayed-invoice')) {
      this.#scheduled.push({ event, dueAt: this.#clock.now() + DELAYED_INVOICE_MS });
      return;
    }
    this.#issue(event);
    if (this.#faults.isActive('duplicate-invoice')) this.#issue(event);
  }

  #issue(event: OrderPaidEvent): void {
    const order = this.#orders.require(event.orderId);
    // wrong-amount: a classic line-iteration bug, the invoice carries only the
    // first line's total instead of the order total (lines + shipping).
    const firstLine = order.lines[0];
    const amountCents =
      this.#faults.isActive('wrong-amount') && firstLine !== undefined
        ? firstLine.lineTotalCents
        : order.totalCents;
    const invoice: Invoice = {
      invoiceId: this.#ids.next('inv'),
      orderId: event.orderId,
      paymentId: event.paymentId,
      customerId: event.customerId,
      amount: toAmount(amountCents),
      currency: order.currency,
      createdAt: toIso(this.#clock.now()),
    };
    this.#invoices.set(invoice.invoiceId, invoice);
  }

  /**
   * Materialise delayed invoices whose due time has passed. `createdAt` is the
   * time of materialisation, so an evidence watermark taken earlier stays true.
   */
  tick(): number {
    const now = this.#clock.now();
    let issued = 0;
    for (let i = this.#scheduled.length - 1; i >= 0; i -= 1) {
      const entry = this.#scheduled[i];
      if (entry === undefined || entry.dueAt > now) continue;
      this.#scheduled.splice(i, 1);
      this.#issue(entry.event);
      issued += 1;
    }
    return issued;
  }

  get pendingCount(): number {
    return this.#scheduled.length;
  }

  #assertAvailable(): void {
    if (this.#faults.isActive('invoicing-unavailable')) throw new InvoicingUnavailableError();
  }

  /** Authoritative read; throws when the system is unavailable. */
  list(): Invoice[] {
    this.#assertAvailable();
    return [...this.#invoices.values()].sort((a, b) => (a.invoiceId < b.invoiceId ? -1 : 1));
  }

  forOrder(orderId: string): Invoice[] {
    return this.list().filter((invoice) => invoice.orderId === orderId);
  }
}
