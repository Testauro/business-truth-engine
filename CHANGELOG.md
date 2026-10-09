# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog;
versions follow SemVer. Unreleased changes sit at the top.

## [Unreleased]

### Added

- Correlation chains: `expectation.correlation { trigger, observation, via: [{ type, source,
from, to }] }` lets an outcome be reached through intermediate events, with every hop source
  subject to the trust gate and completeness ladder; `CORRELATION_HOP` reasons and
  `correlation.hops[]` on the expectation verdict. Alternative trigger types: `trigger.type` may be
  a list. Example rule `examples/rules/ledger-posting-per-invoice.yaml` and catalogue
  `examples/fixtures/chain/cases.json`.

- Assertion operators `matches` / `notMatches` with a `{ pattern, flags? }` operand (validated at
  rule load) and `in` / `notIn` with an array literal or a trigger path to an array; literal
  operands may now be arrays. The reference rule checks the invoice-number format and a currency
  allow-list; new fixture `wrong-invoice-id-format`.

- Aggregate assertions on expectations: `aggregates: [{ fn, field, op, expected }]` with `sum`,
  `min`, `max`, `avg`, `count`, `distinctCount` over the distinct in-window outcomes, evaluated only
  once the set is complete; new reason code `AGGREGATE_MISMATCH`; computed values reported on the
  expectation verdict. Example rule `examples/rules/refunds-within-payment.yaml` and a second
  fixture catalogue `examples/fixtures/aggregates/cases.json`, both checked by the tests and
  `check:cli`.

- `@bte/evidence-postgres`: append-only PostgreSQL evidence store with idempotent ingest, database
  triggers refusing updates and deletes, re-validation on read, filters by type / source /
  correlation, and `collectedUntil` as-of loading (ADR 0004).
- CLI: `bte ingest --postgres <url> -e <ndjson...>`; `bte evaluate --postgres <url>
[--postgres-schema <name>] [--collected-until <iso>]`, combinable with `-e`; connection strings
  are redacted in reports. `--evidence` is now optional when `--postgres` is given.
- CI: PostgreSQL 17 service on the test job; store tests skip loudly without `BTE_TEST_POSTGRES_URL`.

## [0.1.0] - 2026-10-09

First release: the deterministic engine, CLI, demo and Playwright integration. CI green on Node
24 and 26 (https://github.com/Testauro/business-truth-engine/actions).

### Fixed (independent SDET review before release)

- Attestation selection could depend on evidence order when two attestations for one source shared
  an `observedAt`; selection is now total and conservative.
- A source attestation could claim completeness beyond its own `observedAt`, turning a pre-deadline
  snapshot into a false FAIL after the deadline; watermarks are clamped (`watermarkClamped`).
- Two CLI tests claimed to cover the no-trigger path but did not; a `no-trigger` fixture now does.
- Playwright CI retries disabled: the suite is deterministic and a flake must fail loudly.

### Added (review)

- `trigger.source` in rules: trigger events from other sources are ignored and an untrusted trigger
  source forces UNKNOWN; `RuleVerdict.triggerSource` reports the assessment. The reference rule
  declares `source: orders`. New fixtures `untrusted-trigger-source` and `no-trigger`.

### Added

- `@bte/core`: rule and evidence contracts (Zod), order-independent `EvidenceSet` with redelivery
  deduplication and source watermarks, evaluator with PASS / FAIL / PENDING / UNKNOWN, injectable
  clocks (`FixedClock`, `ManualClock`, `SystemClock`), evidence-citing reasons.
- `@bte/rules`: YAML loading with schema errors naming file and path; JSON Schema export.
- `@bte/evidence`: NDJSON reader/writer with line-numbered errors; in-memory store.
- `@bte/cli`: `bte evaluate | validate | schema`; text, JSON (schema 2, with resolved evidence
  index), JUnit and Markdown reports; `--fail-on fail|unknown|pending`; exit codes 0/1/2.
- `@bte/demo`: Fastify shop (orders, payments, invoicing) with seeded faults, read-only evidence
  collector with completeness watermarks, controllable clock, scenario runner.
- `@bte/playwright`: `BteVerifier` for Playwright Test with polling, explanations and attachments.
- `tests/e2e`: page objects, API client, fixtures, business-truth matrix, and the demonstration
  where the checkout UI passes while BTE fails on a missing invoice.
- Quality gates: strict TypeScript, type-aware ESLint with architecture boundaries, coverage
  thresholds, CLI contract and demo scenario checks, CI matrix (Node 24/26) with artifacts.
