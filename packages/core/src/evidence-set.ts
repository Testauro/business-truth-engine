import type { EvidenceEvent, EvidenceRecord, SourceStatus } from './contracts/evidence.js';
import { toEpochMillis } from './clock.js';
import { jsonEquals, stableKey } from './path.js';

/**
 * A deduplicated event: one business event identity plus every delivery of it.
 * The canonical view is the earliest-collected delivery; conflicting payloads
 * across deliveries are flagged rather than silently merged.
 */
export interface DedupedEvent {
  readonly canonical: EvidenceEvent;
  readonly deliveries: readonly EvidenceEvent[];
  readonly conflicting: boolean;
}

function compareEvents(a: EvidenceEvent, b: EvidenceEvent): number {
  const byOccurred = toEpochMillis(a.occurredAt) - toEpochMillis(b.occurredAt);
  if (byOccurred !== 0) return byOccurred;
  const byCollected = toEpochMillis(a.collectedAt) - toEpochMillis(b.collectedAt);
  if (byCollected !== 0) return byCollected;
  if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1;
  const da = a.deliveryId ?? '';
  const db = b.deliveryId ?? '';
  return da < db ? -1 : da > db ? 1 : 0;
}

/**
 * Total order over deliveries of one event: collection time, delivery id, then
 * a content key. The content tiebreak matters: two deliveries with the same
 * eventId, the same collectedAt and no deliveryId but different payloads must
 * still pick the same canonical delivery whatever order they arrived in.
 */
function deliveryOrder(a: EvidenceEvent, b: EvidenceEvent): number {
  const byCollected = toEpochMillis(a.collectedAt) - toEpochMillis(b.collectedAt);
  if (byCollected !== 0) return byCollected;
  const da = a.deliveryId ?? '';
  const db = b.deliveryId ?? '';
  if (da !== db) return da < db ? -1 : 1;
  const ka = contentKey(a);
  const kb = contentKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function contentKey(event: EvidenceEvent): string {
  return stableKey({
    type: event.type,
    source: event.source,
    occurredAt: event.occurredAt,
    payload: event.payload,
  });
}

function sameBusinessContent(a: EvidenceEvent, b: EvidenceEvent): boolean {
  return (
    a.type === b.type &&
    a.source === b.source &&
    a.occurredAt === b.occurredAt &&
    jsonEquals(a.payload, b.payload)
  );
}

/**
 * Which of two attestations for the same source wins. Later `observedAt`
 * wins. On a tie the more conservative one wins: unavailable over available,
 * non-authoritative over authoritative, no watermark over any watermark,
 * an earlier watermark over a later one, then a content key so the choice is
 * total. Returns > 0 when `candidate` should replace `current`.
 */
function attestationOrder(candidate: SourceStatus, current: SourceStatus): number {
  const byObserved = toEpochMillis(candidate.observedAt) - toEpochMillis(current.observedAt);
  if (byObserved !== 0) return byObserved;
  const conservative = (status: SourceStatus): number =>
    (status.status === 'unavailable' ? 4 : 0) +
    (status.authoritative ? 0 : 2) +
    (status.completeThrough === undefined ? 1 : 0);
  const byConservative = conservative(candidate) - conservative(current);
  if (byConservative !== 0) return byConservative;
  if (candidate.completeThrough !== undefined && current.completeThrough !== undefined) {
    const byWatermark =
      toEpochMillis(current.completeThrough) - toEpochMillis(candidate.completeThrough);
    if (byWatermark !== 0) return byWatermark;
  }
  const ka = stableKey(candidate);
  const kb = stableKey(current);
  return ka < kb ? 1 : ka > kb ? -1 : 0;
}

/**
 * Immutable, order-independent view over a batch of evidence records.
 * Construction is deterministic: whatever order records arrive in, the same
 * set yields the same deduplicated events and the same latest source status.
 */
export class EvidenceSet {
  readonly #events: ReadonlyMap<string, DedupedEvent>;
  readonly #sources: ReadonlyMap<string, SourceStatus>;
  readonly #byType: ReadonlyMap<string, readonly DedupedEvent[]>;

  private constructor(
    events: ReadonlyMap<string, DedupedEvent>,
    sources: ReadonlyMap<string, SourceStatus>,
  ) {
    this.#events = events;
    this.#sources = sources;
    const byType = new Map<string, DedupedEvent[]>();
    for (const event of events.values()) {
      const bucket = byType.get(event.canonical.type) ?? [];
      bucket.push(event);
      byType.set(event.canonical.type, bucket);
    }
    for (const bucket of byType.values()) {
      bucket.sort((a, b) => compareEvents(a.canonical, b.canonical));
    }
    this.#byType = byType;
  }

  static from(records: Iterable<EvidenceRecord>): EvidenceSet {
    const deliveries = new Map<string, EvidenceEvent[]>();
    const sources = new Map<string, SourceStatus>();
    for (const record of records) {
      if (record.kind === 'event') {
        const bucket = deliveries.get(record.eventId) ?? [];
        bucket.push(record);
        deliveries.set(record.eventId, bucket);
      } else {
        const existing = sources.get(record.source);
        if (existing === undefined || attestationOrder(record, existing) > 0) {
          sources.set(record.source, record);
        }
      }
    }
    const events = new Map<string, DedupedEvent>();
    for (const [eventId, bucket] of deliveries) {
      bucket.sort(deliveryOrder);
      const canonical = bucket[0];
      if (canonical === undefined) continue;
      const conflicting = bucket.some((delivery) => !sameBusinessContent(canonical, delivery));
      events.set(eventId, { canonical, deliveries: bucket, conflicting });
    }
    return new EvidenceSet(events, sources);
  }

  static empty(): EvidenceSet {
    return EvidenceSet.from([]);
  }

  eventsOfType(type: string): readonly DedupedEvent[] {
    return this.#byType.get(type) ?? [];
  }

  event(eventId: string): DedupedEvent | undefined {
    return this.#events.get(eventId);
  }

  get events(): readonly DedupedEvent[] {
    return [...this.#events.values()].sort((a, b) => compareEvents(a.canonical, b.canonical));
  }

  sourceStatus(source: string): SourceStatus | undefined {
    return this.#sources.get(source);
  }

  get sources(): readonly SourceStatus[] {
    return [...this.#sources.values()].sort((a, b) => (a.source < b.source ? -1 : 1));
  }

  get size(): number {
    return this.#events.size;
  }
}
