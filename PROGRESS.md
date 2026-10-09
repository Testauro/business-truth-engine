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

- The live server was smoke-tested manually with curl; no automated test starts a real listener yet
  (Milestone C's Playwright `webServer` will).
- Demo state is in-memory and resets on restart; there is no persistence or multi-process story.
- `delayed-invoice` uses a fixed 150s delay; the live server needs real wall time to show it.

## Milestone C — Playwright demonstration: NOT STARTED

## Milestone D — Reports, CI gating, OSS hygiene: PARTIAL

- Done in A/B: JSON report, exit-code gating, CI workflow file (now also runs demo scenarios), Apache-2.0 license.
- Remaining: JUnit output for verdicts, CONTRIBUTING / SECURITY / CODE_OF_CONDUCT, templates.
