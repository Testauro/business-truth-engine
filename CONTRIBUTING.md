# Contributing to Business Truth Engine

Thanks for helping make business outcomes verifiable. This project is Apache-2.0; by contributing
you agree your work is licensed the same way.

## Ground rules

1. **Verdicts stay honest.** No change may turn a PENDING or UNKNOWN into a PASS without
   authoritative, complete evidence. Changes to verdict semantics need an update to
   `docs/adr/0002-verdict-semantics.md` and tests for every affected boundary.
2. **The core stays pure.** `packages/core` depends on `zod` only. The lint boundaries in
   `eslint.config.js` are the contract; do not relax them.
3. **Tests are evidence.** Run them, read the output, and say what you saw. Never skip, weaken or
   `.only` a test to go green (`forbidOnly` is on in CI).
4. **Determinism.** Inject clocks, sort outputs, avoid randomness. Same inputs, same bytes.

## Workflow

```bash
npx --yes pnpm@10 install
npx --yes pnpm@10 build
npx --yes pnpm@10 verify:quick      # while iterating
npx --yes pnpm@10 verify            # before opening a PR
```

- Branch from `main`; keep PRs focused. Fill in the PR template, including what you ran.
- Add unit tests in `<package>/test`, fixture cases in `examples/fixtures/` + `cases.json`, and
  Playwright specs in `tests/e2e/specs` when behaviour spans the UI.
- Public behaviour (CLI flags, report shapes, exit codes) is documented in `docs/reports.md`;
  update it in the same PR. Add a line to `CHANGELOG.md`.
- Commit messages: imperative subject, body explaining why. Reference issues.

## Adding a rule

See `docs/rules.md`. Every new rule ships with at least one PASS fixture, one FAIL fixture and one
UNKNOWN fixture, catalogued in `examples/fixtures/cases.json`.

## Adding an evidence adapter

Implement a producer of `EvidenceRecord`s (ADR 0003). Emit a `source` attestation with a truthful
`completeThrough` watermark, or `status: unavailable`; never emit an attestation you cannot back.
The demo's `apps/demo/src/evidence/collector.ts` is the reference implementation.

## Reporting problems

Use the issue templates. For security issues follow `SECURITY.md`; do not open a public issue.
