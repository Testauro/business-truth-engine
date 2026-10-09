# Business Truth Engine

**BTE proves whether critical business outcomes are correct across application boundaries,
even when a normal Playwright UI test passes.**

A customer places an order and the UI says "success". The payment went through. But the
downstream invoice is missing, duplicated, or has the wrong amount. The ordinary checkout test
is green. BTE independently verifies the approved business invariant from evidence and says
`FAIL`, with the rule id and evidence ids that prove it.

## Use it in your own application

BTE is domain-agnostic. Install the packages, point a config at your application's APIs, write
your invariants, and verify from Playwright or the CLI, without touching BTE's source:

```bash
npx bte init                 # bte.config.ts, an example rule, .env.example
npx bte rules validate
npx bte verify               # collects over HTTP (env-based auth), evaluates, reports, exit code gates CI
npx bte explain <ruleId> <correlationValue>
```

Guides: [Installation](docs/guides/INSTALLATION.md) · [Quickstart](docs/guides/QUICKSTART.md) ·
[Application integration](docs/guides/APPLICATION_INTEGRATION.md) ·
[Custom adapters](docs/guides/CUSTOM_ADAPTER_GUIDE.md) ·
[Playwright integration](docs/guides/PLAYWRIGHT_INTEGRATION.md) ·
[Business rules](docs/guides/BUSINESS_RULES_GUIDE.md).
A complete third-party example, an online learning platform installed only from packed tarballs,
lives in [`examples/learning-platform`](examples/learning-platform).

## Quickstart (this repository)

```bash
git clone <this repo> && cd business-truth-engine
npx --yes pnpm@10 install            # pnpm 10 via npx; Node 24+
npx --yes pnpm@10 build
# judge an evidence file against the rules (exit 1 = a business invariant failed)
node apps/cli/dist/main.js evaluate --rules rules --evidence examples/fixtures/missing-invoice.ndjson --now 2026-01-15T10:03:00Z
# machine-readable outputs for CI
node apps/cli/dist/main.js evaluate --rules rules --evidence examples/fixtures/missing-invoice.ndjson --now 2026-01-15T10:03:00Z \
  --output bte-report/bte.json --junit bte-report/bte.junit.xml --markdown bte-report/bte.md
npx --yes pnpm@10 verify             # the full quality gate (lint, types, coverage, CLI, demo scenarios, Playwright)
```

Exit codes: `0` gate passed, `1` a verdict failed the gate (`--fail-on fail|unknown|pending`),
`2` could not evaluate. Details in [docs/reports.md](docs/reports.md).

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

## The demo: a green checkout with a broken invoice

`apps/demo` is a small Fastify shop. Orders, payments, and invoicing are separate modules; the
checkout UI and payment path are correct, and the faults are seeded only downstream in invoicing.

```bash
npx --yes pnpm@10 build
# One in-process checkout with a seeded fault, clock advanced past the 120s deadline,
# evidence collected from the systems of record and written as NDJSON:
node apps/demo/dist/scenario.js --fault wrong-amount --out bte-report/demo/wrong-amount.ndjson
# {"faults":["wrong-amount"],"orderId":"ord_0001","paymentId":"pay_0001","total":50.97,"uiConfirmed":true,"evaluateAt":"2026-01-15T10:02:31.000Z"}
node apps/cli/dist/main.js evaluate -r rules -e bte-report/demo/wrong-amount.ndjson --now 2026-01-15T10:02:31Z
```

```
FAIL    invoice-created-once@v1  orderId="ord_0001"  trigger=order.paid:ord_0001:pay_0001 (2026-01-15T10:00:00.000Z)
        - ASSERTION_MISMATCH: invoice.created invoice.created:inv_0001: "amount" is 24.99, expected equals 50.97 [invoice.created:inv_0001, order.paid:ord_0001:pay_0001]
```

`uiConfirmed: true` is the point: the customer saw "Order confirmed. Payment received: $50.97".

| `--fault`               | What invoicing does                              | Verdict     |
| ----------------------- | ------------------------------------------------ | ----------- |
| (none)                  | one correct invoice                              | PASS        |
| `missing-invoice`       | drops the event                                  | FAIL        |
| `duplicate-invoice`     | issues two invoices                              | FAIL        |
| `wrong-amount`          | bills only the first line item                   | FAIL        |
| `delayed-invoice`       | issues the invoice 150s later (deadline is 120s) | FAIL (late) |
| `invoicing-unavailable` | refuses queries                                  | UNKNOWN     |
| `duplicate-delivery`    | evidence pipeline delivers every record twice    | PASS        |

Run it as a real server and drive it by hand:

```bash
BTE_DEMO_FAULTS=duplicate-invoice node apps/demo/dist/main.js   # http://127.0.0.1:3000
# place an order in the browser, then:
curl -X POST http://127.0.0.1:3000/evidence/collect
curl http://127.0.0.1:3000/evidence > live.ndjson
node apps/cli/dist/main.js evaluate -r rules -e live.ndjson --now "$(date -u -v+130S +%Y-%m-%dT%H:%M:%SZ)"
```

Faults can be toggled at runtime on `/admin/faults`. The evidence collector only ever reads the
orders and invoicing systems of record and attests each read with a completeness watermark; the
engine never imports the demo.

## Keeping evidence in PostgreSQL

```bash
node apps/cli/dist/main.js ingest --postgres postgres://bte:bte@127.0.0.1:54329/bte -e bte-report/demo/wrong-amount.ndjson
node apps/cli/dist/main.js evaluate --rules rules --postgres postgres://bte:bte@127.0.0.1:54329/bte --now 2026-01-15T10:02:31Z
```

The store is append-only (database triggers refuse updates and deletes), ingest is idempotent,
every row is re-validated on read, and `--now` doubles as an "as of" cut: only evidence collected by
then is used. See [ADR 0004](docs/adr/0004-postgres-evidence-store.md).

## The Playwright proof

`tests/e2e` drives the real checkout UI in Chromium against a demo server started per worker with
a controllable clock. `packages/playwright` adds a `bte` fixture that fetches the evidence the demo
collected, runs the unmodified engine, and polls until the verdict settles, never sleeping.

```ts
const order = await checkout.submit();
await order.expectPaymentReceived(50.97); // the ordinary UI assertion: passes
await api.advanceClock(121_000); // reach the 120s deadline without waiting
await bte.expectInvariant('invoice-created-once', await order.orderId()); // FAILs when the invoice is missing
```

```bash
npx --yes pnpm@10 build
npx --yes pnpm@10 test:e2e                 # 16 gated tests: UI, API, business-truth matrix
npx --yes pnpm@10 test:e2e:demonstration   # 2 tests on one seeded missing invoice: UI passes, BTE fails
```

The demonstration's failure reads:

```
VerdictError: expected BTE verdict PASS but got FAIL
BTE FAIL: rule invoice-created-once@v1 for orderId="ord_0002"
  trigger order.paid order.paid:ord_0002:pay_0002 at 2026-01-15T10:00:00.000Z; evaluated at 2026-01-15T10:02:01.000Z
  expectation "invoice" (invoice.created): FAIL; 0 distinct in window; deadline 2026-01-15T10:02:00.000Z; source invoicing (available, authoritative, complete through 2026-01-15T10:02:01.000Z)
  - MISSING_EXPECTED_OUTCOME: 0 of 1 required invoice.created observed by 2026-01-15T10:02:00.000Z; ... [evidence: source:invoicing@2026-01-15T10:02:01.000Z, order.paid:ord_0002:pay_0002]
```

with the verdict JSON, the explanation, the evidence NDJSON, a screenshot and a Playwright trace
attached to the report (`bte-report/e2e-html`). PENDING and UNKNOWN are explicit outcomes:
`settle` fails with the last verdict if the window never closes, and `expectInvariant` fails on
UNKNOWN rather than treating "no error seen" as success.

## Repository layout

```
apps/cli              bte command line
apps/demo             Fastify shop: orders / payments / invoicing, seeded faults, evidence collector
packages/core         contracts + deterministic evaluator (no I/O)
packages/rules        YAML rule loading
packages/evidence     NDJSON evidence I/O
packages/evidence-postgres  append-only PostgreSQL evidence store
packages/playwright   BteVerifier for Playwright Test
rules/                business invariants
examples/fixtures/    evidence cases + expected verdicts
tests/e2e             Playwright suite: page objects, DemoApi, fixtures, specs
docs/                 ADRs and guides
```

## Development

```bash
npx --yes pnpm@10 verify     # lint + typecheck + test + format:check
npx --yes pnpm@10 test:watch
```

Docs: [architecture](docs/architecture.md) · [reports and exit codes](docs/reports.md) ·
[writing rules](docs/rules.md) · [development guide](docs/development.md) · ADRs in `docs/adr/` ·
[CONTRIBUTING](CONTRIBUTING.md) · [SECURITY](SECURITY.md) · [CHANGELOG](CHANGELOG.md).
[ROADMAP.md](ROADMAP.md) lists what is next and [PROGRESS.md](PROGRESS.md) the verified status.

## License

Apache-2.0. See [LICENSE](LICENSE).
