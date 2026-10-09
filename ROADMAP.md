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

## Milestone C — Playwright demonstration

- `packages/playwright`: fixtures that start/attach to the demo, run the checkout, collect
  evidence, and expose `bte.expectInvariant(ruleId, correlation, { by })` with polling that
  stops on PASS/FAIL (no sleeps) and surfaces PENDING/UNKNOWN as explicit outcomes.
- `tests/e2e`: (1) the ordinary checkout test that passes even with a seeded invoice fault;
  (2) the BTE test that fails on the same run with a traceable verdict. Traces on failure.

## Milestone D — Reports, CI gating, docs, OSS hygiene

- JUnit + JSON reporters for BTE verdicts; GitHub Actions job gating on FAIL (UNKNOWN as a
  configurable gate); artifacts uploaded.
- Developer setup docs, rule authoring guide, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md,
  issue/PR templates, Dependabot.

## Later

- PostgreSQL evidence store (append-only, same contracts) once the deterministic engine is proven.
- Additional rule operators (regex, set membership, sums across observations).
- Multi-trigger correlation (e.g. refunds) and cross-rule dependencies.
- AI-assisted rule drafting — explicitly out of scope until deterministic verification is complete.
