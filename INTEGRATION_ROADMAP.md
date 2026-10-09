# Integration roadmap

Small, verifiable milestones toward: two unrelated applications verified through external
configuration, reusable adapters and public packages, without editing BTE core.

| Milestone | Scope                                                                                                                                           | Done when                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| I1        | Core: `EvidenceSource` contract, `collectAll` (a throwing source becomes an `unavailable` attestation), pure `mapItems` mapping with Zod schema | unit tests for mapping success/failure and collection degradation                                       |
| I2        | `@bte/sdk`: `defineRule`, `defineConfig`, `loadBteConfig` (ts/mjs/js/json, `${ENV}`, `.env`), `resolveSources` registry, re-exports             | config load/validation tests with precise error messages; env interpolation tests                       |
| I3        | `@bte/evidence-http`: REST adapter (GET/POST, bearer/basic/header auth from env, mapping, snapshot completeness, health)                        | tests against an in-process HTTP stub: success, auth, 500 → unavailable, mapping problems → unavailable |
| I4        | `@bte/playwright`: `createBteFixtures(config)` + `bte.correlate(ids)`; consumer's Playwright config untouched                                   | e2e suite of the demo migrated to the factory; annotations visible in the report                        |
| I5        | CLI: `bte init`, `bte verify` (config-driven collect + evaluate + reports), `bte explain`, `bte rules validate` alias                           | tests for each command; exit codes unchanged                                                            |
| I6        | Packaging: `pnpm pack` all public packages to `dist-packages/`; `scripts/pack.sh`                                                               | tarballs contain dist + types; a scratch consumer installs them and runs the CLI                        |
| I7        | Independent consumer `examples/learning-platform`: stub app, `bte.config.ts`, rule, Playwright tests                                            | PASS / FAIL / PENDING / UNKNOWN demonstrated; BTE installed only from tarballs; no core edits           |
| I8        | Docs: INSTALLATION, QUICKSTART, APPLICATION_INTEGRATION, CUSTOM_ADAPTER_GUIDE, PLAYWRIGHT_INTEGRATION, BUSINESS_RULES_GUIDE                     | an engineer can follow them end to end; the demo (order/invoice) still passes                           |

Constraints throughout: TypeScript strict, no weakened tests, no publish or push without approval.
