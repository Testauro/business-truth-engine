import { z } from 'zod';
import { toEpochMillis, toIso } from './clock.js';
import type { EvidenceEvent } from './contracts/evidence.js';
import { EvidenceEventSchema } from './contracts/evidence.js';
import { getPath } from './path.js';

/**
 * Declarative mapping from an application's own JSON shape to BTE events.
 * Pure: adapters fetch, this maps. A mapping is validated once at config load
 * (`MappingSchema`), and every mapped item is validated against the evidence
 * contract, so a drifted API surfaces as a precise problem rather than a
 * silently wrong verdict.
 */

const path = z.string().regex(/^[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*$/, 'must be a dotted path');

export const FieldSourceSchema = z.union([
  path,
  z.object({ path }).strict(),
  z.object({ const: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict(),
  /** `${...}` placeholders are replaced by item values at those dotted paths. */
  z.object({ template: z.string().min(1) }).strict(),
]);
export type FieldSource = z.infer<typeof FieldSourceSchema>;

export const MappingSchema = z
  .object({
    /** Event type emitted for every item. */
    type: z.string().trim().min(1),
    /** Dotted path to the array of items in the response. Omit when the response itself is the array (or a single item). */
    items: path.optional(),
    /** Only items where this path equals this value are mapped. */
    filter: z
      .object({ path, equals: z.union([z.string(), z.number(), z.boolean(), z.null()]) })
      .strict()
      .optional(),
    eventId: FieldSourceSchema,
    /** ISO-8601 string or epoch milliseconds on the item. */
    occurredAt: FieldSourceSchema,
    deliveryId: FieldSourceSchema.optional(),
    /** Output payload field → where to read it on the item. */
    payload: z.record(z.string().min(1), FieldSourceSchema),
  })
  .strict();
export type Mapping = z.infer<typeof MappingSchema>;

export interface MappingProblem {
  index: number;
  field: string;
  message: string;
}

export interface MapResult {
  events: EvidenceEvent[];
  problems: MappingProblem[];
}

export class MappingError extends Error {
  readonly problems: readonly MappingProblem[];
  constructor(source: string, problems: readonly MappingProblem[]) {
    super(
      `mapping for source "${source}" failed on ${problems.length} item(s): ${problems
        .slice(0, 5)
        .map((p) => `#${p.index} ${p.field}: ${p.message}`)
        .join('; ')}${problems.length > 5 ? '; ...' : ''}`,
    );
    this.name = 'MappingError';
    this.problems = problems;
  }
}

/** Read a mapped field; `undefined` means "no value", and a template with a missing placeholder is no value. */
function readField(item: unknown, field: FieldSource): unknown {
  if (typeof field === 'string') return getPath(item, field);
  if ('path' in field) return getPath(item, field.path);
  if ('const' in field) return field.const;
  const state = { missing: false };
  const text = field.template.replace(/\$\{([^}]+)\}/g, (_match, inner: string) => {
    const value = getPath(item, inner.trim());
    if (value === undefined) {
      state.missing = true;
      return '';
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
  return state.missing ? undefined : text;
}

function selectItems(root: unknown, mapping: Mapping): unknown[] {
  const target = mapping.items === undefined ? root : getPath(root, mapping.items);
  if (target === undefined || target === null) return [];
  return Array.isArray(target) ? target : [target];
}

/** Map a response body to events. Items that fail are reported, never silently dropped. */
export function mapItems(
  mapping: Mapping,
  root: unknown,
  context: { source: string; collectedAt: number },
): MapResult {
  const result: MapResult = { events: [], problems: [] };
  const items = selectItems(root, mapping);
  items.forEach((item, index) => {
    if (mapping.filter !== undefined) {
      const value = getPath(item, mapping.filter.path);
      if (value !== mapping.filter.equals) return;
    }
    const problems: MappingProblem[] = [];
    const eventId = readField(item, mapping.eventId);
    if (typeof eventId !== 'string' && typeof eventId !== 'number') {
      problems.push({
        index,
        field: 'eventId',
        message: `expected a string or number, got ${JSON.stringify(eventId)}`,
      });
    }
    const occurredRaw = readField(item, mapping.occurredAt);
    let occurredAt: string | undefined;
    try {
      if (typeof occurredRaw !== 'string' && typeof occurredRaw !== 'number')
        throw new TypeError('not a timestamp');
      occurredAt = toIso(toEpochMillis(occurredRaw));
    } catch {
      problems.push({
        index,
        field: 'occurredAt',
        message: `expected ISO-8601 or epoch millis, got ${JSON.stringify(occurredRaw)}`,
      });
    }
    const deliveryRaw =
      mapping.deliveryId === undefined ? undefined : readField(item, mapping.deliveryId);
    if (
      deliveryRaw !== undefined &&
      typeof deliveryRaw !== 'string' &&
      typeof deliveryRaw !== 'number'
    ) {
      problems.push({
        index,
        field: 'deliveryId',
        message: `expected a string or number, got ${JSON.stringify(deliveryRaw)}`,
      });
    }
    const payload: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(mapping.payload)) {
      const value = readField(item, field);
      if (value === undefined) {
        problems.push({ index, field: `payload.${key}`, message: 'no value at the mapped path' });
        continue;
      }
      payload[key] = value;
    }
    if (problems.length > 0) {
      result.problems.push(...problems);
      return;
    }
    const candidate = {
      kind: 'event' as const,
      eventId: String(eventId),
      type: mapping.type,
      source: context.source,
      occurredAt: occurredAt ?? '',
      collectedAt: toIso(context.collectedAt),
      ...(typeof deliveryRaw === 'string' || typeof deliveryRaw === 'number'
        ? { deliveryId: String(deliveryRaw) }
        : {}),
      payload,
    };
    const parsed = EvidenceEventSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        result.problems.push({
          index,
          field: issue.path.map(String).join('.') || '<record>',
          message: issue.message,
        });
      }
      return;
    }
    result.events.push(parsed.data);
  });
  return result;
}
