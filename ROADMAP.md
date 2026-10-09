# Roadmap

Goal: an open-source quality engineering platform that verifies business invariants across
system boundaries from evidence, independently of whether the UI test passed.

## Milestone A — Deterministic core (DONE, see PROGRESS.md)

- pnpm/TypeScript strict monorepo, ESLint, Prettier, Vitest, CI skeleton.
- Rule contract (Zod) + YAML loader; evidence contract (events + source attestations) + NDJSON I/O.
- `EvidenceSet`: order-independent, redelivery-deduplicating view with source watermarks.
- Evaluator with PASS / FAIL / PENDING / UNKNOWN, injectable clock, traceable reasons.
- `bte` CLI: `evaluate`, `validate`, `schema`; JSON + text reports; exit-code gating.
- Fixture catalogue covering normal, missing, duplicate, wrong amount/currency, not-yet-due,
  unavailable source, missing attestation, no watermark, non-authoritative, lagging source,
  duplicate delivery, out-of-order, late, and mixed orders.

## Milestone B — Runnable demo with seeded faults (DONE, see PROGRESS.md)

- `apps/demo`: Fastify 5 shop with server-rendered checkout, JSON API, and orders / payments /
  invoicing modules behind one process; in-memory state; deterministic ids and injected clock.
- Fault injection via `BTE_DEMO_FAULTS` and `/admin/faults`: `missing-invoice`,
  `duplicate-invoice`, `wrong-amount`, `invoicing-unavailable`, `delayed-invoice`, `duplicate-delivery`.
- `EvidenceCollector` reads authoritative state through read-only ports and emits `order.paid`,
  `invoice.created`, and per-source attestations with watermarks; served as NDJSON on `/evidence`
  and written by `scenario.js` for the CLI.
- 34 Vitest integration tests (Fastify inject): HTTP behaviour, collector contract, and the
  fault-to-verdict matrix evaluated with the real rule through `@bte/core`.

## Milestone C — Playwright demonstration (DONE, see PROGRESS.md)

- `packages/playwright`: `BteVerifier` (evaluate / settle / expectVerdict / expectInvariant) over an
  HTTP evidence source and the SUT's clock; `expect.poll`-based settling with explicit PENDING and
  UNKNOWN outcomes; verdict, explanation and evidence attached to the Playwright report.
- `tests/e2e`: per-worker in-process demo server with controllable clock, `CheckoutPage` /
  `OrderPage`, typed `DemoApi`, test data, 16 gated specs (UI, API, business-truth matrix) and the
  `@demonstration` pair where the UI test passes and the BTE test fails by design. Traces retained
  on failure, HTML + JUnit reports under `bte-report/`.

## Milestone D — Reports, CI gating, docs, OSS hygiene (DONE, see PROGRESS.md)

- CLI reports: JSON schema 2 with a resolved evidence index, JUnit XML (failure / skipped per gate,
  evidence ids as properties), Markdown for step summaries; documented exit codes 0 / 1 / 2.
- Quality gates: architecture boundaries enforced by ESLint, coverage thresholds, `check:cli` and
  `check:scenarios` contract scripts, `pnpm verify` composite; CI matrix Node 24 / 26 with
  artifacts, step summary and a `fail_on` workflow input; Dependabot.
- Docs: architecture, reports and exit codes, development guide, CONTRIBUTING, SECURITY,
  CODE_OF_CONDUCT, CHANGELOG, issue and PR templates, README quickstart.

## Later

- ~~PostgreSQL evidence store~~ done (ADR 0004): `@bte/evidence-postgres`, `bte ingest`, `--postgres`, as-of replay.
- ~~Sums across observations~~ done: aggregate assertions (`sum`/`min`/`max`/`avg`/`count`/`distinctCount`).
- ~~Additional rule operators (regex, set membership)~~ done: `matches` / `notMatches` / `in` / `notIn`.
- ~~Multi-trigger correlation~~ done: correlation chains through intermediate events and alternative trigger types (ADR 0002 5c/5d).
- Cross-rule dependencies.
- AI-assisted rule drafting — explicitly out of scope until deterministic verification is complete.
