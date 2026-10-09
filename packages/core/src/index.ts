export { FixedClock, ManualClock, SystemClock, toEpochMillis, toIso } from './clock.js';
export type { Clock } from './clock.js';
export { isDuration, parseDuration } from './duration.js';
export { getPath, jsonEquals, stableKey } from './path.js';
export {
  EvidenceEventSchema,
  EvidenceRecordSchema,
  SourceStatusSchema,
  parseEvidenceRecord,
} from './contracts/evidence.js';
export type { EvidenceEvent, EvidenceRecord, SourceStatus } from './contracts/evidence.js';
export {
  AssertionOperatorSchema,
  AssertionSchema,
  CardinalitySchema,
  ExpectationSchema,
  ExpectedValueSchema,
  LiteralSchema,
  RuleSchema,
  expectationId,
  parseRule,
  resolveCardinality,
} from './contracts/rule.js';
export type {
  Assertion,
  AssertionOperator,
  Cardinality,
  Expectation,
  ExpectedValue,
  Literal,
  ResolvedCardinality,
  Rule,
  RuleInput,
} from './contracts/rule.js';
export { EvidenceSet } from './evidence-set.js';
export type { DedupedEvent } from './evidence-set.js';
export { evaluateRule, evaluateRules, evaluateTrigger } from './evaluate/evaluate.js';
export type { EvaluateOptions } from './evaluate/evaluate.js';
export { evaluateAssertion } from './evaluate/assertions.js';
export type { AssertionOutcome } from './evaluate/assertions.js';
export { REASON_CODES, VERDICTS, combineVerdicts } from './verdict.js';
export type {
  ExpectationVerdict,
  ObservationSummary,
  Reason,
  ReasonCode,
  RuleVerdict,
  SourceAssessment,
  Verdict,
} from './verdict.js';
