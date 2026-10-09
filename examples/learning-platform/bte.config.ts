import { defineConfig } from '@bte/sdk';

/**
 * BTE configuration for Learn.io. Two logical sources, both read from the platform's own JSON
 * APIs through the generic HTTP adapter with field mapping. Secrets come from the environment.
 */
export default defineConfig({
  rules: ['bte/rules'],
  sources: [
    {
      type: 'http',
      name: 'lms-enrollments',
      baseUrl: '${LMS_BASE_URL}',
      auth: { type: 'bearer', token: '${LMS_API_TOKEN}' },
      requests: [
        {
          url: 'api/enrollments',
          mapping: {
            type: 'enrollment.confirmed',
            items: 'enrollments',
            eventId: { template: 'enrollment:${enrollmentId}' },
            occurredAt: 'confirmedAt',
            payload: { enrollmentId: 'enrollmentId', learnerId: 'learnerId', courseId: 'courseId' },
          },
        },
      ],
    },
    {
      type: 'http',
      name: 'lms-access',
      baseUrl: '${LMS_BASE_URL}',
      auth: { type: 'bearer', token: '${LMS_API_TOKEN}' },
      requests: [
        {
          url: 'api/access',
          mapping: {
            type: 'access.granted',
            items: 'grants',
            eventId: { template: 'access:${accessId}' },
            occurredAt: 'grantedAt',
            payload: {
              accessId: 'accessId',
              enrollmentId: 'enrollmentId',
              learnerId: 'learnerId',
              courseId: 'courseId',
            },
          },
        },
      ],
    },
  ],
  gate: { failOn: 'fail' },
  report: { dir: 'bte-report' },
});
