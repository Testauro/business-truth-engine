import formbody from '@fastify/formbody';
import type { Clock } from '@bte/core';
import { toIso } from '@bte/core';
import { toNdjsonLine } from '@bte/evidence';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CATALOG } from '../domain/catalog.js';
import { EventBus } from '../domain/events.js';
import { IdSequence } from '../domain/ids.js';
import { InvoicingService, InvoicingUnavailableError } from '../domain/invoicing.js';
import { CreateOrderSchema, OrderError, OrderService } from '../domain/orders.js';
import { PaymentInputSchema, PaymentService } from '../domain/payments.js';
import { EvidenceCollector } from '../evidence/collector.js';
import { FAULTS, FaultController, FaultListSchema, type Fault } from '../faults.js';
import { renderCheckout, renderFaults, renderOrder } from './views.js';

export interface DemoOptions {
  clock: Clock;
  faults?: readonly Fault[];
  logger?: boolean;
}

export interface DemoApp {
  app: FastifyInstance;
  clock: Clock;
  faults: FaultController;
  orders: OrderService;
  payments: PaymentService;
  invoicing: InvoicingService;
  collector: EvidenceCollector;
  bus: EventBus;
}

const CheckoutFormSchema = z
  .object({
    customerId: z.string().trim().min(1).max(64),
    cardNumber: z.string(),
  })
  .catchall(z.string());

const OrderIdParams = z.object({ orderId: z.string().min(1) });
const InvoiceQuery = z.object({ orderId: z.string().min(1).optional() });
const FaultsBody = z.object({ faults: z.union([z.array(z.string()), z.string()]).optional() });

function faultsFromBody(body: unknown): Fault[] {
  const parsed = FaultsBody.parse(body);
  const raw =
    parsed.faults === undefined
      ? []
      : Array.isArray(parsed.faults)
        ? parsed.faults
        : [parsed.faults];
  return FaultListSchema.parse(raw);
}

export function buildDemo(options: DemoOptions): DemoApp {
  const { clock } = options;
  const faults = new FaultController(options.faults ?? []);
  const ids = new IdSequence();
  const bus = new EventBus(clock);
  const orders = new OrderService(clock, ids);
  const payments = new PaymentService(clock, ids, orders, bus);
  const invoicing = new InvoicingService(clock, ids, orders, bus, faults);
  const collector = new EvidenceCollector({
    clock,
    orders: { listPaidOrders: () => orders.listPaid() },
    invoices: { listInvoices: () => invoicing.list() },
    duplicateDelivery: () => faults.isActive('duplicate-delivery'),
  });

  const app = Fastify({ logger: options.logger ?? false });
  void app.register(formbody);

  // Delayed invoices materialise as time passes; the server ticks on traffic
  // and (in main.ts) on an interval. Tests tick explicitly.
  app.addHook('onRequest', (_request, _reply, done) => {
    invoicing.tick();
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof OrderError) {
      void reply.code(error.statusCode).send({ error: error.message });
      return;
    }
    if (error instanceof InvoicingUnavailableError) {
      void reply.code(503).send({ error: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      void reply
        .code(400)
        .send({ error: 'invalid request', issues: error.issues.map((i) => i.message) });
      return;
    }
    request.log.error(error);
    void reply.code(500).send({ error: 'internal error' });
  });

  // ---- UI ----------------------------------------------------------------
  app.get('/', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderCheckout());
  });

  app.post('/checkout', async (request, reply) => {
    const form = CheckoutFormSchema.parse(request.body);
    const lines = CATALOG.map((product) => ({
      sku: product.sku,
      quantity: Number(form[`qty_${product.sku}`] ?? '0'),
    })).filter((line) => line.quantity > 0);
    if (lines.length === 0) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(renderCheckout('Add at least one item.'));
    }
    const cardResult = PaymentInputSchema.safeParse({ cardNumber: form.cardNumber });
    if (!cardResult.success) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(renderCheckout('Enter a valid card number (12–19 digits).'));
    }
    const order = orders.create(CreateOrderSchema.parse({ customerId: form.customerId, lines }));
    try {
      payments.charge(order.orderId, cardResult.data);
    } catch (error) {
      if (error instanceof OrderError && error.statusCode === 402) {
        return reply
          .code(402)
          .type('text/html; charset=utf-8')
          .send(renderCheckout('Your card was declined.'));
      }
      throw error;
    }
    return reply.redirect(`/orders/${order.orderId}`, 303);
  });

  app.get('/orders/:orderId', async (request, reply) => {
    const { orderId } = OrderIdParams.parse(request.params);
    const order = orders.require(orderId);
    const payment = order.paymentId === null ? undefined : payments.get(order.paymentId);
    return reply.type('text/html; charset=utf-8').send(renderOrder(order, payment));
  });

  // ---- JSON API ----------------------------------------------------------
  app.get('/api/catalog', () => ({ currency: 'USD', products: CATALOG }));

  app.post('/api/orders', async (request, reply) => {
    const order = orders.create(CreateOrderSchema.parse(request.body));
    return reply.code(201).send(order);
  });

  app.get('/api/orders/:orderId', (request) => {
    const { orderId } = OrderIdParams.parse(request.params);
    return orders.require(orderId);
  });

  app.post('/api/orders/:orderId/pay', async (request, reply) => {
    const { orderId } = OrderIdParams.parse(request.params);
    const payment = payments.charge(orderId, PaymentInputSchema.parse(request.body));
    return reply.code(201).send(payment);
  });

  app.get('/api/invoices', (request) => {
    const { orderId } = InvoiceQuery.parse(request.query);
    return orderId === undefined ? invoicing.list() : invoicing.forOrder(orderId);
  });

  // ---- Admin -------------------------------------------------------------
  app.get('/admin/faults', async (request, reply) => {
    const wantsJson = (request.headers.accept ?? '').includes('application/json');
    if (wantsJson) return { available: FAULTS, active: faults.list() };
    return reply.type('text/html; charset=utf-8').send(renderFaults(faults.list()));
  });

  app.post('/admin/faults', async (request, reply) => {
    faults.set(faultsFromBody(request.body));
    const wantsJson = (request.headers.accept ?? '').includes('application/json');
    if (wantsJson) return { active: faults.list() };
    return reply.redirect('/admin/faults', 303);
  });

  app.put('/admin/faults', (request) => {
    faults.set(faultsFromBody(request.body));
    return { active: faults.list() };
  });

  app.get('/admin/state', () => ({
    now: toIso(clock.now()),
    faults: faults.list(),
    orders: orders.list(),
    payments: payments.list(),
    pendingInvoices: invoicing.pendingCount,
  }));

  // ---- Evidence (independent collection path) ----------------------------
  app.post('/evidence/collect', () => {
    const result = collector.collect();
    return {
      collectedAt: result.collectedAt,
      recordCount: result.records.length,
      sources: result.sources,
      totalRecords: collector.records.length,
    };
  });

  app.get('/evidence', async (_request, reply) => {
    const body = collector.records.map(toNdjsonLine).join('');
    return reply.type('application/x-ndjson; charset=utf-8').send(body);
  });

  app.get('/health', () => ({ ok: true, now: toIso(clock.now()) }));

  return { app, clock, faults, orders, payments, invoicing, collector, bus };
}
