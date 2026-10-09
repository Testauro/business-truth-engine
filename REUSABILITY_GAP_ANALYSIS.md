# Reusability gap analysis

Audit date: 2026-10-09, commit `0d9b94f`. Method: grep and read the reusable packages, pack three
packages with `pnpm pack`, test native TypeScript config import on the supported Node range.

## What already works for a third party

| Capability                                   | Evidence                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain-agnostic engine                       | `grep -i invoice\|orderId` over `packages/core/src` finds 5 hits, all doc comments; `rules`, `evidence`, `evidence-postgres`, `playwright`, `cli` sources: 0 hits |
| Declarative, versioned rules with validation | `packages/core/src/contracts/rule.ts` (Zod, strict, refinements); `packages/rules` YAML loader with file:path errors; `bte validate`                              |
| Normalized evidence contract                 | `packages/core/src/contracts/evidence.ts`: `event` + `source` attestation records, ISO times, strict keys                                                         |
| Honest verdicts                              | ADR 0002: absence is FAIL only with a complete authoritative source; untrusted/unattested → UNKNOWN; open window → PENDING                                        |
| Dedup / out-of-order / redelivery            | `EvidenceSet` (order-independent, total ordering, conflict detection); property tests                                                                             |
| Offline NDJSON ingestion                     | `@bte/evidence` reader/writer; CLI `-e`                                                                                                                           |
| Read-only database store                     | `@bte/evidence-postgres`: append-only, idempotent, as-of loading                                                                                                  |
| Reports                                      | JSON schema 2 with evidence index, JUnit, Markdown; exit codes 0/1/2                                                                                              |
| Playwright verifier                          | `BteVerifier` (poll, settle, explain, attachments)                                                                                                                |
| Packability                                  | `pnpm pack` of `@bte/core`, `@bte/playwright`, `@bte/cli`: `dist/` + `.d.ts` present, `workspace:*` rewritten to `0.1.0`, `bin.bte` present                       |

## What prevents an external application from using BTE today

| #   | Gap                                                                                                             | Evidence                                                                                                                                                                 | Consequence                                                           |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| G1  | No adapter contract: nothing in core or the SDK says what an evidence source is                                 | `grep -rn "interface EvidenceSource" packages apps` → none; the only collector is `apps/demo/src/evidence/collector.ts`, hard-wired to `listPaidOrders` / `listInvoices` | A team must invent its own collector and hand-build records           |
| G2  | No mapping layer from application JSON to the evidence contract                                                 | records are constructed by hand in the demo collector (`#orderPaid`, `#invoiceCreated`)                                                                                  | Every consumer re-implements field mapping and timestamp handling     |
| G3  | No HTTP/REST adapter; `httpEvidenceSource` in `@bte/playwright` only fetches BTE-native NDJSON from `/evidence` | `packages/playwright/src/sources.ts`                                                                                                                                     | Real apps expose their own APIs, not NDJSON                           |
| G4  | No configuration file or loader; everything is CLI flags or hand-written fixture code                           | `grep -rln "bte.config" packages apps` → none; `tests/e2e/fixtures/test.ts` wires rules, evidence URL and clock by hand                                                  | No single place to point BTE at an app; no env-based secrets          |
| G5  | No Playwright fixture factory; consumers must copy `tests/e2e/fixtures/test.ts`                                 | `packages/playwright/src/index.ts` exports `BteVerifier`, `explainVerdict`, `httpEvidenceSource` only                                                                    | Integration is a copy-paste exercise and ties to the demo's endpoints |
| G6  | No way to attach business correlation ids to a Playwright test execution                                        | no annotation/attachment helper in `@bte/playwright`                                                                                                                     | Reports cannot link a UI test to the transaction it verified          |
| G7  | CLI lacks `init`, config-driven `verify`, and `explain`                                                         | `apps/cli/src/cli.ts` commands: `evaluate ingest validate schema`                                                                                                        | Onboarding needs source reading; single-verdict explanation is manual |
| G8  | Rules only in YAML; no typed TypeScript authoring                                                               | `packages/rules` parses YAML only; no `defineRule`                                                                                                                       | Teams that prefer TS get no type safety                               |
| G9  | Packages are unpublished and never installed from tarballs; no consumer proves the exports                      | no `npm pack` consumer in the repo; `examples/` holds fixtures and rules only                                                                                            | Export maps, ESM, declarations and the bin are unverified in situ     |
| G10 | Documentation is repository-centric                                                                             | `docs/` covers architecture, reports, rules, development; nothing on installing into another repo                                                                        | An unfamiliar engineer cannot onboard                                 |
| G11 | Reason messages name `source "<name>"` generically but the reference rule and demo bake in invoicing            | `rules/invoice-created-once.yaml` is the only rule in `rules/`                                                                                                           | Fine as an example; must be clearly positioned as one                 |

Not gaps (checked): core has no Node, Fastify or Playwright imports (lint-enforced); timestamps,
correlation keys, source health and provenance are validated by the contracts and the evaluator;
duplicate events, out-of-order observations, asynchronous delays and unavailable sources all have
defined verdict semantics and fixtures.

## Design decisions taken for the integration work

- The adapter interface is a type in `@bte/core` (`EvidenceSource`), so custom adapters need only
  the core types; adapters themselves live outside core.
- Mapping is a pure function in core (`mapItems`) validated by Zod, so a misconfigured mapping
  fails at config load with a precise message, and a mismatching record fails at collection time
  and degrades the source to `unavailable` (never silently dropped).
- Config is `bte.config.{ts,mts,mjs,js,json}` loaded by native `import()` (Node ≥ 24 strips
  types; verified on 26.3.0) with `${ENV_VAR}` interpolation and an optional `.env` file that is
  git-ignored.
- `@bte/sdk` is the single documented entry point; `@bte/playwright` extends the consumer's own
  `test` via `createBteFixtures`, never replacing their config.
- Installability is proven by an independent consumer under `examples/learning-platform` that
  installs `npm pack` tarballs by `file:` path and never imports workspace sources.
