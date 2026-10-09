import type { Clock } from '@bte/core';
import { toIso } from '@bte/core';
import { z } from 'zod';
import { CURRENCY, FREE_SHIPPING_THRESHOLD_CENTS, SHIPPING_CENTS, findProduct } from './catalog.js';
import type { IdSequence } from './ids.js';
import type { Cents } from './money.js';

export const OrderLineInputSchema = z.object({
  sku: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(10),
});
export const CreateOrderSchema = z.object({
  customerId: z.string().trim().min(1).max(64),
  lines: z.array(OrderLineInputSchema).min(1),
});
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export interface OrderLine {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: Cents;
  lineTotalCents: Cents;
}

export interface Order {
  orderId: string;
  customerId: string;
  currency: string;
  lines: OrderLine[];
  subtotalCents: Cents;
  shippingCents: Cents;
  totalCents: Cents;
  status: 'created' | 'paid';
  createdAt: string;
  paidAt: string | null;
  paymentId: string | null;
}

export class OrderError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'OrderError';
    this.statusCode = statusCode;
  }
}

/** System of record for orders. */
export class OrderService {
  readonly #orders = new Map<string, Order>();
  readonly #clock: Clock;
  readonly #ids: IdSequence;

  constructor(clock: Clock, ids: IdSequence) {
    this.#clock = clock;
    this.#ids = ids;
  }

  create(input: CreateOrderInput): Order {
    const lines: OrderLine[] = input.lines.map((line) => {
      const product = findProduct(line.sku);
      if (product === undefined) throw new OrderError(400, `unknown sku "${line.sku}"`);
      return {
        sku: product.sku,
        name: product.name,
        quantity: line.quantity,
        unitPriceCents: product.unitPriceCents,
        lineTotalCents: product.unitPriceCents * line.quantity,
      };
    });
    const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const shippingCents = subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_CENTS;
    const order: Order = {
      orderId: this.#ids.next('ord'),
      customerId: input.customerId,
      currency: CURRENCY,
      lines,
      subtotalCents,
      shippingCents,
      totalCents: subtotalCents + shippingCents,
      status: 'created',
      createdAt: toIso(this.#clock.now()),
      paidAt: null,
      paymentId: null,
    };
    this.#orders.set(order.orderId, order);
    return order;
  }

  get(orderId: string): Order | undefined {
    return this.#orders.get(orderId);
  }

  require(orderId: string): Order {
    const order = this.#orders.get(orderId);
    if (order === undefined) throw new OrderError(404, `order ${orderId} not found`);
    return order;
  }

  markPaid(orderId: string, paymentId: string, paidAt: string): Order {
    const order = this.require(orderId);
    if (order.status === 'paid') throw new OrderError(409, `order ${orderId} is already paid`);
    const paid: Order = { ...order, status: 'paid', paidAt, paymentId };
    this.#orders.set(orderId, paid);
    return paid;
  }

  list(): Order[] {
    return [...this.#orders.values()].sort((a, b) => (a.orderId < b.orderId ? -1 : 1));
  }

  listPaid(): Order[] {
    return this.list().filter((order) => order.status === 'paid');
  }
}
