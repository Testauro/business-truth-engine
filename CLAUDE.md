# Business Truth Engine (BTE)

BTE proves whether critical business outcomes are correct across application boundaries,
even when a normal Playwright UI test passes. Rules are declarative YAML invariants; verdicts
come only from evidence.

## Architecture boundaries (enforced; do not cross)

| Package / app                | Owns                                                                                                                   | May depend on                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/core`              | Rule + evidence contracts (Zod), `EvidenceSet` dedup, evaluator, clock                                                 | `zod` only. No I/O, no Node APIs.                           |
| `packages/rules`             | YAML rule loading / validation                                                                                         | core, `yaml`, Node fs                                       |
| `packages/evidence`          | NDJSON read/write, in-memory store                                                                                     | core, Node fs                                               |
| `packages/evidence-postgres` | append-only PostgreSQL store, idempotent ingest, filtered / as-of loading                                              | core, `pg`                                                  |
| `packages/playwright`        | `BteVerifier`: evaluate rules from fetched evidence inside Playwright tests; polling, explanations, report attachments | core, evidence, rules, `@playwright/test` (peer)            |
| `packages/sdk`               | public SDK: defineRule/defineConfig, config loader (env, .env), source registry, verify                                | core, rules, evidence, evidence-http                        |
| `packages/evidence-http`     | REST adapter: auth from env, mapping, completeness attestation                                                         | core                                                        |
| `examples/learning-platform` | independent consumer (third party); installs BTE from dist-packages/*.tgz only; never edit BTE core for it             | own package.json                                            |
| `tests/e2e`                  | Playwright suite: per-worker demo server, page objects, `DemoApi`, test data, specs                                    | demo, playwright, rules, `@playwright/test`                 |
| `apps/cli`                   | `bte evaluate / validate / schema`, JSON + text reports                                                                | core, rules, evidence, `commander`                          |
| `apps/demo`                  | Fastify shop: orders, payments, invoicing modules, seeded faults, read-only `EvidenceCollector`                        | core (contracts), evidence, fastify; never imported by core |
| `rules/`                     | Versioned business invariants (YAML)                                                                                   |                                                             |
| `examples/fixtures/`         | NDJSON evidence cases + `cases.json` expected verdicts                                                                 |                                                             |

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
npx --yes pnpm@10 test:coverage    # same with coverage thresholds (bte-report/coverage)
npx --yes pnpm@10 check:cli        # built CLI vs fixtures: verdicts, exit codes, reproducibility
npx --yes pnpm@10 check:scenarios  # every demo fault -> NDJSON -> CLI, verdict asserted
BTE_TEST_POSTGRES_URL=postgres://bte:bte@127.0.0.1:54329/bte npx --yes pnpm@10 test   # include the store tests
npx --yes pnpm@10 format:check     # prettier
npx --yes pnpm@10 test:e2e         # Playwright suite (needs `pnpm build` first; chromium headless shell cached)
npx --yes pnpm@10 test:e2e:demonstration   # the deliberate UI-passes / BTE-fails pair; exits 1 by design
npx --yes pnpm@10 check:demonstration      # runs it and asserts from JUnit that it failed for the right reason
npx --yes pnpm@10 verify:quick     # lint + typecheck + test (inner loop)
npx --yes pnpm@10 pack:packages    # dist-packages/*.tgz for consumers
(cd examples/learning-platform && npm install && npx playwright test)   # consumer acceptance
npx --yes pnpm@10 verify           # the full gate: lint, typecheck, format, coverage, check:cli, check:scenarios, e2e
node apps/cli/dist/main.js evaluate -r rules -e examples/fixtures/duplicate-invoice.ndjson --now 2026-01-15T10:03:00Z
# demo: in-process scenario -> NDJSON -> CLI
node apps/demo/dist/scenario.js --fault duplicate-invoice --out bte-report/demo/dup.ndjson
node apps/cli/dist/main.js evaluate -r rules -e bte-report/demo/dup.ndjson --now 2026-01-15T10:02:31Z
BTE_DEMO_FAULTS=wrong-amount node apps/demo/dist/main.js   # live server on :3000
BTE_DEMO_CLOCK=manual node apps/demo/dist/main.js          # controllable clock: POST /admin/clock/advance {ms}
```

## Demo app rules (apps/demo)

- Faults live only in `domain/invoicing.ts` (plus `duplicate-delivery` in the collector). Checkout and
  payment code paths never branch on faults; the UI must look identical with or without them.
- `evidence/collector.ts` reads through `OrdersReadModel` / `InvoicesReadModel` only. It never
  calls command methods and the domain modules never import anything evidence-related.
- Every `collect()` emits a `source` attestation per system with `completeThrough` = collection
  instant (synchronous snapshot), or `status: unavailable` when the read throws.
- Delayed invoices materialise in `InvoicingService.tick()`; `createdAt` is the tick time so earlier
  watermarks stay truthful. Tests call `tick()` explicitly; the server ticks on traffic and a timer.
- Demo time comes from the injected `Clock` (`ManualClock` in tests/scenarios, `SystemClock` live).
  Ids come from `IdSequence`, never randomness, so scenario output is byte-reproducible.

## Code standards

- TypeScript strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`; ESM; `.js` import suffixes.
- No `any`, no non-null assertions, no unsafe casts. Validate every external input with Zod.
- Deterministic everything: sort before output, never read `Date.now()` outside `SystemClock`.
- Tests live in `<package>/test/*.test.ts`; fixture expectations in `examples/fixtures/cases.json`.
- Playwright: accessible locators (`getByRole` / `getByLabel` / `getByTestId`), web-first assertions,
  no `waitForTimeout`; polling only through `expect.poll` inside `BteVerifier.settle`.
  Page objects (`tests/e2e/pages`) wrap pages only; business checks go through `DemoApi` and `bte`.

## E2E rules (tests/e2e)

- Each worker owns an in-process demo server on a free port with a `ManualClock`; tests never share
  fault state. `api` fixture resets faults before and after every test.
- Deadlines are reached by `api.advanceClock(ms)`, never by waiting. The verifier evaluates at the
  demo's clock (`/admin/clock`), so rule windows stay real (120s).
- `bte.expectInvariant(ruleId, orderId)` must PASS; `bte.expectVerdict(..., 'FAIL' | 'UNKNOWN')` for
  seeded faults; `bte.evaluate` for a single non-polling look (e.g. asserting PENDING).
- `specs/demonstration.spec.ts` is `@demonstration`-tagged and excluded from the gate because its
  second test fails on purpose. Never "fix" it to pass.

## Quality gates (all enforced by `pnpm verify` and CI)

- Architecture boundaries are ESLint rules (`no-restricted-imports` overrides in `eslint.config.js`);
  see `docs/architecture.md`. Do not relax them; move code instead.
- Coverage thresholds live in `vitest.config.ts`. Raise them when coverage grows; lower them only
  with a written reason in the PR.
- CLI exit codes are a contract (`docs/reports.md`): 0 gate passed, 1 gate failed, 2 could not
  evaluate. Report schema changes bump `REPORT_SCHEMA_VERSION` and the docs.
- `examples/fixtures/cases.json` is the single source of truth for expected verdicts; unit tests
  and `check:cli` both read it.

## Verification rules

- Do not claim a test passed unless it was executed and its output inspected.
- Do not disable failing tests or weaken assertions to go green.
- No placeholder implementations for acceptance-critical paths.
- Update `PROGRESS.md` after each verified milestone. Keep `ROADMAP.md` current.
- Never push, publish, deploy, or create cloud resources without explicit approval. Secrets stay out of Git (`.env.example` only).
