// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/bte-report/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        project: [
          './tsconfig.test.json',
          './packages/*/tsconfig.json',
          './apps/*/tsconfig.json',
          './tests/e2e/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  // ---- Architecture boundaries (docs/architecture.md). Violations fail `pnpm lint`. ----
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'os', 'child_process', 'http', 'https', 'url'],
              message: 'packages/core must not touch the platform; it is pure.',
            },
            {
              group: ['@bte/*'],
              message: 'packages/core depends on nothing else in the workspace.',
            },
            {
              group: [
                'fastify',
                'fastify/*',
                '@fastify/*',
                '@playwright/*',
                'playwright*',
                'commander',
                'yaml',
                'pg',
                'pg/*',
              ],
              message: 'packages/core must not know about frameworks, storage or I/O libraries.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/rules/src/**/*.ts', 'packages/evidence/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bte/cli', '@bte/demo', '@bte/playwright', '@bte/rules', '@bte/evidence'],
              message: 'rules/evidence depend on core only.',
            },
            {
              group: ['fastify', 'fastify/*', '@fastify/*', '@playwright/*', 'playwright*'],
              message: 'no framework code in library packages.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/evidence-postgres/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bte/cli', '@bte/demo', '@bte/playwright', '@bte/rules', '@bte/evidence'],
              message: 'the store depends on core only.',
            },
            {
              group: ['fastify', 'fastify/*', '@fastify/*', '@playwright/*', 'playwright*'],
              message: 'no framework code in library packages.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/playwright/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bte/demo', '@bte/cli', 'fastify', 'fastify/*', '@fastify/*'],
              message: 'the Playwright package is SUT-agnostic.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/demo/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bte/cli', '@bte/playwright', '@bte/rules'],
              message: 'the demo emits evidence; it never evaluates rules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/demo/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bte/evidence', '../evidence/*', '../../evidence/*'],
              message: 'domain modules know nothing about evidence collection.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/e2e/**/*.ts'],
    rules: {
      // Playwright fixtures use `({}, use)` destructuring and `rejects` assertions by design.
      '@typescript-eslint/no-empty-pattern': 'off',
      'no-empty-pattern': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
