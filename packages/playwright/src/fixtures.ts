import type { TestInfo } from '@playwright/test';
import type { EvidenceRecord, EvidenceSource, Rule } from '@bte/core';
import { collectAll } from '@bte/core';
import { loadBteConfig, loadConfiguredRules, resolveSources } from '@bte/sdk';
import type { LoadConfigOptions, LoadedConfig } from '@bte/sdk';
import { BteVerifier } from './verifier.js';
import type { BteVerifierOptions, SettleOptions } from './verifier.js';

/**
 * Options for `createBteFixtures`. Either point at a `bte.config.*` (the
 * normal case: rules and sources come from configuration) or pass rules and
 * sources programmatically. The consumer's own Playwright configuration is
 * never touched: this only produces fixture definitions for `test.extend`.
 */
export interface BteFixtureOptions {
  /** Where to look for bte.config.* (default: the Playwright config's cwd). */
  config?: LoadConfigOptions | undefined;
  /** Programmatic alternative to a config file. */
  rules?: readonly Rule[] | undefined;
  sources?: readonly EvidenceSource[] | undefined;
  /** Evaluation instant; default: wall clock, or `config.now` when set. */
  now?: (() => Promise<number> | number) | undefined;
  /** Polling budget for `expectInvariant` / `settle`. */
  timeout?: number | undefined;
  intervals?: number[] | undefined;
}

/** What the `bte` fixture exposes to a test. */
export interface Bte {
  /** Record the business identifiers this test is about; they appear as annotations and attachments in the report and narrow source queries. */
  correlate(ids: Readonly<Record<string, unknown>>): void;
  /** Identifiers recorded so far. */
  readonly correlation: Readonly<Record<string, unknown>>;
  /** Collect from every source now (respecting the correlation) and return the records; also appended to the test's evidence. */
  collect(): Promise<EvidenceRecord[]>;
  /** The verifier bound to this test: evaluate / settle / expectVerdict / expectInvariant. */
  readonly verifier: BteVerifier;
  expectInvariant: BteVerifier['expectInvariant'];
  expectVerdict: BteVerifier['expectVerdict'];
  settle: BteVerifier['settle'];
  evaluate: BteVerifier['evaluate'];
  /** Records collected during this test, in order. */
  readonly records: readonly EvidenceRecord[];
  /** Add records produced by the test itself (e.g. what the UI reported) with a note on their source. */
  addRecords(records: readonly EvidenceRecord[]): void;
}

export interface BteWorkerState {
  rules: readonly Rule[];
  sources: readonly EvidenceSource[];
  loaded: LoadedConfig | null;
}

/** Resolve rules and sources once per worker. */
export async function loadBteWorkerState(options: BteFixtureOptions): Promise<BteWorkerState> {
  if (options.rules !== undefined || options.sources !== undefined) {
    if (options.rules === undefined || options.sources === undefined) {
      throw new Error(
        'createBteFixtures: pass both `rules` and `sources`, or neither (then bte.config.* is used)',
      );
    }
    return { rules: options.rules, sources: options.sources, loaded: null };
  }
  const loaded = await loadBteConfig(options.config ?? {});
  const [rules, sources] = await Promise.all([loadConfiguredRules(loaded), resolveSources(loaded)]);
  return { rules, sources, loaded };
}

/** Build the per-test `bte` object. Exposed so teams with unusual fixture setups can wire it themselves. */
export function createBte(
  state: BteWorkerState,
  options: BteFixtureOptions,
  testInfo: TestInfo,
): Bte {
  const correlation: Record<string, unknown> = {};
  const records: EvidenceRecord[] = [];
  const now = async (): Promise<number> => {
    if (options.now !== undefined) return options.now();
    if (state.loaded?.config.now !== undefined) return Date.parse(state.loaded.config.now);
    return Date.now();
  };
  const collect = async (): Promise<EvidenceRecord[]> => {
    const result = await collectAll(state.sources, { now: await now(), correlation });
    records.push(...result.records);
    for (const failure of result.failures) {
      testInfo.annotations.push({
        type: 'bte-source-unavailable',
        description: `${failure.source}: ${failure.error}`,
      });
    }
    return result.records;
  };
  const verifierOptions: BteVerifierOptions = {
    rules: state.rules,
    fetchEvidence: () => Promise.resolve(records),
    now,
    refresh: async () => {
      await collect();
    },
    testInfo,
    timeout: options.timeout,
    intervals: options.intervals,
  };
  const verifier = new BteVerifier(verifierOptions);
  const bte: Bte = {
    correlate(ids) {
      for (const [key, value] of Object.entries(ids)) {
        correlation[key] = value;
        testInfo.annotations.push({
          type: `bte-correlation:${key}`,
          description: typeof value === 'string' ? value : JSON.stringify(value),
        });
      }
    },
    get correlation() {
      return correlation;
    },
    collect,
    verifier,
    expectInvariant: (ruleId: string, value: unknown, settle?: SettleOptions) =>
      verifier.expectInvariant(ruleId, value, settle),
    expectVerdict: (ruleId, value, expected, settle) =>
      verifier.expectVerdict(ruleId, value, expected, settle),
    settle: (ruleId, value, settle) => verifier.settle(ruleId, value, settle),
    evaluate: (ruleId, value) => verifier.evaluate(ruleId, value),
    get records() {
      return records;
    },
    addRecords(extra) {
      records.push(...extra);
    },
  };
  return bte;
}

/**
 * Fixture definitions for `test.extend`. Usage:
 *
 *   import { test as base } from '@playwright/test';
 *   import { createBteFixtures } from '@bte/playwright';
 *   export const test = base.extend(createBteFixtures({ config: { cwd: __dirname } }));
 *
 * Provides a worker-scoped `bteState` (rules + sources resolved once) and a
 * test-scoped `bte`. Existing fixtures and options of the consumer's `test`
 * are untouched.
 */
export function createBteFixtures(options: BteFixtureOptions = {}): {
  bteState: [
    (args: object, use: (state: BteWorkerState) => Promise<void>) => Promise<void>,
    { scope: 'worker' },
  ];
  bte: (
    args: { bteState: BteWorkerState },
    use: (bte: Bte) => Promise<void>,
    testInfo: TestInfo,
  ) => Promise<void>;
} {
  return {
    bteState: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(await loadBteWorkerState(options));
      },
      { scope: 'worker' },
    ],
    bte: async ({ bteState }, use, testInfo) => {
      const bte = createBte(bteState, options, testInfo);
      await use(bte);
      if (bte.records.length > 0) {
        const { toNdjsonLine } = await import('@bte/evidence');
        await testInfo.attach('bte-evidence.ndjson', {
          body: bte.records.map(toNdjsonLine).join(''),
          contentType: 'application/x-ndjson',
        });
      }
    },
  };
}
