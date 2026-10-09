# Writing a custom evidence adapter

An adapter turns a system you control into BTE evidence. It needs only the public contract from
`@bte/sdk`; BTE core is never modified.

## The contract

```ts
import type { EvidenceSource, CollectContext, EvidenceRecord } from '@bte/sdk';

export interface EvidenceSource {
  readonly name: string; // the logical source name rules refer to
  readonly authoritative?: boolean; // default true; false for caches/projections
  collect(context: CollectContext): Promise<readonly EvidenceRecord[]>;
}
// CollectContext = { now: number /* epoch ms */, correlation?: Record<string, unknown> }
```

`collect` returns the events it can see plus an attestation of its own completeness, or throws.
If it throws, BTE records the source as `unavailable` with the error, so anything depending on it
becomes UNKNOWN. Never return an empty array to mean "nothing happened" unless you also attest
completeness; absence of telemetry is not evidence.

## A minimal adapter

```ts
// bte/adapters/queue-adapter.ts
import { attestation, mapItems, type EvidenceSource } from '@bte/sdk';
import { readQueue } from './my-queue-client.js';

const mapping = {
  type: 'shipment.dispatched',
  eventId: { template: 'shipment:${id}' },
  occurredAt: 'dispatchedAt',
  payload: { shipmentId: 'id', orderId: 'order', parcels: 'parcelCount' },
};

const source: EvidenceSource = {
  name: 'shipping',
  async collect({ now, correlation }) {
    const items = await readQueue({ orderId: correlation?.['orderId'] }); // your code
    const mapped = mapItems(mapping, items, { source: 'shipping', collectedAt: now });
    if (mapped.problems.length > 0) {
      throw new Error(
        `shipping records do not fit the mapping: ${JSON.stringify(mapped.problems)}`,
      );
    }
    return [
      ...mapped.events,
      // Only promise completeness if the read really covered everything up to `now`.
      attestation('shipping', now, { completeThrough: now, note: 'queue drained' }),
    ];
  },
};
export default source;
```

Register it in `bte.config.ts`:

```ts
sources: [{ type: 'custom', name: 'shipping', module: './bte/adapters/queue-adapter.ts' }];
```

The module may export the source directly or a factory `(entry, { dir, env }) => EvidenceSource`
(use `entry.options` for adapter settings). The exported `name` must equal the config `name`;
mismatches are rejected at load so rules cannot silently refer to the wrong source.

## Rules of honesty

1. `authoritative: true` only for the system of record.
2. `completeThrough` only as far as you truly read. A snapshot read of a table: `now`. A
   bounded page of a feed: omit it (verdicts degrade to UNKNOWN for absence, which is correct).
3. Stable `eventId`s: the same business event must map to the same id every time, so repeated
   collections dedupe. Use the upstream identifier, not a counter.
4. Business time in `occurredAt`, never the collection time.
5. Throw on anything you do not understand (auth failure, schema drift). BTE turns it into an
   explicit UNKNOWN with your message in the report.

## Testing an adapter

Adapters are plain objects: unit test `collect` against a stub of your system, and run the records
through the engine with `EvidenceSet.from(records)` and `evaluateRules` from `@bte/sdk`. The
`collectAll` helper shows how BTE treats a throwing adapter.
