import { defineConfig } from '@bte/sdk';

/**
 * BTE configuration for OrangeHRM. The UI observations are produced by the Playwright tests
 * (source `orangehrm-ui`); the independent evidence comes from OrangeHRM's APIs through the
 * adapter in bte/adapters/orangehrm.ts. Credentials are resolved from the environment at
 * collection time, so a missing token or session makes verdicts UNKNOWN instead of failing config.
 */
export default defineConfig({
  rules: ['bte/rules'],
  sources: [
    {
      type: 'custom',
      name: 'orangehrm-api',
      module: './bte/adapters/orangehrm.ts',
      options: {
        baseUrl: '${ORANGEHRM_BASE_URL:-https://opensource-demo.orangehrmlive.com}',
        kind: 'employees',
      },
    },
    {
      type: 'custom',
      name: 'orangehrm-leave-api',
      module: './bte/adapters/orangehrm.ts',
      options: {
        baseUrl:
          '${ORANGEHRM_PRIVATE_BASE_URL:-${ORANGEHRM_BASE_URL:-https://opensource-demo.orangehrmlive.com}}',
        kind: 'leave',
      },
    },
  ],
  gate: { failOn: 'fail' },
  report: { dir: 'bte-report' },
});
