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

## Milestone D — Reports, CI gating, OSS hygiene: PARTIAL

- Done in A/B/C: JSON report, exit-code gating, CI workflow (demo scenarios + Playwright), JUnit for unit and E2E, Apache-2.0 license.
- Remaining: JUnit output for verdicts, CONTRIBUTING / SECURITY / CODE_OF_CONDUCT, templates.
