import type { Clock, EvidenceEvent, EvidenceRecord, SourceStatus } from '@bte/core';
import { toIso } from '@bte/core';
import { InMemoryEvidenceStore, writeEvidenceNdjson } from '@bte/evidence';
import type { Invoice } from '../domain/invoicing.js';
import type { Order } from '../domain/orders.js';

/**
 * Read-only ports onto authoritative application state. The collector only
 * ever reads through these; it never calls into the modules' command paths,
 * and the modules know nothing about evidence or BTE.
 */
export interface OrdersReadModel {
  /** Paid orders as the orders system of record knows them. */
  listPaidOrders(): readonly Order[];
}

export interface InvoicesReadModel {
  /** Every invoice in the invoicing system of record. Throws when unavailable. */
  listInvoices(): readonly Invoice[];
}

export interface CollectorOptions {
  clock: Clock;
  orders: OrdersReadModel;
  invoices: InvoicesReadModel;
  /** Emit every record twice with distinct delivery ids (models at-least-once pipelines). */
  duplicateDelivery?: () => boolean;
}

export interface CollectionResult {
  collectedAt: string;
  records: EvidenceRecord[];
  sources: Record<string, SourceStatus['status']>;
}

export const ORDERS_SOURCE = 'orders';
export const INVOICING_SOURCE = 'invoicing';

/**
 * Independent evidence path. Each `collect()` snapshots the systems of record
 * at one instant and appends evidence to an append-only store:
 *
 *  - `order.paid` events derived from paid orders (orders is authoritative for
 *    the fact that payment was captured and for the amount charged);
 *  - `invoice.created` events derived from the invoicing store;
 *  - one `source` attestation per system, with `completeThrough` set to the
 *    collection instant when the system answered. Because reads are
 *    synchronous snapshots, every record with occurredAt <= now is included,
 *    which is exactly what the watermark promises.
 *
 * Repeated collections re-emit the same event ids; the engine deduplicates.
 */
export class EvidenceCollector {
  readonly #store = new InMemoryEvidenceStore();
  readonly #clock: Clock;
  readonly #orders: OrdersReadModel;
  readonly #invoices: InvoicesReadModel;
  readonly #duplicateDelivery: () => boolean;
  #deliverySeq = 0;
  #runs = 0;

  constructor(options: CollectorOptions) {
    this.#clock = options.clock;
    this.#orders = options.orders;
    this.#invoices = options.invoices;
    this.#duplicateDelivery = options.duplicateDelivery ?? (() => false);
  }

  collect(): CollectionResult {
    this.#runs += 1;
    const now = toIso(this.#clock.now());
    const records: EvidenceRecord[] = [];
    const sources: CollectionResult['sources'] = {};

    const orderEvents = this.#orders.listPaidOrders().map((order) => this.#orderPaid(order, now));
    this.#emitEvents(records, orderEvents);
    records.push({
      kind: 'source',
      source: ORDERS_SOURCE,
      observedAt: now,
      status: 'available',
      authoritative: true,
      completeThrough: now,
      note: `orders store snapshot, run ${this.#runs}`,
    });
    sources[ORDERS_SOURCE] = 'available';

    try {
      const invoiceEvents = this.#invoices
        .listInvoices()
        .map((invoice) => this.#invoiceCreated(invoice, now));
      this.#emitEvents(records, invoiceEvents);
      records.push({
        kind: 'source',
        source: INVOICING_SOURCE,
        observedAt: now,
        status: 'available',
        authoritative: true,
        completeThrough: now,
        note: `invoice table snapshot, run ${this.#runs}`,
      });
      sources[INVOICING_SOURCE] = 'available';
    } catch (error) {
      records.push({
        kind: 'source',
        source: INVOICING_SOURCE,
        observedAt: now,
        status: 'unavailable',
        authoritative: true,
        note: error instanceof Error ? error.message : String(error),
      });
      sources[INVOICING_SOURCE] = 'unavailable';
    }

    this.#store.appendAll(records);
    return { collectedAt: now, records, sources };
  }

  #emitEvents(into: EvidenceRecord[], events: readonly EvidenceEvent[]): void {
    for (const event of events) {
      into.push({ ...event, deliveryId: this.#nextDelivery() });
      if (this.#duplicateDelivery()) into.push({ ...event, deliveryId: this.#nextDelivery() });
    }
  }

  #nextDelivery(): string {
    this.#deliverySeq += 1;
    return `dlv_${String(this.#deliverySeq).padStart(4, '0')}`;
  }

  #orderPaid(order: Order, collectedAt: string): EvidenceEvent {
    if (order.paidAt === null || order.paymentId === null) {
      throw new Error(`order ${order.orderId} is listed as paid without payment details`);
    }
    return {
      kind: 'event',
      eventId: `order.paid:${order.orderId}:${order.paymentId}`,
      type: 'order.paid',
      source: ORDERS_SOURCE,
      occurredAt: order.paidAt,
      collectedAt,
      payload: {
        orderId: order.orderId,
        paymentId: order.paymentId,
        customerId: order.customerId,
        amount: Math.round(order.totalCents) / 100,
        currency: order.currency,
      },
    };
  }

  #invoiceCreated(invoice: Invoice, collectedAt: string): EvidenceEvent {
    return {
      kind: 'event',
      eventId: `invoice.created:${invoice.invoiceId}`,
      type: 'invoice.created',
      source: INVOICING_SOURCE,
      occurredAt: invoice.createdAt,
      collectedAt,
      payload: {
        invoiceId: invoice.invoiceId,
        orderId: invoice.orderId,
        paymentId: invoice.paymentId,
        amount: invoice.amount,
        currency: invoice.currency,
      },
    };
  }

  /** Everything collected so far, in collection order. */
  get records(): readonly EvidenceRecord[] {
    return this.#store.records;
  }

  snapshot(): ReturnType<InMemoryEvidenceStore['snapshot']> {
    return this.#store.snapshot();
  }

  async writeTo(file: string): Promise<number> {
    await writeEvidenceNdjson(file, this.#store.records);
    return this.#store.records.length;
  }
}
