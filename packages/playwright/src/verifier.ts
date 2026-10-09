import type { EvidenceRecord, Rule, RuleVerdict, Verdict } from '@bte/core';
import { EvidenceSet, FixedClock, evaluateRule, stableKey } from '@bte/core';
import { toNdjsonLine } from '@bte/evidence';
import type { TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { explainVerdict } from './explain.js';

export interface BteVerifierOptions {
  /** Rules available to this verifier (typically loaded with `@bte/rules`). */
  rules: readonly Rule[];
  /** Fetch the complete evidence collected so far (e.g. GET /evidence as NDJSON, parsed). */
  fetchEvidence: () => Promise<readonly EvidenceRecord[]>;
  /** The instant to evaluate at (epoch ms). Use the system under test's clock when it is controllable. */
  now: () => Promise<number>;
  /** Invoked before every poll, e.g. to trigger a fresh evidence collection. */
  refresh?: (() => Promise<void>) | undefined;
  /** Playwright test info; when given, verdicts and evidence are attached to the report. */
  testInfo?: TestInfo | undefined;
  /** Polling budget for `settle()` and friends. */
  timeout?: number | undefined;
  intervals?: number[] | undefined;
}

export interface Evaluation {
  verdict: RuleVerdict | undefined;
  evaluatedAt: number;
  records: readonly EvidenceRecord[];
}

export interface SettleOptions {
  timeout?: number | undefined;
  intervals?: number[] | undefined;
  /** Verdicts considered settled. Default: everything but PENDING. */
  settledOn?: readonly Verdict[] | undefined;
}

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_INTERVALS = [100, 250, 500, 1_000];

export class VerdictError extends Error {
  readonly verdict: RuleVerdict;
  constructor(message: string, verdict: RuleVerdict) {
    super(message);
    this.name = 'VerdictError';
    this.verdict = verdict;
  }
}

/**
 * Evaluates business invariants from evidence inside a Playwright test. The
 * evaluator is the unmodified `@bte/core` engine; this class only wires it to
 * an evidence source, a clock, Playwright's polling and the test report.
 */
export class BteVerifier {
  readonly #options: BteVerifierOptions;
  #attachmentSeq = 0;

  constructor(options: BteVerifierOptions) {
    this.#options = options;
  }

  rule(ruleId: string): Rule {
    const rule = this.#options.rules.find((candidate) => candidate.id === ruleId);
    if (rule === undefined) {
      throw new Error(
        `unknown rule "${ruleId}"; available: ${this.#options.rules.map((r) => r.id).join(', ') || '(none)'}`,
      );
    }
    return rule;
  }

  /** One evaluation, no polling. `verdict` is undefined when no trigger exists yet for the correlation value. */
  async evaluate(ruleId: string, correlationValue: unknown): Promise<Evaluation> {
    const rule = this.rule(ruleId);
    const [records, evaluatedAt] = await Promise.all([
      this.#options.fetchEvidence(),
      this.#options.now(),
    ]);
    const verdicts = evaluateRule(rule, EvidenceSet.from(records), {
      clock: new FixedClock(evaluatedAt),
    });
    const wanted = stableKey(correlationValue);
    const matching = verdicts.filter((candidate) => candidate.correlationValue === wanted);
    if (matching.length > 1) {
      throw new Error(
        `rule ${ruleId} produced ${matching.length} verdicts for ${rule.trigger.correlationKey}=${wanted} (several trigger events); narrow the correlation`,
      );
    }
    return { verdict: matching[0], evaluatedAt, records };
  }

  /**
   * Poll (refreshing evidence each time) until the verdict is no longer
   * PENDING, then return it. PENDING past the timeout is a failure that says
   * so explicitly; it is never upgraded to PASS.
   */
  async settle(
    ruleId: string,
    correlationValue: unknown,
    options: SettleOptions = {},
  ): Promise<RuleVerdict> {
    const settledOn = new Set<Verdict>(options.settledOn ?? ['PASS', 'FAIL', 'UNKNOWN']);
    const timeout = options.timeout ?? this.#options.timeout ?? DEFAULT_TIMEOUT;
    let last: Evaluation | undefined;
    try {
      await expect
        .poll(
          async () => {
            await this.#options.refresh?.();
            last = await this.evaluate(ruleId, correlationValue);
            return last.verdict?.verdict ?? 'NO_TRIGGER';
          },
          {
            message: `BTE rule ${ruleId} for ${stableKey(correlationValue)} did not settle within ${timeout}ms`,
            timeout,
            intervals: options.intervals ?? this.#options.intervals ?? DEFAULT_INTERVALS,
          },
        )
        .toMatch(new RegExp(`^(${[...settledOn].join('|')})$`));
    } catch (error) {
      // Playwright's poll message is a plain string fixed up front; compose the
      // explanation of the last evaluation now that we have it.
      const lastVerdict = last?.verdict;
      const detail =
        lastVerdict === undefined
          ? `no ${this.rule(ruleId).trigger.type} trigger event found for ${stableKey(correlationValue)}`
          : explainVerdict(lastVerdict);
      if (lastVerdict !== undefined) await this.#attach(lastVerdict, last?.records ?? []);
      const original = error instanceof Error ? error.message : String(error);
      throw new Error(
        `BTE rule ${ruleId} for ${stableKey(correlationValue)} did not settle within ${timeout}ms (waiting for ${[...settledOn].join('|')}).\nLast evaluation: ${detail}\n${original}`,
        { cause: error },
      );
    }
    const verdict = last?.verdict;
    if (verdict === undefined) throw new Error('unreachable: poll settled without a verdict');
    await this.#attach(verdict, last?.records ?? []);
    return verdict;
  }

  /** Settle, then assert the verdict is exactly `expected`. */
  async expectVerdict(
    ruleId: string,
    correlationValue: unknown,
    expected: Verdict,
    options: SettleOptions = {},
  ): Promise<RuleVerdict> {
    const verdict = await this.settle(ruleId, correlationValue, options);
    if (verdict.verdict !== expected) {
      throw new VerdictError(
        `expected BTE verdict ${expected} but got ${verdict.verdict}\n${explainVerdict(verdict)}`,
        verdict,
      );
    }
    return verdict;
  }

  /** The headline assertion: the business invariant must be proven to hold (PASS). */
  async expectInvariant(
    ruleId: string,
    correlationValue: unknown,
    options: SettleOptions = {},
  ): Promise<RuleVerdict> {
    return this.expectVerdict(ruleId, correlationValue, 'PASS', options);
  }

  async #attach(verdict: RuleVerdict, records: readonly EvidenceRecord[]): Promise<void> {
    const testInfo = this.#options.testInfo;
    if (testInfo === undefined) return;
    this.#attachmentSeq += 1;
    const prefix = `bte-${this.#attachmentSeq}-${verdict.ruleId}-${verdict.verdict}`;
    await testInfo.attach(`${prefix}.verdict.json`, {
      body: JSON.stringify(verdict, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach(`${prefix}.explanation.txt`, {
      body: explainVerdict(verdict),
      contentType: 'text/plain',
    });
    await testInfo.attach(`${prefix}.evidence.ndjson`, {
      body: records.map(toNdjsonLine).join(''),
      contentType: 'application/x-ndjson',
    });
  }
}
