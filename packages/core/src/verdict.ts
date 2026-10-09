/**
 * Verdict vocabulary.
 *
 *  PASS    - authoritative, complete evidence shows the invariant held.
 *  FAIL    - authoritative evidence shows the invariant was violated
 *            (missing after the deadline with complete data, duplicate,
 *            mismatched value, or late).
 *  PENDING - the obligation is not yet resolvable: the window is still open,
 *            or a healthy authoritative source has not yet caught up.
 *  UNKNOWN - evidence is missing, unavailable, non-authoritative, conflicting
 *            or has no completeness attestation. A verdict cannot be given
 *            honestly. UNKNOWN is never silently upgraded to PASS.
 */
export const VERDICTS = ['PASS', 'FAIL', 'PENDING', 'UNKNOWN'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Precedence when combining expectation verdicts into a rule verdict. */
const PRECEDENCE: Readonly<Record<Verdict, number>> = {
  FAIL: 3,
  UNKNOWN: 2,
  PENDING: 1,
  PASS: 0,
};

export function combineVerdicts(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.length === 0) return 'UNKNOWN';
  let worst: Verdict = 'PASS';
  for (const verdict of verdicts) {
    if (PRECEDENCE[verdict] > PRECEDENCE[worst]) worst = verdict;
  }
  return worst;
}

export const REASON_CODES = [
  'OUTCOME_CONFIRMED',
  'MISSING_EXPECTED_OUTCOME',
  'DUPLICATE_OUTCOME',
  'UNEXPECTED_OUTCOME',
  'ASSERTION_MISMATCH',
  'AGGREGATE_MISMATCH',
  'LATE_OUTCOME',
  'EARLY_OUTCOME',
  'WINDOW_OPEN',
  'SOURCE_STATUS_MISSING',
  'SOURCE_UNAVAILABLE',
  'SOURCE_NOT_AUTHORITATIVE',
  'SOURCE_INCOMPLETE',
  'NO_COMPLETENESS_ATTESTATION',
  'CONFLICTING_REDELIVERY',
  'REDELIVERY_DEDUPLICATED',
  'CORRELATION_VALUE_MISSING',
  'CORRELATION_HOP',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface Reason {
  code: ReasonCode;
  message: string;
  /** Evidence event ids (and source attestation keys) that support this reason. */
  evidenceIds: readonly string[];
}

export interface ObservationSummary {
  eventId: string;
  type: string;
  source: string;
  occurredAt: string;
  collectedAt: string;
  /** Value of `distinctBy` (or the event id). */
  distinctKey: string;
  /** Number of deliveries collapsed into this observation. */
  deliveries: number;
  placement: 'in-window' | 'early' | 'late';
}

export interface SourceAssessment {
  source: string;
  trusted: boolean;
  status: 'available' | 'unavailable' | 'missing';
  authoritative: boolean | null;
  /** Effective watermark: never later than `observedAt` (a source cannot vouch for the future). */
  completeThrough: string | null;
  /** True when the attested watermark exceeded `observedAt` and was clamped. */
  watermarkClamped: boolean;
  /** True when `completeThrough >= deadline`. */
  completeThroughDeadline: boolean;
  observedAt: string | null;
  /** Free-text note from the attestation (e.g. why a source was unavailable). */
  note: string | null;
}

export interface AggregateSummary {
  fn: string;
  field: string | null;
  op: string;
  /** Computed value, or null when it could not be computed (empty set for min/max/avg, non-numeric field). */
  value: number | null;
  expected: unknown;
  status: 'pass' | 'fail' | 'indeterminate' | 'not-evaluated';
  message: string;
}

export interface CorrelationHopSummary {
  type: string;
  source: string;
  /** Hop events in the window whose `from` value was in the incoming key set. */
  matched: number;
  /** Key set produced by this hop (stable keys). */
  keys: readonly string[];
  evidenceIds: readonly string[];
  sourceAssessment: SourceAssessment;
}

export interface CorrelationSummary {
  triggerPath: string;
  observationPath: string;
  /** Final key set the observations were matched against. */
  keys: readonly string[];
  hops: readonly CorrelationHopSummary[];
}

export interface ExpectationVerdict {
  expectationId: string;
  type: string;
  verdict: Verdict;
  deadline: string;
  windowStart: string;
  cardinality: { min: number; max: number | null };
  correlation: CorrelationSummary;
  distinctInWindow: number;
  observations: readonly ObservationSummary[];
  /** One entry per declared aggregate, in rule order. */
  aggregates: readonly AggregateSummary[];
  source: SourceAssessment;
  reasons: readonly Reason[];
}

export interface RuleVerdict {
  ruleId: string;
  ruleVersion: number;
  verdict: Verdict;
  /** Correlation key path and value (e.g. orderId = "ord_123"). */
  correlationKey: string;
  correlationValue: string;
  trigger: {
    eventId: string;
    type: string;
    occurredAt: string;
    collectedAt: string;
    deliveries: number;
  };
  evaluatedAt: string;
  /** Assessment of the trigger's own source when the rule declares `trigger.source`. */
  triggerSource: SourceAssessment | null;
  expectations: readonly ExpectationVerdict[];
  /** Flattened, ordered reasons across expectations. */
  reasons: readonly Reason[];
}
