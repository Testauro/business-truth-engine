import { z } from 'zod';

/**
 * Evidence contracts.
 *
 * Two kinds of evidence records exist:
 *  - `event`:  something happened in a business system (order.paid,
 *              invoice.created, ...). `occurredAt` is the business time;
 *              `collectedAt` is when BTE obtained it. The same business event
 *              may be delivered more than once (same `eventId`).
 *  - `source`: an attestation about an evidence source itself. It says
 *              whether the source was reachable, whether it is authoritative
 *              for the facts it reports, and through what instant its data is
 *              complete (`completeThrough`, a watermark).
 *
 * Verdicts can only be PASS or FAIL on the back of authoritative, complete
 * evidence. Everything else degrades to PENDING or UNKNOWN.
 */

const isoDateTime = z.iso.datetime({ offset: true });
const nonEmpty = z.string().trim().min(1);

export const EvidenceEventSchema = z
  .object({
    kind: z.literal('event'),
    /** Identity of the business event. Redeliveries share this id. */
    eventId: nonEmpty,
    /** Event type, e.g. `order.paid`, `invoice.created`. */
    type: nonEmpty,
    /** Logical source system that produced the event. */
    source: nonEmpty,
    /** When the business event happened (business time). */
    occurredAt: isoDateTime,
    /** When BTE collected this delivery (collection time). */
    collectedAt: isoDateTime,
    /** Identity of this particular delivery attempt, if the transport has one. */
    deliveryId: nonEmpty.optional(),
    /** Business payload. */
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;

export const SourceStatusSchema = z
  .object({
    kind: z.literal('source'),
    source: nonEmpty,
    /** When this attestation was produced. Later attestations supersede earlier ones. */
    observedAt: isoDateTime,
    status: z.enum(['available', 'unavailable']),
    /** Whether this source is the system of record for the facts it reports. */
    authoritative: z.boolean(),
    /**
     * Watermark: every event with `occurredAt <= completeThrough` that this
     * source knows about has been delivered to BTE. Absent when the source
     * cannot make such a promise.
     */
    completeThrough: isoDateTime.optional(),
    note: z.string().optional(),
  })
  .strict();

export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const EvidenceRecordSchema = z.discriminatedUnion('kind', [
  EvidenceEventSchema,
  SourceStatusSchema,
]);

export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export function parseEvidenceRecord(input: unknown): EvidenceRecord {
  return EvidenceRecordSchema.parse(input);
}
