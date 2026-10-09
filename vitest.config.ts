import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@bte/core': `${root}packages/core/src/index.ts`,
      '@bte/rules': `${root}packages/rules/src/index.ts`,
      '@bte/evidence': `${root}packages/evidence/src/index.ts`,
      '@bte/playwright': `${root}packages/playwright/src/index.ts`,
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
    environment: 'node',
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'bte-report/unit-junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      // Process entry points are exercised by the shell-level checks (scripts/, CI), not by vitest.
      exclude: [
        'apps/*/src/main.ts',
        'apps/demo/src/scenario.ts',
        'packages/playwright/src/verifier.ts',
        'packages/playwright/src/sources.ts',
      ],
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: 'bte-report/coverage',
      // Quality gate: the deterministic engine must stay fully exercised; everything else high.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
        'packages/core/src/**/*.ts': { lines: 97, functions: 100, branches: 85, statements: 95 },
      },
    },
  },
});
