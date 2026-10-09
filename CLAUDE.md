# Business Truth Engine (BTE)

BTE proves whether critical business outcomes are correct across application boundaries,
even when a normal Playwright UI test passes. Rules are declarative YAML invariants; verdicts
come only from evidence.

## Architecture boundaries (enforced; do not cross)

| Package / app         | Owns                                                                   | May depend on                      |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `packages/core`       | Rule + evidence contracts (Zod), `EvidenceSet` dedup, evaluator, clock | `zod` only. No I/O, no Node APIs.  |
| `packages/rules`      | YAML rule loading / validation                                         | core, `yaml`, Node fs              |
| `packages/evidence`   | NDJSON read/write, in-memory store                                     | core, Node fs                      |
| `packages/playwright` | (Milestone C) fixtures that record evidence from Playwright tests      | core, evidence, `@playwright/test` |
| `apps/cli`            | `bte evaluate / validate / schema`, JSON + text reports                | core, rules, evidence, `commander` |
| `apps/demo`           | (Milestone B) Fastify order/payment/invoice demo with seeded faults    | fastify; never imported by core    |
| `rules/`              | Versioned business invariants (YAML)                                   |                                    |
| `examples/fixtures/`  | NDJSON evidence cases + `cases.json` expected verdicts                 |                                    |

The core engine must stay independent of Playwright, Fastify, storage, and LLM clients.
Adapters talk to core only through the typed contracts in `packages/core/src/contracts`.

## Verdict rules (see docs/adr/0002-verdict-semantics.md)

- Four verdicts: `PASS`, `FAIL`, `PENDING`, `UNKNOWN`. Combined with precedence FAIL > UNKNOWN > PENDING > PASS.
- Never PASS because nothing bad was seen. PASS needs an available, authoritative source whose
  `completeThrough` watermark is at or past the deadline (for bounded cardinality).
- Missing / unavailable / non-authoritative / un-watermarked source evidence => `UNKNOWN`.
- Window still open, or healthy source lagging behind the deadline => `PENDING`.
- Duplicate, mismatched value, late, or confirmed-missing outcome => `FAIL`.
- `occurredAt` (business time) drives windows; `collectedAt` never does.
- Redeliveries share an `eventId` and count once; conflicting redeliveries => `UNKNOWN`.
- The evaluator takes an injected `Clock`; CLI runs must pass `--now` to be reproducible.

## Commands

```bash
npx --yes pnpm@10 install          # pnpm is not installed globally on this machine
npx --yes pnpm@10 build            # tsc -b (project references)
npx --yes pnpm@10 typecheck        # strict build + test typecheck
npx --yes pnpm@10 lint             # eslint (type-aware)
npx --yes pnpm@10 test             # vitest (unit + property + fixture tests)
npx --yes pnpm@10 format:check     # prettier
npx --yes pnpm@10 verify           # all of the above
node apps/cli/dist/main.js evaluate -r rules -e examples/fixtures/duplicate-invoice.ndjson --now 2026-01-15T10:03:00Z
```

## Code standards

- TypeScript strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`; ESM; `.js` import suffixes.
- No `any`, no non-null assertions, no unsafe casts. Validate every external input with Zod.
- Deterministic everything: sort before output, never read `Date.now()` outside `SystemClock`.
- Tests live in `<package>/test/*.test.ts`; fixture expectations in `examples/fixtures/cases.json`.
- Playwright (Milestone C): accessible locators, web-first assertions, no hard-coded sleeps, POM only where it helps.

## Verification rules

- Do not claim a test passed unless it was executed and its output inspected.
- Do not disable failing tests or weaken assertions to go green.
- No placeholder implementations for acceptance-critical paths.
- Update `PROGRESS.md` after each verified milestone. Keep `ROADMAP.md` current.
- Never push, publish, deploy, or create cloud resources without explicit approval. Secrets stay out of Git (`.env.example` only).
