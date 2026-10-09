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

## Milestone B — Runnable demo with seeded faults

- `apps/demo`: Fastify app with checkout UI (server-rendered HTML + minimal JS), orders,
  payments, and invoicing modules behind one process; in-memory state.
- Fault injection via env / admin endpoint: `missing-invoice`, `duplicate-invoice`,
  `wrong-amount`, `invoicing-unavailable`, `delayed-invoice`, `duplicate-delivery`.
- Authoritative evidence collection: an evidence collector queries the invoicing system of
  record and emits `invoice.created` events plus `source` attestations with watermarks;
  orders/payments emit `order.paid`. Output: NDJSON file per run.
- Demo-level tests (Vitest + Fastify inject) for each fault mode.

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
