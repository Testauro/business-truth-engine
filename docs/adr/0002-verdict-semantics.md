# ADR 0002: Verdict semantics

Status: accepted (2026-10-09)

## Context

A conventional test passes when no assertion fails. For cross-system business outcomes that is
unsafe: an invoice that was never created produces no error, and an unreachable invoicing
database looks identical to an empty one. BTE must distinguish "proven correct", "proven
wrong", "not yet decidable", and "cannot know".

## Decision

Per expectation, evaluated at an injected instant `now`, with `deadline = trigger.occurredAt + within`:

1. **Trust gate.** The expectation's `source` must have a `source` attestation that is
   `available` and `authoritative`. Otherwise: `UNKNOWN` (`SOURCE_STATUS_MISSING`,
   `SOURCE_UNAVAILABLE`, `SOURCE_NOT_AUTHORITATIVE`). This holds even before the deadline;
   `PENDING` is reserved for healthy evidence pipelines.
2. **Confirmed violations** from a trusted source are `FAIL` immediately, regardless of time:
   any in-window observation failing an assertion (`ASSERTION_MISMATCH`), or more distinct
   outcomes than `max` (`DUPLICATE_OUTCOME` / `UNEXPECTED_OUTCOME`).
3. **Conflicting redeliveries** (same `eventId`, different content) or an assertion that cannot
   be evaluated because the trigger lacks the value: `UNKNOWN`.
4. **Fewer than `min` outcomes:** before the deadline `PENDING` (`WINDOW_OPEN`); after it,
   `FAIL` only if `completeThrough >= deadline` (`MISSING_EXPECTED_OUTCOME`, plus
   `LATE_OUTCOME` when the outcome exists after the window). If the source has no watermark:
   `UNKNOWN` (`NO_COMPLETENESS_ATTESTATION`). If the watermark lags: `PENDING`
   (`SOURCE_INCOMPLETE`).
5. **Within bounds:** if `max` is finite, another arrival could still break the invariant, so
   `PASS` requires the window closed and `completeThrough >= deadline`; otherwise the same
   `PENDING` / `UNKNOWN` degradation as (4). If `max` is unbounded, an authoritative
   observation is enough: `PASS` immediately.

5b. **Aggregates** (`sum`, `min`, `max`, `avg`, `count`, `distinctCount` over the distinct
in-window outcomes) are evaluated only once the set is complete: window closed and
`completeThrough >= deadline`, even for unbounded cardinality. Before that the expectation stays
PENDING / UNKNOWN as in (4) and (5); a partial sum is never a verdict. A violated aggregate is
`FAIL` (`AGGREGATE_MISMATCH`); a missing trigger operand is `UNKNOWN`. 6. **Trigger trust.** When a rule declares `trigger.source`, only trigger events from that source
are evaluated, and the source must be attested available and authoritative. Otherwise the rule
verdict is `UNKNOWN` regardless of the expectations (which are still evaluated and reported):
every value taken from the trigger (amounts, currency, even the fact that payment happened) is
suspect, so neither PASS nor FAIL can be honest. Without `trigger.source` the trigger is taken
at face value; the reference rule declares `source: orders`. 7. **A source cannot vouch for the future.** `completeThrough` is clamped to the attestation's
`observedAt`; a watermark beyond it is a collector bug and is reported as
`watermarkClamped: true` in the source assessment. Without this clamp an attestation taken
before the deadline could "prove" absence after it.

Rule verdict = worst expectation verdict with precedence FAIL > UNKNOWN > PENDING > PASS, then
forced to UNKNOWN by an untrusted trigger source.
A rule with no expectations, or an empty verdict set, is `UNKNOWN`, never `PASS`.

Time: `occurredAt` places observations as `early` (< trigger - before), `in-window`
(inclusive of the deadline), or `late` (> deadline). `collectedAt` never affects placement;
it only orders redeliveries. `now == deadline` closes the window.

Identity: deliveries with the same `eventId` are one event (earliest collection is canonical;
ties break on delivery id, then a content key, so the choice is total). Distinct outcomes are
counted by `distinctBy` when set, else by `eventId`.

Attestations: the latest `observedAt` per source wins. On an exact tie the more conservative one
wins (unavailable over available, non-authoritative over authoritative, no watermark over any,
earlier watermark over later, then a content key), so evidence order can never flip a verdict.

## Consequences

- A missing invoice is only `FAIL` once the system of record attests completeness past the
  deadline. Collectors must therefore emit watermarks; the demo collector will.
- "Exactly one" cannot pass early. For fast feedback, rules may use `at-least-one` with
  assertions and a separate `exactly-one` rule checked after the window.
- Every reason cites evidence ids, so a verdict is auditable without re-running.
