import { defineConfig } from '@bte/sdk';

/**
 * BTE configuration for the demo shop, expressed the way a third party would:
 * the rule files, and the demo's own JSON APIs mapped to evidence. The demo
 * also serves BTE-native NDJSON on /evidence, but a real application does not,
 * so this config deliberately uses the generic HTTP adapter and field mapping.
 */
export default defineConfig({
  rules: ['../../rules'],
  sources: [
    {
      type: 'http',
      name: 'orders',
      baseUrl: '${BTE_DEMO_BASE_URL}',
      requests: [
        {
          url: 'admin/state',
          mapping: {
            type: 'order.paid',
            items: 'orders',
            filter: { path: 'status', equals: 'paid' },
            eventId: { template: 'order.paid:${orderId}:${paymentId}' },
            occurredAt: 'paidAt',
            payload: {
              orderId: 'orderId',
              paymentId: 'paymentId',
              customerId: 'customerId',
              amount: 'total',
              currency: 'currency',
            },
          },
        },
      ],
    },
    {
      type: 'http',
      name: 'invoicing',
      baseUrl: '${BTE_DEMO_BASE_URL}',
      requests: [
        {
          url: 'api/invoices',
          mapping: {
            type: 'invoice.created',
            eventId: { template: 'invoice.created:${invoiceId}' },
            occurredAt: 'createdAt',
            payload: {
              invoiceId: 'invoiceId',
              orderId: 'orderId',
              paymentId: 'paymentId',
              amount: 'amount',
              currency: 'currency',
            },
          },
        },
      ],
    },
  ],
});
