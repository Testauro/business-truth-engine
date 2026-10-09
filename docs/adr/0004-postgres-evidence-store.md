# ADR 0004: PostgreSQL evidence store

Status: accepted (2026-10-09)

## Context

NDJSON files are ideal for fixtures and single runs, but a team wants evidence to accumulate
across runs, be queried by correlation, and be replayed "as of" a past instant. ADR 0003 promised
that a database store would implement the same two record kinds with the same reader semantics.

## Decision

`@bte/evidence-postgres` provides `PostgresEvidenceStore` over `pg`:

- **Two append-only tables** per schema (`evidence_events`, `evidence_sources`) holding the
  filter columns plus the validated record as JSONB. `BEFORE UPDATE OR DELETE` triggers raise, so
  evidence cannot be altered through the application role. `migrate()` is idempotent.
- **Idempotent ingest.** A unique index on identity plus a SHA-256 of the canonical record means
  an identical row inserted twice is stored once (`ON CONFLICT DO NOTHING`, reported as a
  duplicate). A genuine redelivery, with another delivery id or collection time, is a new row; the
  engine still counts the event once. Batches are transactional: one invalid record rolls back all.
- **Reads re-validate.** Every row is parsed through `EvidenceRecordSchema` on the way out, so a
  row written around the API cannot smuggle an invalid record into a verdict.
- **Deterministic order.** Events by `occurred_at`, `collected_at`, `event_id`, delivery id, then
  row id; attestations by `observed_at`, `source`, row id. `EvidenceSet.from()` is
  order-independent anyway; the order only makes NDJSON exports stable.
- **Filters**: event types, sources, a payload path/value (JSONB containment via GIN), and
  `collectedUntil`. The last one is the "as of" replay: the CLI defaults it to `--now`, so an
  evaluation at a past instant only sees evidence that had been collected by then. This closes
  the review's open gap about evidence from the future, for the store path.
- **CLI**: `bte ingest --postgres <url> -e <ndjson...>` and `bte evaluate --postgres <url>`
  (combinable with `-e` files). Connection strings are redacted in reports and output.
- The core engine is untouched; the store is an adapter that produces an `EvidenceSet`.

## Testing

Integration tests run against a real PostgreSQL when `BTE_TEST_POSTGRES_URL` is set and skip
with a warning otherwise; CI provides a `postgres:17` service on the test job. Coverage
thresholds exclude the package only when no database is configured.

## Consequences

- Operators own the database; the store creates its schema but never drops it (except the
  test-only `destroy()`).
- Payload queries work on any JSON path, but only the correlation lookup is indexed by GIN
  containment; arbitrary predicates are not a goal.
- Retention and partitioning are deferred; the tables are append-only, so archiving is a copy.
