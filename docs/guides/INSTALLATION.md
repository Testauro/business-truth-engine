# Installation

BTE is a set of ESM TypeScript packages for Node.js 24 or newer. You install it into an existing
repository; it never replaces your test runner or configuration.

## Packages

| Package                  | Install when                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `@bte/sdk`               | always: rules, configuration, evidence contracts, programmatic verify               |
| `@bte/playwright`        | you verify inside Playwright tests (peer: `@playwright/test` ≥ 1.40)                |
| `@bte/cli`               | you want `bte init / rules validate / verify / explain / evaluate` locally or in CI |
| `@bte/evidence-postgres` | you keep evidence in PostgreSQL (optional; `pg` is pulled in)                       |

`@bte/core`, `@bte/rules`, `@bte/evidence` and `@bte/evidence-http` are dependencies of the above;
you do not import them directly.

## From a registry (when published)

```bash
npm install --save-dev @bte/sdk @bte/playwright @bte/cli
```

## From local tarballs (today)

BTE is not yet published. Build tarballs from a checkout and install them by path:

```bash
# in the BTE checkout
npx --yes pnpm@10 install && npx --yes pnpm@10 pack:packages     # -> dist-packages/*.tgz

# in your project
npm install --save-dev \
  ../business-truth-engine/dist-packages/bte-sdk-0.1.0.tgz \
  ../business-truth-engine/dist-packages/bte-playwright-0.1.0.tgz \
  ../business-truth-engine/dist-packages/bte-cli-0.1.0.tgz \
  ../business-truth-engine/dist-packages/bte-core-0.1.0.tgz \
  ../business-truth-engine/dist-packages/bte-rules-0.1.0.tgz \
  ../business-truth-engine/dist-packages/bte-evidence-0.1.0.tgz \
  ../business-truth-engine/dist-packages/bte-evidence-http-0.1.0.tgz
```

Every `@bte/*` package the tarballs depend on must be installed from a tarball too (npm resolves
them by name against what you declared). `examples/learning-platform/package.json` is a complete
working example.

## Verify the install

```bash
npx bte --help            # the CLI binary
node -e "import('@bte/sdk').then(m => console.log(Object.keys(m).length, 'exports'))"
```

## Requirements and notes

- Node ≥ 24: the config file `bte.config.ts` is imported natively (type stripping); no ts-node.
- Your `package.json` can be CommonJS or ESM; BTE packages are ESM and are imported with `import`.
- Nothing is written outside your project except `bte-report/` (configurable) in it.
