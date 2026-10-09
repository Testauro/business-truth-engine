import { createHash } from 'node:crypto';
import type { EvidenceEvent, EvidenceRecord, SourceStatus } from '@bte/core';
import { EvidenceRecordSchema, EvidenceSet, stableKey, toEpochMillis, toIso } from '@bte/core';
import pg from 'pg';
import { DEFAULT_SCHEMA, assertIdentifier, ddl } from './schema.js';

const { Pool } = pg;

export interface PostgresStoreOptions {
  /** Schema that holds the evidence tables. Created by `migrate()`. */
  schema?: string | undefined;
}

export interface LoadFilter {
  /** Only these event types (source attestations are always loaded). */
  types?: readonly string[] | undefined;
  /** Only events and attestations from these sources. */
  sources?: readonly string[] | undefined;
  /** Only events whose payload has this value at this dotted path (plus attestations). */
  correlation?: { path: string; value: unknown } | undefined;
  /**
   * "As of" evaluation: only rows collected / observed at or before this instant.
   * Lets a replay use exactly the evidence that existed at evaluation time.
   */
  collectedUntil?: string | number | Date | undefined;
}

export interface AppendResult {
  events: { inserted: number; duplicates: number };
  sources: { inserted: number; duplicates: number };
}

export class EvidenceStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EvidenceStoreError';
  }
}

function hashRecord(record: EvidenceRecord): string {
  return createHash('sha256').update(stableKey(record)).digest('hex');
}

function pathToJsonb(path: string): string[] {
  const segments = path.split('.');
  for (const segment of segments) {
    if (!/^[A-Za-z0-9_]+$/.test(segment)) throw new TypeError(`invalid payload path "${path}"`);
  }
  return segments;
}

/**
 * Append-only PostgreSQL evidence store. Writes are idempotent per identical
 * record; reads re-validate every row against the core contract and hand back
 * records in a deterministic order, or directly an `EvidenceSet`.
 */
export class PostgresEvidenceStore {
  readonly #pool: pg.Pool;
  readonly #schema: string;
  readonly #ownsPool: boolean;

  constructor(pool: pg.Pool, options: PostgresStoreOptions = {}, ownsPool = false) {
    this.#pool = pool;
    this.#schema = assertIdentifier(options.schema ?? DEFAULT_SCHEMA);
    this.#ownsPool = ownsPool;
  }

  /** Create a store with its own pool from a connection string. */
  static connect(
    connectionString: string,
    options: PostgresStoreOptions = {},
  ): PostgresEvidenceStore {
    return new PostgresEvidenceStore(new Pool({ connectionString, max: 4 }), options, true);
  }

  get schema(): string {
    return this.#schema;
  }

  /** Create schema, tables, indexes and the append-only triggers. Idempotent. */
  async migrate(): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      for (const statement of ddl(this.#schema)) await client.query(statement);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new EvidenceStoreError('migration failed', { cause: error });
    } finally {
      client.release();
    }
  }

  async append(record: EvidenceRecord): Promise<AppendResult> {
    return this.appendAll([record]);
  }

  /** Insert records in one transaction; identical rows are skipped, never duplicated. */
  async appendAll(records: Iterable<EvidenceRecord>): Promise<AppendResult> {
    const result: AppendResult = {
      events: { inserted: 0, duplicates: 0 },
      sources: { inserted: 0, duplicates: 0 },
    };
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      for (const raw of records) {
        const record = EvidenceRecordSchema.parse(raw);
        const hash = hashRecord(record);
        if (record.kind === 'event') {
          const res = await client.query(
            `INSERT INTO ${this.#schema}.evidence_events
               (event_id, type, source, occurred_at, collected_at, delivery_id, payload, record, record_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
             ON CONFLICT DO NOTHING`,
            [
              record.eventId,
              record.type,
              record.source,
              record.occurredAt,
              record.collectedAt,
              record.deliveryId ?? null,
              JSON.stringify(record.payload),
              JSON.stringify(record),
              hash,
            ],
          );
          if (res.rowCount === 1) result.events.inserted += 1;
          else result.events.duplicates += 1;
        } else {
          const res = await client.query(
            `INSERT INTO ${this.#schema}.evidence_sources
               (source, observed_at, status, authoritative, complete_through, record, record_hash)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
             ON CONFLICT DO NOTHING`,
            [
              record.source,
              record.observedAt,
              record.status,
              record.authoritative,
              record.completeThrough ?? null,
              JSON.stringify(record),
              hash,
            ],
          );
          if (res.rowCount === 1) result.sources.inserted += 1;
          else result.sources.duplicates += 1;
        }
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error instanceof EvidenceStoreError
        ? error
        : new EvidenceStoreError(
            `append failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
    } finally {
      client.release();
    }
  }

  /** Load records (events first, then attestations), each re-validated, in a deterministic order. */
  async load(filter: LoadFilter = {}): Promise<EvidenceRecord[]> {
    const until =
      filter.collectedUntil === undefined ? null : toIso(toEpochMillis(filter.collectedUntil));

    const eventWhere: string[] = [];
    const eventParams: unknown[] = [];
    const param = (value: unknown): string => {
      eventParams.push(value);
      return `$${eventParams.length}`;
    };
    if (filter.types !== undefined)
      eventWhere.push(`type = ANY(${param([...filter.types])}::text[])`);
    if (filter.sources !== undefined)
      eventWhere.push(`source = ANY(${param([...filter.sources])}::text[])`);
    if (filter.correlation !== undefined) {
      const segments = pathToJsonb(filter.correlation.path);
      eventWhere.push(
        `payload #> ${param(segments)}::text[] = ${param(JSON.stringify(filter.correlation.value))}::jsonb`,
      );
    }
    if (until !== null) eventWhere.push(`collected_at <= ${param(until)}::timestamptz`);
    const events = await this.#pool.query<{ record: unknown }>(
      `SELECT record FROM ${this.#schema}.evidence_events
       ${eventWhere.length > 0 ? `WHERE ${eventWhere.join(' AND ')}` : ''}
       ORDER BY occurred_at, collected_at, event_id, COALESCE(delivery_id, ''), id`,
      eventParams,
    );

    const sourceWhere: string[] = [];
    const sourceParams: unknown[] = [];
    if (filter.sources !== undefined) {
      sourceParams.push([...filter.sources]);
      sourceWhere.push(`source = ANY($${sourceParams.length}::text[])`);
    }
    if (until !== null) {
      sourceParams.push(until);
      sourceWhere.push(`observed_at <= $${sourceParams.length}::timestamptz`);
    }
    const sources = await this.#pool.query<{ record: unknown }>(
      `SELECT record FROM ${this.#schema}.evidence_sources
       ${sourceWhere.length > 0 ? `WHERE ${sourceWhere.join(' AND ')}` : ''}
       ORDER BY observed_at, source, id`,
      sourceParams,
    );

    const records: EvidenceRecord[] = [];
    for (const row of [...events.rows, ...sources.rows]) {
      const parsed = EvidenceRecordSchema.safeParse(row.record);
      if (!parsed.success) {
        throw new EvidenceStoreError(
          `stored evidence violates the contract: ${parsed.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')}`,
        );
      }
      records.push(parsed.data);
    }
    return records;
  }

  async snapshot(filter: LoadFilter = {}): Promise<EvidenceSet> {
    return EvidenceSet.from(await this.load(filter));
  }

  async counts(): Promise<{ events: number; sources: number }> {
    const [events, sources] = await Promise.all([
      this.#pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${this.#schema}.evidence_events`,
      ),
      this.#pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${this.#schema}.evidence_sources`,
      ),
    ]);
    return { events: Number(events.rows[0]?.n ?? 0), sources: Number(sources.rows[0]?.n ?? 0) };
  }

  /** Drop the schema and everything in it. For tests only. */
  async destroy(): Promise<void> {
    await this.#pool.query(`DROP SCHEMA IF EXISTS ${this.#schema} CASCADE`);
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }
}

export type { EvidenceEvent, EvidenceRecord, SourceStatus };
