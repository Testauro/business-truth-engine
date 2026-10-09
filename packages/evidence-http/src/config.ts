import { z } from 'zod';
import { MappingSchema } from '@bte/core';

const nonEmpty = z.string().trim().min(1);

/**
 * Authentication is declared by shape; secret values are expected to be
 * `${ENV_VAR}` placeholders resolved by the config loader, never literals in Git.
 */
export const HttpAuthConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('bearer'), token: nonEmpty }).strict(),
  z.object({ type: z.literal('basic'), username: nonEmpty, password: z.string() }).strict(),
  z.object({ type: z.literal('header'), name: nonEmpty, value: nonEmpty }).strict(),
]);
export type HttpAuthConfig = z.infer<typeof HttpAuthConfigSchema>;

export const HttpRequestConfigSchema = z
  .object({
    /** Absolute URL, or a path resolved against `baseUrl`. `${correlation.key}` placeholders are substituted. */
    url: nonEmpty,
    method: z.enum(['GET', 'POST']).default('GET'),
    headers: z.record(z.string(), z.string()).default({}),
    /** JSON body for POST; `${correlation.key}` placeholders substituted in strings. */
    body: z.unknown().optional(),
    /** How the response maps to events. */
    mapping: MappingSchema,
  })
  .strict();
export type HttpRequestConfig = z.infer<typeof HttpRequestConfigSchema>;

export const HttpSourceConfigSchema = z
  .object({
    type: z.literal('http'),
    /** Logical source name used in rules. */
    name: nonEmpty,
    baseUrl: z.url().optional(),
    auth: HttpAuthConfigSchema.default({ type: 'none' }),
    headers: z.record(z.string(), z.string()).default({}),
    timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
    /** Is this API the system of record for what it reports? Caches and projections are not. */
    authoritative: z.boolean().default(true),
    /**
     * `snapshot`: a successful read is complete through the collection instant (the API serves
     * current state). `none`: the API cannot promise completeness (e.g. a bounded feed); absence
     * can then never be proven and verdicts degrade to UNKNOWN.
     */
    completeness: z.enum(['snapshot', 'none']).default('snapshot'),
    requests: z.array(HttpRequestConfigSchema).min(1),
  })
  .strict();
export type HttpSourceConfig = z.infer<typeof HttpSourceConfigSchema>;
export type HttpSourceConfigInput = z.input<typeof HttpSourceConfigSchema>;
