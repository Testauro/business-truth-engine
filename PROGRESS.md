# Progress

Updated after each verified milestone. Verification means the command was executed locally
and the output inspected.

## Milestone A — Deterministic core: COMPLETE (2026-10-09)

Environment: macOS, Node v26.3.0, pnpm 10.34.6 via `npx --yes pnpm@10` (not installed globally).

| Check                           | Command                          | Result                                     |
| ------------------------------- | -------------------------------- | ------------------------------------------ |
| Install                         | `npx --yes pnpm@10 install`      | OK (190 packages)                          |
| Strict typecheck + build        | `npx --yes pnpm@10 typecheck`    | OK, 0 errors                               |
| Lint (type-aware, strict)       | `npx --yes pnpm@10 lint`         | OK, 0 problems                             |
| Unit / property / fixture tests | `npx --yes pnpm@10 test`         | 11 files, 117 tests passed                 |
| Formatting                      | `npx --yes pnpm@10 format:check` | OK                                         |
| CLI on 16 fixtures (built dist) | see README "Try it"              | all verdicts as catalogued in `cases.json` |
| Reproducibility                 | same evaluation twice, `shasum`  | identical JSON output                      |

Delivered:

- `packages/core`: contracts, `EvidenceSet`, evaluator, clock, duration, path utilities.
- `packages/rules`: YAML loader with schema errors naming file and path; JSON Schema export.
- `packages/evidence`: NDJSON stream reader/writer with line-numbered errors; in-memory store.
- `apps/cli`: `bte evaluate | validate | schema`, text/JSON reports, `--fail-on` gating.
- `rules/invoice-created-once.yaml`, `examples/fixtures/*.ndjson` + `cases.json`.
- Docs: `CLAUDE.md`, `ROADMAP.md`, ADRs 0001–0003, `docs/rules.md`; CI workflow; Apache-2.0.

Not yet verified / known gaps:

- GitHub Actions workflow has not been executed (nothing has been pushed; pushing needs approval).
- `packages/playwright`, `apps/demo`, `tests/e2e` do not exist yet (Milestones B/C).
- Only one rule operator family (equals/notEquals/ordering); no aggregate assertions.

## Milestone B — Demo with seeded faults: COMPLETE (2026-10-09)

| Check                                    | Command / action                                                                                 | Result                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install (fastify, @fastify/formbody)     | `npx --yes pnpm@10 install`                                                                      | OK (238 packages)                                                                                                                                   |
| Strict typecheck + build                 | `npx --yes pnpm@10 typecheck`                                                                    | OK, 0 errors                                                                                                                                        |
| Lint                                     | `npx --yes pnpm@10 lint`                                                                         | OK, 0 problems                                                                                                                                      |
| Tests                                    | `npx --yes pnpm@10 test`                                                                         | 14 files, 151 tests passed (34 new in `apps/demo/test`)                                                                                             |
| Formatting                               | `npx --yes pnpm@10 format:check`                                                                 | OK                                                                                                                                                  |
| Scenario -> NDJSON -> CLI, 7 fault modes | `node apps/demo/dist/scenario.js --fault <f> --out ...` then `bte evaluate`                      | none=PASS, missing=FAIL, duplicate=FAIL, wrong-amount=FAIL, unavailable=UNKNOWN, delayed=FAIL(late), duplicate-delivery=PASS; UI confirmed in all 7 |
| Scenario reproducibility                 | same fault twice, `cmp`                                                                          | identical NDJSON                                                                                                                                    |
| Live server smoke test                   | `BTE_DEMO_FAULTS=duplicate-invoice node apps/demo/dist/main.js`, curl checkout, `/evidence`, CLI | 303 -> order page "Payment received: $50.97"; 2 invoices; CLI FAIL DUPLICATE_OUTCOME                                                                |

Delivered:

- `apps/demo/src/domain`: `OrderService`, `PaymentService` (publishes `order.paid`), `InvoicingService`
  (system of record; hosts the seeded faults; delayed queue with `tick()`), in-process `EventBus`,
  deterministic `IdSequence`, integer-cent money.
- `apps/demo/src/evidence/collector.ts`: read-only collector over `OrdersReadModel` /
  `InvoicesReadModel`, emits events + attestations with `completeThrough`, duplicate-delivery mode,
  append-only store, NDJSON writer.
- `apps/demo/src/http/app.ts`: UI (`/`, `/checkout`, `/orders/:id`), API (`/api/orders`,
  `/api/orders/:id/pay`, `/api/invoices`), admin (`/admin/faults`, `/admin/state`), evidence
  (`POST /evidence/collect`, `GET /evidence` NDJSON), `/health`. Zod on every input, HTML escaping.
- `apps/demo/src/main.ts` (env-configured server) and `scenario.ts` / `scenario-runner.ts`
  (in-process checkout + collection with a `ManualClock`, NDJSON out).
- `packages/core`: `ManualClock` (advance / set) for deterministic timelines.
- Tests: `http.test.ts` (13), `collector.test.ts` (5), `invariant.test.ts` (16: fault matrix,
  timeline honesty PENDING -> SOURCE_INCOMPLETE -> FAIL, delayed invoice becomes LATE, UNKNOWN recovers
  to PASS, admin-toggled faults, NDJSON round trip).

Defect found and fixed during this milestone:

- The first `wrong-amount` seeding billed the subtotal; the scenario basket qualified for free
  shipping so subtotal equalled total and the fault was invisible (test caught it: expected FAIL,
  got PASS). Re-seeded as a multi-line bug (invoice carries only the first line), which the two-line
  basket exposes (24.99 vs 50.97).

Not yet verified / known gaps:

- ~~No automated test starts a real listener yet~~ (Milestone C starts a real listener per worker).
- Demo state is in-memory and resets on restart; there is no persistence or multi-process story.
- `delayed-invoice` uses a fixed 150s delay; the live server needs real wall time to show it.

## Milestone C — Playwright demonstration: COMPLETE (2026-10-09)

| Check                             | Command                                                      | Result                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Typecheck (incl. tests/e2e)       | `npx --yes pnpm@10 typecheck`                                | OK, 0 errors                                                                                                                                                                                                                                                                         |
| Lint                              | `npx --yes pnpm@10 lint`                                     | OK, 0 problems                                                                                                                                                                                                                                                                       |
| Unit / integration tests          | `npx --yes pnpm@10 test`                                     | 15 files, 152 tests passed                                                                                                                                                                                                                                                           |
| Formatting                        | `npx --yes pnpm@10 format:check`                             | OK                                                                                                                                                                                                                                                                                   |
| Playwright gated suite (chromium) | `npx --yes pnpm@10 test:e2e`                                 | 16 passed in ~3s on 5 workers (4 UI, 4 API, 8 business-truth)                                                                                                                                                                                                                        |
| Demonstration pair                | `npx --yes pnpm@10 test:e2e:demonstration`                   | test 1 (UI) passed; test 2 (BTE) failed by design: `VerdictError: expected BTE verdict PASS but got FAIL ... MISSING_EXPECTED_OUTCOME [evidence: source:invoicing@..., order.paid:ord_0002:pay_0002]`; trace.zip, screenshot, verdict JSON, explanation and evidence NDJSON attached |
| Reports                           | `bte-report/e2e-html/index.html`, `bte-report/e2e-junit.xml` | generated                                                                                                                                                                                                                                                                            |

Delivered:

- `packages/playwright`: `BteVerifier` with `evaluate` (single look), `settle` (polls via `expect.poll`,
  refreshing evidence each time; PENDING past the budget is an explicit failure quoting the last
  verdict), `expectVerdict`, `expectInvariant`; `explainVerdict`; `httpEvidenceSource`; attachments.
- `apps/demo`: `BTE_DEMO_CLOCK=manual`, `GET /admin/clock`, `POST /admin/clock/advance` (ticks
  delayed invoices), `manualClock` option on `buildDemo`.
- `tests/e2e`: `fixtures/demo-server.ts` (real listener per worker on port 0, or `BTE_E2E_BASE_URL`),
  `fixtures/test.ts` (`api`, `checkout`, `bte`, worker-scoped `rules` and `demoServer`, `baseURL`
  override), `pages/checkout.page.ts`, `pages/order.page.ts`, `api/demo-api.ts` (Zod-validated
  client), `data/test-data.ts`, specs `checkout`, `api`, `business-truth`, `demonstration`.
- Business-truth matrix in E2E: happy path (PENDING -> PASS), missing invoice (FAIL), duplicate
  invoice (FAIL citing both events), incorrect amount (FAIL 24.99 vs 50.97), unknown evidence
  (UNKNOWN -> recovers to PASS), delayed invoice (PENDING -> late FAIL), duplicate delivery (PASS),
  and "settle never upgrades PENDING".
- Every business-truth test also verifies order, payment and invoice state through the API,
  independently of the page.

Defects found and fixed during this milestone:

- `BteVerifier.settle` built its `expect.poll` message eagerly, so a PENDING timeout did not quote
  the last verdict (test "settle never upgrades PENDING" caught it). The error is now composed after
  polling, attaches the last verdict, and keeps the original error as `cause`.
- Two `exactOptionalPropertyTypes` violations in `playwright.config.ts` (conditional spreads now).

Environment notes:

- Playwright 1.64 needed chromium headless shell build 1248; it was downloaded into Playwright's
  user cache (`~/Library/Caches/ms-playwright`), outside the repository, like the npm cache.

Not yet verified / known gaps:

- CI has not run (nothing pushed). The workflow installs chromium and runs the gated suite plus the
  demonstration pair, asserting the pair exits non-zero.
- Only chromium is configured; firefox/webkit projects are a one-line addition.
- The E2E suite drives the in-process demo; `BTE_E2E_BASE_URL` against an external server is
  supported but was not exercised in this session.

## Milestone D — Reports, CI gating, OSS hygiene: COMPLETE (2026-10-09)

| Check                               | Command                                        | Result                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint incl. architecture boundaries  | `pnpm lint`                                    | 0 problems; probe files importing `node:fs` / `fastify` / `@bte/rules` into core and `@bte/demo` into playwright were rejected (3 + 1 errors), then removed |
| Typecheck                           | `pnpm typecheck`                               | 0 errors                                                                                                                                                    |
| Format                              | `pnpm format:check`                            | clean                                                                                                                                                       |
| Unit / integration / property tests | `pnpm test:coverage`                           | 21 files, 197 tests; coverage 97.41% statements, 88.32% branches, 97.42% functions, 98.66% lines; thresholds met                                            |
| CLI contract                        | `pnpm check:cli`                               | 10 exit-code checks, reproducibility, 16 catalogued fixtures: all ok                                                                                        |
| Demo scenarios                      | `pnpm check:scenarios`                         | 7 faults: UI confirmed in all; verdicts and exit codes as catalogued                                                                                        |
| Playwright gated suite              | `pnpm test:e2e`                                | 16 passed                                                                                                                                                   |
| Composite gate                      | `pnpm verify`                                  | passed end to end                                                                                                                                           |
| Demonstration                       | `pnpm test:e2e:demonstration`                  | UI test passed, BTE test failed by design, exit 1                                                                                                           |
| Demonstration gate                  | `pnpm check:demonstration`                     | asserts from JUnit: UI passed, BTE failed with MISSING_EXPECTED_OUTCOME; negative controls (wrong fault, no fault) rejected                                 |
| Property-test stress                | 20 runs of `evaluate.property.test.ts`         | 0 failures                                                                                                                                                  |
| Live demo with manual clock         | `BTE_DEMO_CLOCK=manual pnpm demo:start` + curl | checkout 303, `/admin/clock/advance` 121s, collect, CLI Markdown report FAIL on wrong-amount                                                                |
| `pnpm demo:scenario -- --fault x`   | via pnpm                                       | works (after fix below)                                                                                                                                     |

Delivered:

- `apps/cli`: report schema 2 (`gate`, `exitCode`, resolved `evidence` index), `--junit`, `--markdown`,
  `--format markdown`; exit codes 0 / 1 / 2 (usage errors now 2); `scripts/check-cli.sh`.
- Quality gates: ESLint `no-restricted-imports` boundaries per package; Vitest coverage thresholds
  (global 90/85/90/90, core 97/100/85/95); `scripts/check-demo-scenarios.sh`; `pnpm verify` and
  `pnpm verify:quick`.
- CI: `quality`, `test` (Node 24 and 26 matrix, coverage, CLI contract, scenarios, gated fixture
  evaluation with `workflow_dispatch` input `fail_on`, Markdown step summary, artifacts) and `e2e`
  (Playwright suite + demonstration must fail, HTML report and traces uploaded); Dependabot.
- Docs: `docs/architecture.md`, `docs/reports.md`, `docs/development.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, issue / PR templates, README quickstart,
  `.env.example` covering every variable.
- Tests added for failure scenarios: `apps/cli/test/failures.test.ts` (malformed evidence with
  file:line, invalid rule listing schema issues, empty rules dir, usage errors, gate escalation,
  report files), `report.test.ts` (evidence index, JUnit mapping and escaping, Markdown),
  `packages/core/test/assertions.test.ts`, `clock.test.ts`, `contracts.test.ts`, evidence-set
  ties, conflicting trigger redelivery, multi-rule ordering, demo `config.test.ts` and clock control.

Defects found and fixed during this milestone:

- **Determinism bug in `EvidenceSet`** (found by a one-off property-test failure, reproduced by
  reasoning about the generator): two deliveries with the same `eventId`, identical `collectedAt`,
  no `deliveryId` and different payloads had no total order, so the canonical delivery depended on
  input order. `deliveryOrder` now falls back to a stable content key; a direct unit test covers it
  and 20 stress runs of the property suite are clean.
- `pnpm demo:scenario -- --fault x` crashed because pnpm forwards the literal `--`; the scenario
  entrypoint now strips it.
- `scripts/check-demo-scenarios.sh` used an empty-array expansion that macOS bash 3.2 rejects under
  `set -u`; replaced with the portable idiom.
- `pnpm test:e2e:demonstration` ran zero tests (the config's `grepInvert` excluded the spec unless
  `BTE_E2E_INCLUDE_DEMONSTRATION` was set) and still exited 1, which CI would have accepted as
  "failed by design". The script now sets the variable, and `scripts/check-demonstration.sh` parses
  the JUnit output to require the UI test to pass and the BTE test to fail with the expected reason.
- Coverage thresholds were first set too high for the untested assertion operators, clocks and demo
  config; tests were added rather than thresholds lowered, except core branches (85%) and core
  statements (95%), which reflect defensive `unreachable` guards.

## Release readiness (0.1.0)

Ready to tag as `v0.1.0`: every gate passes locally and in GitHub Actions on Node 24 and 26. Verified in this environment (macOS, Node 26.3.0,
pnpm 10.34.6 via npx, Chromium headless shell 1248):

- Every documented command in `docs/development.md` was executed and succeeded.
- `pnpm verify` passes end to end; the demonstration fails for the right reason with trace and
  attachments.
- The CLI contract (verdicts, exit codes, reproducibility, report files) is covered by unit tests,
  `check:cli`, and the fixture catalogue, which is the single source of truth for expected verdicts.

Remaining before a public release:

- ~~GitHub Actions has never run~~ **Resolved 2026-10-09.** Pushed to
  https://github.com/Testauro/business-truth-engine (private). Run 37887740270 failed in the
  quality job because type-aware lint ran before `dist/` existed (198 unsafe-type errors); fixed in
  `713c04f` by building first. Run 37887873081 then passed all four jobs in 1.6 minutes: quality,
  test on Node 24 and Node 26 (coverage, CLI contract, demo scenarios, gated fixture step),
  Playwright gated suite plus the JUnit-verified demonstration. Artifacts: `bte-report-node24`,
  `bte-report-node26`, `playwright-report`.
- Package publishing is not configured (all packages are `private`-adjacent workspace packages with
  `files: dist`); publishing needs an explicit decision and approval.
- No SBOM, signing, or provenance; add when publishing is decided.

## What's next

ROADMAP "Later": PostgreSQL evidence store, aggregate assertions, multi-trigger correlation,
additional browsers in Playwright, and only then AI-assisted rule drafting.
