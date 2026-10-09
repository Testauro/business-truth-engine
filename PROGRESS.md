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

## Milestone B — Demo with seeded faults: NOT STARTED

## Milestone C — Playwright demonstration: NOT STARTED

## Milestone D — Reports, CI gating, OSS hygiene: PARTIAL

- Done in A: JSON report, exit-code gating, CI workflow file, Apache-2.0 license.
- Remaining: JUnit output for verdicts, CONTRIBUTING / SECURITY / CODE_OF_CONDUCT, templates.
