# Development guide

## Prerequisites

- Node.js 24 or 26 (`engines.node >= 24`).
- pnpm 10. If it is not installed, every command below works as `npx --yes pnpm@10 <script>`.
- For the Playwright suite: Chromium headless shell. `pnpm --filter @bte/e2e exec playwright install chromium --only-shell`
  downloads it into Playwright's user cache (outside the repo).

## First run

```bash
npx --yes pnpm@10 install
npx --yes pnpm@10 build
node apps/cli/dist/main.js evaluate -r rules -e examples/fixtures/duplicate-invoice.ndjson --now 2026-01-15T10:03:00Z
```

## Commands

| Command                                                       | What it does                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm build`                                                  | `tsc -b` over all project references into `dist/`                                  |
| `pnpm typecheck`                                              | strict build + typecheck of tests and `tests/e2e`                                  |
| `pnpm lint`                                                   | type-aware ESLint, including architecture-boundary rules                           |
| `pnpm format` / `format:check`                                | Prettier                                                                           |
| `pnpm test`                                                   | Vitest: unit, property, integration, fixture catalogue                             |
| `pnpm test:coverage`                                          | same with V8 coverage and thresholds (`bte-report/coverage`)                       |
| `pnpm check:cli`                                              | built CLI against fixtures: verdicts, exit codes, reproducibility                  |
| `pnpm check:scenarios`                                        | every demo fault: scenario -> NDJSON -> CLI, verdict asserted                      |
| `pnpm test:e2e`                                               | Playwright gated suite (needs `pnpm build`)                                        |
| `pnpm test:e2e:demonstration`                                 | the UI-passes / BTE-fails pair; exits 1 by design                                  |
| `pnpm check:demonstration`                                    | runs the pair and asserts, from JUnit, that it failed for exactly the right reason |
| `pnpm verify:quick`                                           | lint + typecheck + test                                                            |
| `pnpm verify`                                                 | everything above except the demonstration                                          |
| `pnpm demo:start`                                             | live demo on `BTE_DEMO_PORT` (see `.env.example`)                                  |
| `pnpm demo:scenario -- --fault wrong-amount --out out.ndjson` | one in-process checkout with a seeded fault                                        |

Reports land in `bte-report/` (git-ignored): CLI outputs, coverage, Playwright HTML, JUnit, traces.

## Repository conventions

- TypeScript strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; ESM with
  `.js` import suffixes; no `any`, no non-null assertions.
- Every external input crosses a Zod schema. Determinism: sort before output; the wall clock is read
  only in `SystemClock`.
- Tests: `<package>/test/*.test.ts` (Vitest), `tests/e2e/specs/*.spec.ts` (Playwright). Fixture
  expectations live in `examples/fixtures/cases.json`, shared by unit tests and `check:cli`.
- Rule semantics changes require an ADR update (`docs/adr/0002-verdict-semantics.md`).

## Troubleshooting

- `pnpm: command not found`: use `npx --yes pnpm@10 ...` (pin the major; bare `npx pnpm` may fetch another).
- `Executable doesn't exist ... chrome-headless-shell`: run the Playwright install command above.
- Playwright tests all failing to connect: each worker starts its own demo on port 0; nothing to
  configure. To test an external server, start it with `BTE_DEMO_CLOCK=manual` and set
  `BTE_E2E_BASE_URL`, then run with `--workers=1`.
- `bte evaluate` exits 2: read the first stderr line; rule errors list the schema path, evidence
  errors give `file:line`.
