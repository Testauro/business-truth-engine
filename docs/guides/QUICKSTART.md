# Quickstart

Ten minutes from an existing TypeScript project to a first verdict.

## 1. Scaffold

```bash
npx bte init --source app
```

Creates `bte.config.ts`, `bte/rules/thing-processed-once.yaml` and `.env.example`, and adds
`.env` to `.gitignore`. Nothing else is touched.

## 2. Point BTE at your application

Edit `bte.config.ts`: set `baseUrl`, the auth, and map one of your JSON endpoints to an event.

```ts
import { defineConfig } from '@bte/sdk';

export default defineConfig({
  rules: ['bte/rules'],
  sources: [
    {
      type: 'http',
      name: 'orders', // the name your rules refer to
      baseUrl: '${APP_BASE_URL}', // from the environment or .env
      auth: { type: 'bearer', token: '${APP_API_TOKEN}' },
      requests: [
        {
          url: 'api/orders?status=paid',
          mapping: {
            type: 'order.paid',
            items: 'data',
            eventId: { template: 'order.paid:${id}' },
            occurredAt: 'paidAt',
            payload: { orderId: 'id', amount: 'total', currency: 'currency' },
          },
        },
      ],
    },
  ],
});
```

Copy `.env.example` to `.env` and fill in real values. `.env` is git-ignored.

## 3. Write the invariant

```yaml
# bte/rules/invoice-created-once.yaml
id: invoice-created-once
version: 1
trigger: { type: order.paid, source: orders, correlationKey: orderId }
expectations:
  - type: invoice.created
    source: invoicing
    window: { within: 120s }
    cardinality: exactly-one
    assertions:
      - { field: amount, op: equals, expected: { trigger: amount } }
```

Add a second source named `invoicing` to the config the same way. Then:

```bash
npx bte rules validate
```

## 4. Run it

```bash
npx bte verify            # collects from every source, evaluates, writes bte-report/
npx bte explain invoice-created-once ord_1001
```

Exit code 0 means every verdict passed the gate, 1 means a verdict failed it, 2 means BTE could
not evaluate (bad config, unreachable rules, invalid evidence). PENDING and UNKNOWN are reported,
never silently passed.

## 5. Inside Playwright

```ts
import { test as base } from '@playwright/test';
import { createBteFixtures } from '@bte/playwright';

export const test = base.extend(createBteFixtures({ config: { cwd: __dirname } }));

test('checkout creates exactly one invoice', async ({ page, bte }) => {
  // ... drive the UI, read the order id ...
  bte.correlate({ orderId });
  await bte.expectInvariant('invoice-created-once', orderId);
});
```

See PLAYWRIGHT_INTEGRATION.md for clocks, deadlines and reports, and
`examples/learning-platform/` for a complete third-party project.
