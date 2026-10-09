# Integrating an application

BTE verifies business outcomes from evidence your systems expose. Integration is three mappings:
your events onto BTE's evidence contract, your systems onto BTE sources, and your business rules
onto BTE rules.

## 1. The evidence contract

Every piece of evidence is one of two records:

```jsonc
// an event: something happened in a system of record
{ "kind": "event", "eventId": "invoice.created:inv_1", "type": "invoice.created", "source": "invoicing",
  "occurredAt": "2026-01-15T10:00:05Z", "collectedAt": "2026-01-15T10:03:00Z", "payload": { "orderId": "ord_1", "amount": 49.99 } }

// an attestation: what the source could see when BTE asked
{ "kind": "source", "source": "invoicing", "observedAt": "2026-01-15T10:03:00Z",
  "status": "available", "authoritative": true, "completeThrough": "2026-01-15T10:03:00Z" }
```

- `eventId` is the business event's identity: redeliveries share it and are counted once.
- `occurredAt` is business time and drives windows; `collectedAt` is when BTE obtained it.
- `completeThrough` is the promise "everything up to this instant has been reported". Without
  it BTE can never prove absence, so a missing outcome is UNKNOWN, not FAIL.
- `authoritative: false` marks caches and projections; they never yield PASS or FAIL.

## 2. Sources

A source is a logical system name (`orders`, `invoicing`, `ledger`) plus a way to collect from it.
Declare them in `bte.config.ts`:

| `type`     | Use for                                             | Completeness                                   |
| ---------- | --------------------------------------------------- | ---------------------------------------------- |
| `http`     | your JSON APIs (GET/POST, bearer/basic/header auth) | `snapshot` (default) or `none`                 |
| `ndjson`   | exported evidence files, fixtures, replays          | whatever the files attest                      |
| `postgres` | the BTE evidence store (`bte ingest`)               | as-of the evaluation instant                   |
| `custom`   | anything else (queues, logs, other databases)       | your adapter decides; see CUSTOM_ADAPTER_GUIDE |

### HTTP mapping

```ts
{
  type: 'http', name: 'invoicing', baseUrl: '${INVOICING_URL}',
  auth: { type: 'header', name: 'x-api-key', value: '${INVOICING_KEY}' },
  completeness: 'snapshot',          // a successful read reflects the whole current state
  requests: [{
    url: 'invoices?orderId=${correlation.orderId}',   // optional narrowing by correlation
    mapping: {
      type: 'invoice.created',
      items: 'data.invoices',                         // array inside the response
      filter: { path: 'state', equals: 'issued' },     // optional
      eventId: { template: 'invoice.created:${id}' }, // or a path, or { const }
      occurredAt: 'issuedAt',                          // ISO-8601 or epoch millis
      deliveryId: 'revision',                          // optional
      payload: { invoiceId: 'id', orderId: 'order.id', amount: 'totals.gross', currency: 'currency' },
    },
  }],
}
```

Field sources are dotted paths into each item, `{ template: '...${path}...' }`, or
`{ const: value }`. A mapping is validated when the config loads; a response that does not fit
(missing field, bad timestamp) makes that collection fail and the source `unavailable`, which the
verdict reports as UNKNOWN with the exact item and field. Nothing is silently dropped.

### When `completeness: 'none'` is right

Use it for feeds that cannot promise they returned everything (paged event streams, webhooks
replayed from a bounded buffer). Rules over such sources can still FAIL on confirmed wrong or
duplicate outcomes, but a missing outcome stays UNKNOWN. Prefer reading the system of record.

## 3. Correlation

Rules correlate the trigger and its outcomes by a business key: `trigger.correlationKey` names the
path on the trigger payload, the expectation matches the same value on its own payload
(`correlationKey`, default: same path). When the outcome is keyed differently, walk a chain:

```yaml
correlation:
  via: [{ type: invoice.created, source: invoicing, from: orderId, to: invoiceId }]
  observation: invoiceId
```

## 4. Time, delays, duplicates, order

- `window.within` is the deadline after the trigger's `occurredAt`; `before` tolerates clock skew.
- Before the deadline an unmet obligation is PENDING. After it, it is FAIL only if the source is
  complete through the deadline; otherwise PENDING (lagging watermark) or UNKNOWN (no watermark).
- Duplicated deliveries (same `eventId`) count once. Two distinct outcomes (`distinctBy`) for an
  `exactly-one` expectation are FAIL.
- Evidence order never matters; collect in any order, from any number of runs.

## 5. Running

- Locally: `bte verify` (reports in `bte-report/`), `bte explain <rule> <value>`.
- In Playwright: `createBteFixtures` (PLAYWRIGHT_INTEGRATION.md).
- In CI: run `bte verify --now <instant>` for reproducibility; the exit code gates the job; append
  `bte-report/bte.md` to the job summary and publish `bte.junit.xml`.
- Unsupported source types fail at config load with the list of supported ones.
