import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';

/**
 * Typed HTTP client for the demo's JSON, admin and evidence endpoints. Every
 * response is validated with Zod so a drifting API fails loudly in tests.
 */
const OrderSchema = z.object({
  orderId: z.string(),
  customerId: z.string(),
  currency: z.string(),
  subtotalCents: z.number(),
  shippingCents: z.number(),
  totalCents: z.number(),
  status: z.enum(['created', 'paid']),
  paidAt: z.string().nullable(),
  paymentId: z.string().nullable(),
  lines: z.array(z.object({ sku: z.string(), quantity: z.number(), lineTotalCents: z.number() })),
});
export type Order = z.infer<typeof OrderSchema>;

const PaymentSchema = z.object({
  paymentId: z.string(),
  orderId: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.enum(['captured', 'declined']),
  cardLast4: z.string(),
  capturedAt: z.string().nullable(),
});
export type Payment = z.infer<typeof PaymentSchema>;

const InvoiceSchema = z.object({
  invoiceId: z.string(),
  orderId: z.string(),
  paymentId: z.string(),
  amount: z.number(),
  currency: z.string(),
  createdAt: z.string(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

const ErrorSchema = z.object({ error: z.string() });
const FaultsSchema = z.object({ active: z.array(z.string()) });
const ClockSchema = z.object({ now: z.string(), controllable: z.boolean() });
const AdvanceSchema = z.object({
  now: z.string(),
  advancedMs: z.number(),
  invoicesIssued: z.number(),
});
const CollectSchema = z.object({
  collectedAt: z.string(),
  recordCount: z.number(),
  sources: z.record(z.string(), z.enum(['available', 'unavailable'])),
  totalRecords: z.number(),
});
const StateSchema = z.object({
  now: z.string(),
  faults: z.array(z.string()),
  payments: z.array(PaymentSchema),
  pendingInvoices: z.number(),
});

export type DemoFault =
  | 'missing-invoice'
  | 'duplicate-invoice'
  | 'wrong-amount'
  | 'invoicing-unavailable'
  | 'delayed-invoice'
  | 'duplicate-delivery';

export class DemoApi {
  readonly #request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.#request = request;
  }

  // ---- admin ---------------------------------------------------------------
  async setFaults(faults: readonly DemoFault[]): Promise<string[]> {
    const response = await this.#request.put('/admin/faults', { data: { faults } });
    return FaultsSchema.parse(await response.json()).active;
  }

  async clock(): Promise<{ now: string; controllable: boolean }> {
    return ClockSchema.parse(await (await this.#request.get('/admin/clock')).json());
  }

  async now(): Promise<number> {
    return Date.parse((await this.clock()).now);
  }

  /** Move the demo's controllable clock forward; delayed invoices materialise as a side effect. */
  async advanceClock(ms: number): Promise<z.infer<typeof AdvanceSchema>> {
    const response = await this.#request.post('/admin/clock/advance', { data: { ms } });
    if (!response.ok())
      throw new Error(`advance clock failed: ${response.status()} ${await response.text()}`);
    return AdvanceSchema.parse(await response.json());
  }

  async state(): Promise<z.infer<typeof StateSchema>> {
    return StateSchema.parse(await (await this.#request.get('/admin/state')).json());
  }

  // ---- evidence -------------------------------------------------------------
  async collectEvidence(): Promise<z.infer<typeof CollectSchema>> {
    const response = await this.#request.post('/evidence/collect');
    return CollectSchema.parse(await response.json());
  }

  // ---- orders / payments / invoices ---------------------------------------
  async createOrder(
    customerId: string,
    lines: { sku: string; quantity: number }[],
  ): Promise<Order> {
    const response = await this.#request.post('/api/orders', { data: { customerId, lines } });
    if (response.status() !== 201)
      throw new Error(`create order failed: ${response.status()} ${await response.text()}`);
    return OrderSchema.parse(await response.json());
  }

  async pay(orderId: string, cardNumber: string): Promise<Payment> {
    const response = await this.#request.post(`/api/orders/${orderId}/pay`, {
      data: { cardNumber },
    });
    if (response.status() !== 201)
      throw new Error(`pay failed: ${response.status()} ${await response.text()}`);
    return PaymentSchema.parse(await response.json());
  }

  async payRaw(orderId: string, cardNumber: string): Promise<{ status: number; error?: string }> {
    const response = await this.#request.post(`/api/orders/${orderId}/pay`, {
      data: { cardNumber },
    });
    if (response.ok()) return { status: response.status() };
    return { status: response.status(), error: ErrorSchema.parse(await response.json()).error };
  }

  async getOrder(orderId: string): Promise<Order> {
    const response = await this.#request.get(`/api/orders/${orderId}`);
    if (!response.ok()) throw new Error(`get order failed: ${response.status()}`);
    return OrderSchema.parse(await response.json());
  }

  async getPayment(paymentId: string): Promise<Payment | undefined> {
    return (await this.state()).payments.find((payment) => payment.paymentId === paymentId);
  }

  /** Invoices for an order from the invoicing system of record, or the HTTP status when it refuses. */
  async getInvoices(orderId: string): Promise<{ status: number; invoices: Invoice[] }> {
    const response = await this.#request.get(
      `/api/invoices?orderId=${encodeURIComponent(orderId)}`,
    );
    if (!response.ok()) return { status: response.status(), invoices: [] };
    return {
      status: response.status(),
      invoices: z.array(InvoiceSchema).parse(await response.json()),
    };
  }
}
