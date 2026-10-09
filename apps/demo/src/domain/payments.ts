import type { Clock } from '@bte/core';
import { toIso } from '@bte/core';
import { z } from 'zod';
import type { EventBus } from './events.js';
import type { IdSequence } from './ids.js';
import { toAmount } from './money.js';
import { OrderError, type OrderService } from './orders.js';

export const PaymentInputSchema = z.object({
  cardNumber: z
    .string()
    .trim()
    .regex(/^\d{12,19}$/, 'card number must be 12-19 digits'),
});
export type PaymentInput = z.infer<typeof PaymentInputSchema>;

export interface Payment {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'captured' | 'declined';
  cardLast4: string;
  capturedAt: string | null;
}

export class PaymentError extends OrderError {}

/**
 * Payment processor. Captures the order total and, on success, publishes
 * `order.paid` so downstream modules (invoicing) react to it.
 */
export class PaymentService {
  readonly #payments = new Map<string, Payment>();
  readonly #clock: Clock;
  readonly #ids: IdSequence;
  readonly #orders: OrderService;
  readonly #bus: EventBus;

  constructor(clock: Clock, ids: IdSequence, orders: OrderService, bus: EventBus) {
    this.#clock = clock;
    this.#ids = ids;
    this.#orders = orders;
    this.#bus = bus;
  }

  charge(orderId: string, input: PaymentInput): Payment {
    const order = this.#orders.require(orderId);
    if (order.status === 'paid') throw new PaymentError(409, `order ${orderId} is already paid`);
    const now = toIso(this.#clock.now());
    const paymentId = this.#ids.next('pay');
    const cardLast4 = input.cardNumber.slice(-4);
    if (cardLast4 === '0000') {
      const declined: Payment = {
        paymentId,
        orderId,
        amount: toAmount(order.totalCents),
        currency: order.currency,
        status: 'declined',
        cardLast4,
        capturedAt: null,
      };
      this.#payments.set(paymentId, declined);
      throw new PaymentError(402, 'card declined');
    }
    const payment: Payment = {
      paymentId,
      orderId,
      amount: toAmount(order.totalCents),
      currency: order.currency,
      status: 'captured',
      cardLast4,
      capturedAt: now,
    };
    this.#payments.set(paymentId, payment);
    const paid = this.#orders.markPaid(orderId, paymentId, now);
    this.#bus.publish({
      type: 'order.paid',
      eventId: `order.paid:${paid.orderId}:${paymentId}`,
      occurredAt: now,
      orderId: paid.orderId,
      paymentId,
      customerId: paid.customerId,
      amount: payment.amount,
      currency: payment.currency,
    });
    return payment;
  }

  get(paymentId: string): Payment | undefined {
    return this.#payments.get(paymentId);
  }

  list(): Payment[] {
    return [...this.#payments.values()].sort((a, b) => (a.paymentId < b.paymentId ? -1 : 1));
  }
}
