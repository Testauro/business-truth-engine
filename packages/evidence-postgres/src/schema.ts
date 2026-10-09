/**
 * Append-only schema. Two tables mirror the two evidence record kinds (ADR 0003).
 * The validated record is stored verbatim as JSONB next to the columns the
 * store filters on; reads re-validate it, so the contract holds in both directions.
 *
 * Idempotency: an identical row (same identity and same content) inserted twice
 * is stored once, so re-running an ingest is safe. A genuine redelivery (another
 * delivery id or collection time) is a new row and is deduplicated by the engine.
 */
export const DEFAULT_SCHEMA = 'bte';

const IDENT = /^[a-z_][a-z0-9_]*$/;

export function assertIdentifier(name: string): string {
  if (!IDENT.test(name)) throw new TypeError(`invalid SQL identifier "${name}"`);
  return name;
}

export function ddl(schema: string): string[] {
  const s = assertIdentifier(schema);
  return [
    `CREATE SCHEMA IF NOT EXISTS ${s}`,
    `CREATE TABLE IF NOT EXISTS ${s}.evidence_events (
       id            BIGSERIAL PRIMARY KEY,
       event_id      TEXT        NOT NULL,
       type          TEXT        NOT NULL,
       source        TEXT        NOT NULL,
       occurred_at   TIMESTAMPTZ NOT NULL,
       collected_at  TIMESTAMPTZ NOT NULL,
       delivery_id   TEXT,
       payload       JSONB       NOT NULL,
       record        JSONB       NOT NULL,
       record_hash   TEXT        NOT NULL,
       inserted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS evidence_events_identity
       ON ${s}.evidence_events (event_id, COALESCE(delivery_id, ''), record_hash)`,
    `CREATE INDEX IF NOT EXISTS evidence_events_type_source ON ${s}.evidence_events (type, source)`,
    `CREATE INDEX IF NOT EXISTS evidence_events_collected ON ${s}.evidence_events (collected_at)`,
    `CREATE INDEX IF NOT EXISTS evidence_events_payload ON ${s}.evidence_events USING GIN (payload)`,
    `CREATE TABLE IF NOT EXISTS ${s}.evidence_sources (
       id              BIGSERIAL PRIMARY KEY,
       source          TEXT        NOT NULL,
       observed_at     TIMESTAMPTZ NOT NULL,
       status          TEXT        NOT NULL,
       authoritative   BOOLEAN     NOT NULL,
       complete_through TIMESTAMPTZ,
       record          JSONB       NOT NULL,
       record_hash     TEXT        NOT NULL,
       inserted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS evidence_sources_identity
       ON ${s}.evidence_sources (source, observed_at, record_hash)`,
    `CREATE INDEX IF NOT EXISTS evidence_sources_observed ON ${s}.evidence_sources (observed_at)`,
    // Append-only: nobody updates or deletes evidence through the application role.
    `CREATE OR REPLACE FUNCTION ${s}.evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'evidence is append-only (% on %)', TG_OP, TG_TABLE_NAME; END $$`,
    `DROP TRIGGER IF EXISTS evidence_events_immutable ON ${s}.evidence_events`,
    `CREATE TRIGGER evidence_events_immutable BEFORE UPDATE OR DELETE ON ${s}.evidence_events
       FOR EACH ROW EXECUTE FUNCTION ${s}.evidence_immutable()`,
    `DROP TRIGGER IF EXISTS evidence_sources_immutable ON ${s}.evidence_sources`,
    `CREATE TRIGGER evidence_sources_immutable BEFORE UPDATE OR DELETE ON ${s}.evidence_sources
       FOR EACH ROW EXECUTE FUNCTION ${s}.evidence_immutable()`,
  ];
}
