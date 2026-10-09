# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog;
versions follow SemVer. Unreleased changes sit at the top.

## [0.1.0] - 2026-10-09

First release candidate: the deterministic engine, CLI, demo and Playwright integration.

### Added

- `@bte/core`: rule and evidence contracts (Zod), order-independent `EvidenceSet` with redelivery
  deduplication and source watermarks, evaluator with PASS / FAIL / PENDING / UNKNOWN, injectable
  clocks (`FixedClock`, `ManualClock`, `SystemClock`), evidence-citing reasons.
- `@bte/rules`: YAML loading with schema errors naming file and path; JSON Schema export.
- `@bte/evidence`: NDJSON reader/writer with line-numbered errors; in-memory store.
- `@bte/cli`: `bte evaluate | validate | schema`; text, JSON (schema 2, with resolved evidence
  index), JUnit and Markdown reports; `--fail-on fail|unknown|pending`; exit codes 0/1/2.
- `@bte/demo`: Fastify shop (orders, payments, invoicing) with seeded faults, read-only evidence
  collector with completeness watermarks, controllable clock, scenario runner.
- `@bte/playwright`: `BteVerifier` for Playwright Test with polling, explanations and attachments.
- `tests/e2e`: page objects, API client, fixtures, business-truth matrix, and the demonstration
  where the checkout UI passes while BTE fails on a missing invoice.
- Quality gates: strict TypeScript, type-aware ESLint with architecture boundaries, coverage
  thresholds, CLI contract and demo scenario checks, CI matrix (Node 24/26) with artifacts.
