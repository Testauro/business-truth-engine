# Business Truth Engine

**BTE proves whether critical business outcomes are correct across application boundaries,
even when a normal Playwright UI test passes.**

A customer places an order and the UI says "success". The payment went through. But the
downstream invoice is missing, duplicated, or has the wrong amount. The ordinary checkout test
is green. BTE independently verifies the approved business invariant from evidence and says
`FAIL`, with the rule id and evidence ids that prove it.

## How it works

1. **Business invariants as code.** A versioned YAML rule names a trigger event, a correlation
   key, the expected observations, a time window, a cardinality, and value assertions.
2. **Evidence, not hope.** Systems emit `event` records (with separate business time and
   collection time) and `source` attestations (available? authoritative? complete through what
   instant?). Evidence is NDJSON today; PostgreSQL later.
3. **Four honest verdicts.** `PASS`, `FAIL`, `PENDING`, `UNKNOWN`. BTE never returns PASS
   because nothing bad was seen. See [ADR 0002](docs/adr/0002-verdict-semantics.md).

```yaml
id: invoice-created-once
version: 1
trigger: { type: order.paid, correlationKey: orderId }
expectations:
  - id: invoice
    type: invoice.created
    source: invoicing
    distinctBy: invoiceId
    window: { within: 120s, before: 5s }
    cardinality: exactly-one
    assertions:
      - { field: orderId, op: equals, expected: { trigger: orderId } }
      - { field: amount, op: equals, expected: { trigger: amount } }
      - { field: currency, op: equals, expected: { trigger: currency } }
```

## Try it

```bash
npx --yes pnpm@10 install
npx --yes pnpm@10 build
node apps/cli/dist/main.js evaluate \
  --rules rules \
  --evidence examples/fixtures/duplicate-invoice.ndjson \
  --now 2026-01-15T10:03:00Z
```

```
FAIL    invoice-created-once@v1  orderId="ord_1001"  trigger=evt-order-1001-paid (2026-01-15T10:00:00.000Z)
        FAIL    invoice: 2 distinct in window, deadline 2026-01-15T10:02:00.000Z, source invoicing (available, authoritative, complete through 2026-01-15T10:03:00.000Z)
        - DUPLICATE_OUTCOME: 2 distinct invoice.created outcomes observed, at most 1 allowed (keys: "inv_5001", "inv_5002") [evt-inv-5001-created, evt-inv-5002-created]

summary: PASS=0 FAIL=1 PENDING=0 UNKNOWN=0
```

Exit code is `1` on any `FAIL` (`--fail-on unknown` or `pending` tightens the gate), `0`
otherwise, `2` on usage or load errors. Add `--format json` (and `--output report.json`) for the
machine-readable report. Pass `--now` for reproducible output; the same inputs always yield
byte-identical JSON.

Every case in `examples/fixtures/` is catalogued with its expected verdict in
`examples/fixtures/cases.json` and checked by the test suite:

| Fixture                      | Verdict   | Why                                                 |
| ---------------------------- | --------- | --------------------------------------------------- |
| `normal`                     | PASS      | one correct invoice, authoritative complete source  |
| `missing-invoice`            | FAIL      | none by the deadline; source complete past deadline |
| `duplicate-invoice`          | FAIL      | two distinct invoices                               |
| `wrong-amount` / `-currency` | FAIL      | value mismatch against the payment                  |
| `late-invoice`               | FAIL      | invoice exists but after the 120s window            |
| `not-yet-due`                | PENDING   | evaluated before the deadline                       |
| `source-lagging`             | PENDING   | healthy source, watermark before the deadline       |
| `unavailable-source`         | UNKNOWN   | invoicing could not be queried                      |
| `no-attestation`             | UNKNOWN   | no `source` record for invoicing at all             |
| `no-watermark`               | UNKNOWN   | source gives no completeness watermark              |
| `non-authoritative`          | UNKNOWN   | evidence came from a cache                          |
| `duplicate-delivery`         | PASS      | same `eventId` delivered twice, counted once        |
| `out-of-order`               | PASS      | file order differs from business order              |
| `mixed-orders`               | FAIL+PASS | one verdict per paid order                          |

## Repository layout

```
apps/cli              bte command line
apps/demo             (Milestone B) Fastify order/payment/invoice demo with seeded faults
packages/core         contracts + deterministic evaluator (no I/O)
packages/rules        YAML rule loading
packages/evidence     NDJSON evidence I/O
packages/playwright   (Milestone C) Playwright fixtures
rules/                business invariants
examples/fixtures/    evidence cases + expected verdicts
tests/e2e             (Milestone C) Playwright demonstration
docs/                 ADRs and guides
```

## Development

```bash
npx --yes pnpm@10 verify     # lint + typecheck + test + format:check
npx --yes pnpm@10 test:watch
```

See [CLAUDE.md](CLAUDE.md) for architecture boundaries and engineering rules,
[ROADMAP.md](ROADMAP.md) for what is next, and [PROGRESS.md](PROGRESS.md) for verified status.

## License

Apache-2.0. See [LICENSE](LICENSE).
