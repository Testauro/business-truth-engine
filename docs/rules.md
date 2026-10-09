# Writing rules

A rule is a YAML document validated against `RuleSchema` (`packages/core/src/contracts/rule.ts`).
Print the JSON Schema with `bte schema`.

```yaml
id: invoice-created-once # lower-case kebab/dot case; stable across versions
version: 1 # bump when semantics change; id@version must be unique
description: optional prose
trigger:
  type: order.paid # event type that starts an obligation
  source: orders # optional; when set, the trigger's source must be attested trusted or the verdict is UNKNOWN
  correlationKey: orderId # dotted path into the trigger payload
expectations: # one or more; all must hold
  - id: invoice # optional, defaults to `type`
    type: invoice.created # observation event type
    source: invoicing # only events from this source count; it must attest itself
    correlationKey: orderId # path in the observation payload; defaults to trigger's
    distinctBy: invoiceId # what makes two observations two outcomes; default: eventId
    window:
      within: 120s # deadline relative to trigger occurredAt
      before: 5s # tolerance for observations slightly before the trigger
    cardinality: exactly-one # exactly-one | at-least-one | none | { min, max? }
    assertions: # evaluated against every in-window observation
      - field: amount # path in the observation payload
        op: equals # equals | notEquals | gt | gte | lt | lte | matches | notMatches | in | notIn
        expected: { trigger: amount } # or { value: <literal> }
```

Rules that can never fail (`{ min: 0 }` with no `max`) are rejected.

### Operators and operands

| Operator                 | Operand                                    | Meaning                                                                              |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `equals` / `notEquals`   | `{ value }` or `{ trigger }`               | structural equality, no coercion (arrays compare element-wise)                       |
| `gt` `gte` `lt` `lte`    | `{ value }` or `{ trigger }`               | ordered compare; both sides numbers or both strings                                  |
| `matches` / `notMatches` | `{ pattern, flags? }`                      | JavaScript regular expression on a string field; compiled and validated at rule load |
| `in` / `notIn`           | `{ value: [..] }` or `{ trigger }` → array | structural membership in a set                                                       |

A field missing on the observation always fails. A `trigger` operand that is missing, or not an
array for `in` / `notIn`, is indeterminate and yields UNKNOWN. Aggregates accept only the ordered
and equality operators with scalar operands.

## Aggregate assertions

Per-observation `assertions` judge each outcome on its own. `aggregates` judge the whole set of
distinct in-window outcomes at once:

```yaml
cardinality: { min: 0, max: 20 }
aggregates:
  - fn: sum # sum | min | max | avg | count | distinctCount
    field: amount # payload path; omitted for count
    op: lte
    expected: { trigger: amount } # or { value: <number> }
```

Semantics (ADR 0002, rule 5): an aggregate is evaluated only when the set is knowable, that is
once the window has closed and the source is complete through the deadline; until then the
expectation is PENDING or UNKNOWN exactly as for bounded cardinality, even if a running sum already
looks wrong. A failed aggregate is `AGGREGATE_MISMATCH` (FAIL) citing every observation and the
trigger; a missing trigger operand is UNKNOWN. Redeliveries and `distinctBy` duplicates are
aggregated once. `sum` over no observations is 0; `min` / `max` / `avg` over none fail. The
computed values are reported on the expectation (`aggregates[]`). Worked example:
`examples/rules/refunds-within-payment.yaml` with its catalogue in `examples/fixtures/aggregates/`.

## Evidence it needs

```jsonl
{"kind":"event","eventId":"evt-1","type":"order.paid","source":"orders","occurredAt":"...","collectedAt":"...","payload":{"orderId":"ord_1","amount":49.99,"currency":"USD"}}
{"kind":"event","eventId":"evt-2","type":"invoice.created","source":"invoicing","occurredAt":"...","collectedAt":"...","deliveryId":"d-1","payload":{"invoiceId":"inv_1","orderId":"ord_1","amount":49.99,"currency":"USD"}}
{"kind":"source","source":"invoicing","observedAt":"...","status":"available","authoritative":true,"completeThrough":"..."}
```

- `occurredAt` is business time and drives windows. `collectedAt` is when BTE got the record.
- Redeliveries share `eventId` (optionally different `deliveryId`) and are counted once.
- `source` attestations are what let BTE say PASS or FAIL. Without one for the expectation's
  source (or the trigger's, when `trigger.source` is set), the verdict is UNKNOWN.
  `completeThrough` must reach the deadline before an absence (or "exactly one") can be
  confirmed, and it is never taken to be later than the attestation's own `observedAt`.

## Reading a verdict

Each `RuleVerdict` carries `ruleId`, `ruleVersion`, the correlation key and value, the trigger
event id, `evaluatedAt`, one `ExpectationVerdict` per expectation (deadline, window start,
observations with placement `in-window | early | late`, source assessment) and ordered
`reasons`. Every reason has a stable `code`, a human message, and the `evidenceIds` it rests on.
