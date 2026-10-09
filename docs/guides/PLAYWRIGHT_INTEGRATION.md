# Playwright integration

`@bte/playwright` adds a `bte` fixture to your own `test`. Your `playwright.config.ts`, projects,
reporters and existing fixtures stay exactly as they are.

## Setup

```ts
// tests/fixtures.ts
import { test as base } from '@playwright/test';
import { createBteFixtures } from '@bte/playwright';

export const test = base.extend(
  createBteFixtures({ config: { cwd: new URL('..', import.meta.url).pathname } }),
);
export { expect } from '@playwright/test';
```

`createBteFixtures` returns two fixture definitions: a worker-scoped `bteState` (rules and sources
resolved once from `bte.config.*`) and a test-scoped `bte`. Merge them into an existing `extend`
call alongside your fixtures; they do not conflict.

Programmatic alternative, without a config file:

```ts
createBteFixtures({ rules: [myRule], sources: [myAdapter] });
```

## In a test

```ts
test('enrollment grants course access', async ({ page, bte }) => {
  // the ordinary UI flow and assertions
  const enrollmentId = await enrollViaUi(page, 'course-ts-101');

  bte.correlate({ enrollmentId, learnerId: 'learner-42' }); // annotations in the report; narrows source queries
  await bte.expectInvariant('course-access-after-enrollment', enrollmentId);
});
```

- `bte.expectInvariant(ruleId, correlationValue)` polls (collecting from every source each time)
  until the verdict is no longer PENDING, then asserts PASS. On FAIL or UNKNOWN it throws a
  `VerdictError` whose message is the full explanation with evidence ids; the verdict JSON, the
  explanation and the evidence NDJSON are attached to the test.
- `bte.expectVerdict(ruleId, value, 'FAIL' | 'UNKNOWN' | 'PASS')` asserts a specific outcome
  (useful for seeded-fault tests).
- `bte.evaluate(ruleId, value)` evaluates once without polling (e.g. to assert PENDING).
- `bte.collect()` collects on demand; `bte.records` is everything collected in the test;
  `bte.addRecords([...])` merges records the test itself produced.

Polling uses Playwright's `expect.poll` (no sleeps). A verdict that never leaves PENDING fails
the test after `timeout` (default 15s) with the last verdict quoted. PENDING is never upgraded to
PASS.

## Time and deadlines

Business windows are real (120s, 60s, 30d). Tests must not wait for them. Options:

1. Your application exposes a controllable clock in test environments (the demo and the
   learning-platform example do: `POST /admin/clock/advance`). Pass it as the evaluation instant:

   ```ts
   bte: async ({ bteState }, use, testInfo) => {
     const { createBte } = await import('@bte/playwright');
     await use(createBte(bteState, { now: () => readAppClock() }, testInfo));
   },
   ```

2. Evaluate at a fixed instant from the config (`now:` in `bte.config.ts`) against replayed
   evidence.
3. For flows whose window is short enough, simply let `expectInvariant` poll.

## Reports

Each settled verdict attaches `bte-<n>-<rule>-<verdict>.verdict.json`, `.explanation.txt` and
`.evidence.ndjson`; collected evidence is attached as `bte-evidence.ndjson` at test end;
unavailable sources appear as `bte-source-unavailable` annotations. Use your usual Playwright
reporters; traces work unchanged.

## Verdict error example

```
VerdictError: expected BTE verdict PASS but got FAIL
BTE FAIL: rule course-access-after-enrollment@v1 for enrollmentId="enr_0001"
  trigger enrollment.confirmed enrollment:enr_0001 at 2026-05-01T09:00:00.000Z; evaluated at 2026-05-01T09:01:01.000Z
  expectation "access" (access.granted): FAIL; 0 distinct in window; deadline 2026-05-01T09:01:00.000Z; source lms-access (available, authoritative, complete through 2026-05-01T09:01:01.000Z)
  - MISSING_EXPECTED_OUTCOME: 0 of 1 required access.granted observed by 2026-05-01T09:01:00.000Z; ... [evidence: source:lms-access@..., enrollment:enr_0001]
```
