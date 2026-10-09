import { EvidenceRecordSchema, EvidenceSet } from '@bte/core';
import type { EvidenceRecord } from '@bte/core';

/**
 * Append-only in-memory evidence store. Records are validated on the way in
 * and never mutated. `snapshot()` returns a deduplicated, order-independent
 * EvidenceSet for the evaluator.
 */
export class InMemoryEvidenceStore {
  readonly #records: EvidenceRecord[] = [];

  append(record: EvidenceRecord): void {
    this.#records.push(EvidenceRecordSchema.parse(record));
  }

  appendAll(records: Iterable<EvidenceRecord>): void {
    for (const record of records) this.append(record);
  }

  get records(): readonly EvidenceRecord[] {
    return this.#records;
  }

  snapshot(): EvidenceSet {
    return EvidenceSet.from(this.#records);
  }
}
