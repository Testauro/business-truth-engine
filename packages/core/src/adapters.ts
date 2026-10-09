import { toIso } from './clock.js';
import type { EvidenceRecord, SourceStatus } from './contracts/evidence.js';

/**
 * Public adapter contract. An evidence source knows how to obtain records for
 * one logical source name (the `source` rules refer to). It must return the
 * events it can see plus an honest attestation of its own completeness, or
 * throw; a throwing source is recorded as unavailable by `collectAll`, so
 * absence of telemetry is never mistaken for success.
 */
export interface CollectContext {
  /** Evaluation instant (epoch ms). Adapters use it as `collectedAt` and as the watermark upper bound. */
  now: number;
  /** Business correlation the caller cares about, if any (adapters may use it to narrow queries). */
  correlation?: Readonly<Record<string, unknown>> | undefined;
}

export interface EvidenceSource {
  /** Logical source name as used in rules (`source:` on triggers, expectations and hops). */
  readonly name: string;
  /** Whether this source is the system of record for the events it reports. Defaults to true. */
  readonly authoritative?: boolean | undefined;
  collect(context: CollectContext): Promise<readonly EvidenceRecord[]>;
}

export interface CollectAllResult {
  records: EvidenceRecord[];
  /** Sources that threw, with the error message that became their attestation note. */
  failures: { source: string; error: string }[];
}

/** Build an attestation record for a source at an instant. */
export function attestation(
  source: string,
  now: number,
  options: {
    status?: SourceStatus['status'];
    authoritative?: boolean;
    /** Epoch ms; omit when the source cannot promise completeness. */
    completeThrough?: number | undefined;
    note?: string | undefined;
  } = {},
): SourceStatus {
  const record: SourceStatus = {
    kind: 'source',
    source,
    observedAt: toIso(now),
    status: options.status ?? 'available',
    authoritative: options.authoritative ?? true,
  };
  if (options.completeThrough !== undefined)
    record.completeThrough = toIso(options.completeThrough);
  if (options.note !== undefined) record.note = options.note;
  return record;
}

/**
 * Collect from every source. Sources run in parallel; a source that throws
 * contributes a single `unavailable` attestation carrying the error, so the
 * evaluator degrades to UNKNOWN for anything that depends on it.
 */
export async function collectAll(
  sources: readonly EvidenceSource[],
  context: CollectContext,
): Promise<CollectAllResult> {
  const settled = await Promise.allSettled(sources.map((source) => source.collect(context)));
  const result: CollectAllResult = { records: [], failures: [] };
  settled.forEach((outcome, index) => {
    const source = sources[index];
    if (source === undefined) return;
    if (outcome.status === 'fulfilled') {
      result.records.push(...outcome.value);
      return;
    }
    const error = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    result.failures.push({ source: source.name, error });
    result.records.push(
      attestation(source.name, context.now, {
        status: 'unavailable',
        authoritative: source.authoritative ?? true,
        note: `collect failed: ${error}`,
      }),
    );
  });
  return result;
}
