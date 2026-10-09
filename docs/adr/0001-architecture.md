# ADR 0001: Monorepo with a pure core

Status: accepted (2026-10-09)

## Context

BTE must verify business invariants across system boundaries. It will integrate with
Playwright, a Fastify demo, file and database evidence stores, and (much later) LLM tooling.
The verification logic must remain trustworthy and testable regardless of those integrations.

## Decision

- pnpm workspace, TypeScript strict, ESM, Node >= 24.
- `packages/core` contains only contracts (Zod), the deduplicating `EvidenceSet`, and the
  evaluator. It depends on `zod` and nothing else; it performs no I/O and never reads the wall
  clock (a `Clock` is injected).
- Adapters (`packages/rules`, `packages/evidence`, `packages/playwright`, `apps/*`) depend on
  core through its typed, runtime-validated contracts. Core never depends on them.
- Evidence starts as NDJSON files. A PostgreSQL store will implement the same contracts later.
- Vitest for unit and property tests; Playwright Test only for end-to-end demonstrations.

## Consequences

- The engine can be exercised exhaustively with fixtures and fast-check without any services.
- Verdicts are reproducible: same rules + same evidence + same `--now` = byte-identical output.
- Adapters must translate their native data into `EvidenceRecord`s; they cannot reach into
  evaluator internals.
