# Business rules guide

A rule states an obligation: when a trigger event happens, certain outcomes must be observed, in a
time window, in a certain number, with certain values. Rules are versioned files under your
project's rules directory (YAML) or TypeScript via `defineRule` from `@bte/sdk`.

## Anatomy

```yaml
id: course-access-after-enrollment # stable; kebab-case
version: 1 # bump on semantic change
description: A confirmed enrollment grants course access once within 60 seconds.
trigger:
  type: enrollment.confirmed # or a list: [order.paid, order.reinvoiced]
  source: lms-enrollments # the trigger's own source must be trusted, else UNKNOWN
  correlationKey: enrollmentId
expectations:
  - id: access
    type: access.granted
    source: lms-access
    correlationKey: enrollmentId # path on the observation (default: same as trigger)
    distinctBy: accessId # what makes two observations two outcomes
    window: { within: 60s, before: 5s }
    cardinality: exactly-one # exactly-one | at-least-one | none | { min, max? }
    assertions:
      - { field: courseId, op: equals, expected: { trigger: courseId } }
      - { field: courseId, op: matches, expected: { pattern: '^course-' } }
      - { field: tier, op: in, expected: { value: [standard, premium] } }
    aggregates: # over the whole in-window set, once complete
      - { fn: count, op: lte, expected: { value: 1 } }
```

In TypeScript:

```ts
import { defineRule } from '@bte/sdk';
export default defineRule({ id: 'course-access-after-enrollment', version: 1, trigger: {...}, expectations: [...] });
```

## Verdicts, in one table

| Situation                                                         | Verdict | Reason code                                                         |
| ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------- |
| outcome observed, assertions hold, window closed, source complete | PASS    | OUTCOME_CONFIRMED                                                   |
| window still open and obligation not yet resolvable               | PENDING | WINDOW_OPEN                                                         |
| healthy source whose watermark has not reached the deadline       | PENDING | SOURCE_INCOMPLETE                                                   |
| value mismatch on any in-window observation                       | FAIL    | ASSERTION_MISMATCH                                                  |
| more distinct outcomes than allowed                               | FAIL    | DUPLICATE_OUTCOME                                                   |
| required outcome absent after deadline, source complete           | FAIL    | MISSING_EXPECTED_OUTCOME                                            |
| outcome exists but after the deadline                             | FAIL    | LATE_OUTCOME                                                        |
| aggregate violated over the complete set                          | FAIL    | AGGREGATE_MISMATCH                                                  |
| source unavailable / not attested / not authoritative             | UNKNOWN | SOURCE_UNAVAILABLE, SOURCE_STATUS_MISSING, SOURCE_NOT_AUTHORITATIVE |
| source gives no completeness watermark                            | UNKNOWN | NO_COMPLETENESS_ATTESTATION                                         |
| trigger lacks a value a rule needs                                | UNKNOWN | CORRELATION_VALUE_MISSING                                           |
| redeliveries of one event disagree                                | UNKNOWN | CONFLICTING_REDELIVERY                                              |

Full semantics: `docs/adr/0002-verdict-semantics.md`. Operators and operands: `docs/rules.md`.

## Designing good rules

- One obligation per rule; several expectations only when they share the trigger and window.
- Name sources after systems of record. If the only place you can read an outcome is a cache,
  mark the source `authoritative: false` and accept UNKNOWN until a better source exists.
- Windows are business SLAs, not test timeouts. Reach deadlines in tests with a controllable
  clock, not by shortening the rule.
- `exactly-one` cannot PASS before the window closes; if you need fast feedback, add an
  `at-least-one` rule for presence and keep `exactly-one` for the post-window check.
- Prefer assertions against trigger values (`expected: { trigger: amount }`) over literals.
- Validate early: `bte rules validate`; every schema error names the file and path.

## Versioning

Keep `id` stable for the life of the obligation. Bump `version` when the semantics change
(window, cardinality, assertions). Reports name `id@vN`, so dashboards can distinguish verdicts
produced under different definitions.
