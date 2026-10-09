# ADR 0003: Evidence model and NDJSON

Status: accepted (2026-10-09)

## Context

Evidence arrives from several systems, sometimes late, out of order, or more than once. The
engine must separate what happened from when BTE learned of it, and must know whether a source
can be believed.

## Decision

Two record kinds, validated with Zod (`packages/core/src/contracts/evidence.ts`):

- `event`: `eventId` (business identity; redeliveries share it), `type`, `source`,
  `occurredAt` (business time), `collectedAt` (collection time), optional `deliveryId`,
  `payload`.
- `source`: `source`, `observedAt`, `status` (`available | unavailable`), `authoritative`,
  optional `completeThrough` watermark, optional `note`. The latest `observedAt` wins; on a
  tie the non-authoritative attestation wins (conservative).

Storage format for Milestone A–C is NDJSON, one record per line, `#` comments allowed. Parsing
errors report file and line. `EvidenceSet.from(records)` produces an order-independent view.

## Consequences

- Any adapter that can produce these two records can feed the engine: Playwright fixtures,
  log scrapers, database pollers, message-queue taps.
- A PostgreSQL store later needs only an append-only table per kind plus the same reader.
- Evidence files can be committed as fixtures and replayed deterministically.
