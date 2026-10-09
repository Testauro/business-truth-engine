import type { Clock } from '@bte/core';

export interface OrderPaidEvent {
  type: 'order.paid';
  eventId: string;
  occurredAt: string;
  orderId: string;
  paymentId: string;
  customerId: string;
  amount: number;
  currency: string;
}

export type DomainEvent = OrderPaidEvent;

export type Subscriber = (event: DomainEvent) => void;

/**
 * Minimal in-process event bus between the demo's modules. Synchronous and
 * ordered, which keeps scenarios deterministic. Delivery to a subscriber can
 * be deliberately repeated to model at-least-once transports.
 */
export class EventBus {
  readonly #subscribers: Subscriber[] = [];
  readonly #log: DomainEvent[] = [];
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  subscribe(subscriber: Subscriber): void {
    this.#subscribers.push(subscriber);
  }

  publish(event: DomainEvent): void {
    this.#log.push(event);
    for (const subscriber of this.#subscribers) subscriber(event);
  }

  get log(): readonly DomainEvent[] {
    return this.#log;
  }

  now(): string {
    return new Date(this.#clock.now()).toISOString();
  }
}
