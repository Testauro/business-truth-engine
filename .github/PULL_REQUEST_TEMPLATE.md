## Summary

<!-- What changes and why. Link the issue. -->

## Verification

- [ ] `pnpm verify:quick` passes locally (lint, typecheck, unit tests)
- [ ] `pnpm verify` passes locally (adds coverage thresholds, CLI contract, demo scenarios, Playwright)
- [ ] New behaviour has tests; failure scenarios included where relevant
- [ ] No test was weakened or skipped to go green

## Semantics

- [ ] No change to verdict semantics, **or** ADR 0002 and `docs/reports.md` are updated
- [ ] Architecture boundaries respected (`packages/core` stays pure; see `docs/architecture.md`)
- [ ] `PROGRESS.md` / `CHANGELOG.md` updated if user-visible
