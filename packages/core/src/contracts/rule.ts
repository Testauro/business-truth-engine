import { z } from 'zod';
import { isDuration } from '../duration.js';

/**
 * Rule contracts: "Business Invariants as Code".
 *
 * A rule is triggered by an event type. For each trigger event, every
 * expectation is checked: within a time window after the trigger, a given
 * number of distinct observations of another event type must exist for the
 * same correlation key, and each observation must satisfy the assertions.
 */

const nonEmpty = z.string().trim().min(1);
const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/, 'must be lower-case kebab/dot case');
const durationString = z.string().refine(isDuration, 'must be a duration like 120s, 2m, 500ms');
const payloadPath = nonEmpty.regex(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/, 'must be a dotted path');

export const CardinalitySchema = z.union([
  z.literal('exactly-one'),
  z.literal('at-least-one'),
  z.literal('none'),
  z
    .object({
      min: z.number().int().min(0),
      max: z.number().int().min(0).optional(),
    })
    .strict()
    .refine((c) => c.max === undefined || c.max >= c.min, 'max must be >= min')
    .refine(
      (c) => !(c.min === 0 && c.max === undefined),
      'min 0 with no max can never fail; a rule must be falsifiable',
    ),
]);

export type Cardinality = z.infer<typeof CardinalitySchema>;

export const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Scalar = z.infer<typeof ScalarSchema>;
/** A literal operand: a scalar, or an array of scalars (for `in` / `notIn`, or structural `equals`). */
export const LiteralSchema = z.union([ScalarSchema, z.array(ScalarSchema)]);
export type Literal = z.infer<typeof LiteralSchema>;

/** Operators usable in per-observation assertions. */
export const AssertionOperatorSchema = z.enum([
  'equals',
  'notEquals',
  'gt',
  'gte',
  'lt',
  'lte',
  'matches',
  'notMatches',
  'in',
  'notIn',
]);
export type AssertionOperator = z.infer<typeof AssertionOperatorSchema>;
/** Operators usable in aggregates (numeric results only). */
export const AggregateOperatorSchema = z.enum(['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte']);
export type AggregateOperator = z.infer<typeof AggregateOperatorSchema>;
const REGEX_OPS = new Set<AssertionOperator>(['matches', 'notMatches']);
const SET_OPS = new Set<AssertionOperator>(['in', 'notIn']);

const REGEX_FLAGS = /^[gimsuy]*$/;
export const PatternOperandSchema = z
  .object({
    pattern: z.string().min(1),
    flags: z.string().regex(REGEX_FLAGS, 'flags must be a subset of gimsuy').optional(),
  })
  .strict()
  .superRefine((operand, ctx) => {
    try {
      new RegExp(operand.pattern, operand.flags);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['pattern'],
        message: `invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

export const ExpectedValueSchema = z.union([
  z.object({ trigger: payloadPath }).strict(),
  z.object({ value: LiteralSchema }).strict(),
  PatternOperandSchema,
]);
export type ExpectedValue = z.infer<typeof ExpectedValueSchema>;

export const AssertionSchema = z
  .object({
    /** Path into the observation payload. */
    field: payloadPath,
    op: AssertionOperatorSchema,
    expected: ExpectedValueSchema,
    description: z.string().optional(),
  })
  .strict()
  .superRefine((assertion, ctx) => {
    const isPattern = 'pattern' in assertion.expected;
    if (REGEX_OPS.has(assertion.op) && !isPattern) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected'],
        message: `${assertion.op} needs a { pattern } operand`,
      });
    }
    if (!REGEX_OPS.has(assertion.op) && isPattern) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected'],
        message: `{ pattern } is only valid with matches / notMatches`,
      });
    }
    if (
      SET_OPS.has(assertion.op) &&
      'value' in assertion.expected &&
      !Array.isArray(assertion.expected.value)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', 'value'],
        message: `${assertion.op} needs an array of values (or a trigger path to one)`,
      });
    }
  });
export type Assertion = z.infer<typeof AssertionSchema>;

export const AggregateFnSchema = z.enum(['sum', 'min', 'max', 'avg', 'count', 'distinctCount']);
export type AggregateFn = z.infer<typeof AggregateFnSchema>;

/**
 * An assertion over all in-window observations of an expectation (one per
 * distinct outcome), e.g. "sum(amount) <= trigger.amount". Evaluated only
 * once the observation set is complete (window closed, source complete).
 */
export const AggregateSchema = z
  .object({
    fn: AggregateFnSchema,
    /** Path into the observation payload; not used by `count`. */
    field: payloadPath.optional(),
    op: AggregateOperatorSchema,
    expected: z.union([
      z.object({ trigger: payloadPath }).strict(),
      z.object({ value: ScalarSchema }).strict(),
    ]),
    description: z.string().optional(),
  })
  .strict()
  .refine((a) => a.fn === 'count' || a.field !== undefined, {
    message: 'field is required for every aggregate except count',
    path: ['field'],
  });
export type Aggregate = z.infer<typeof AggregateSchema>;

export const ExpectationSchema = z
  .object({
    /** Stable id for the expectation inside the rule; defaults to `type`. */
    id: identifier.optional(),
    /** Event type that must be observed. */
    type: nonEmpty,
    /** Source that is authoritative for this observation. Events from other sources are ignored. */
    source: nonEmpty,
    /** Path in the observation payload holding the correlation value. Defaults to the trigger's. */
    correlationKey: payloadPath.optional(),
    /**
     * Path identifying a distinct business outcome (e.g. `invoiceId`).
     * Two observations with different values are two outcomes. Defaults to the
     * event id, so distinct event ids are distinct outcomes.
     */
    distinctBy: payloadPath.optional(),
    window: z
      .object({
        /** Deadline relative to the trigger's `occurredAt`. */
        within: durationString,
        /** Tolerance for observations whose `occurredAt` precedes the trigger (clock skew). */
        before: durationString.optional(),
      })
      .strict(),
    cardinality: CardinalitySchema,
    assertions: z.array(AssertionSchema).default([]),
    /** Assertions over the whole in-window observation set; see docs/rules.md. */
    aggregates: z.array(AggregateSchema).default([]),
  })
  .strict();
export type Expectation = z.infer<typeof ExpectationSchema>;

export const RuleSchema = z
  .object({
    id: identifier,
    version: z.number().int().min(1),
    description: z.string().optional(),
    trigger: z
      .object({
        type: nonEmpty,
        /**
         * Source that is authoritative for the trigger. When set, only trigger events from this
         * source are evaluated and the source must be attested available and authoritative;
         * otherwise the verdict is UNKNOWN, because every value taken from the trigger is suspect.
         */
        source: nonEmpty.optional(),
        /** Path in the trigger payload holding the business correlation value. */
        correlationKey: payloadPath,
      })
      .strict(),
    expectations: z.array(ExpectationSchema).min(1),
  })
  .strict()
  .superRefine((rule, ctx) => {
    const seen = new Set<string>();
    rule.expectations.forEach((expectation, index) => {
      const id = expectation.id ?? expectation.type;
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['expectations', index, 'id'],
          message: `duplicate expectation id "${id}"`,
        });
      }
      seen.add(id);
    });
  });

export type Rule = z.infer<typeof RuleSchema>;
export type RuleInput = z.input<typeof RuleSchema>;

export function parseRule(input: unknown): Rule {
  return RuleSchema.parse(input);
}

export interface ResolvedCardinality {
  min: number;
  /** `Number.POSITIVE_INFINITY` when unbounded. */
  max: number;
}

export function resolveCardinality(cardinality: Cardinality): ResolvedCardinality {
  switch (cardinality) {
    case 'exactly-one':
      return { min: 1, max: 1 };
    case 'at-least-one':
      return { min: 1, max: Number.POSITIVE_INFINITY };
    case 'none':
      return { min: 0, max: 0 };
    default:
      return { min: cardinality.min, max: cardinality.max ?? Number.POSITIVE_INFINITY };
  }
}

export function expectationId(expectation: Expectation): string {
  return expectation.id ?? expectation.type;
}
