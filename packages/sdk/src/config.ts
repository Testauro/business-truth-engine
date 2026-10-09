import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { HttpSourceConfigSchema } from '@bte/evidence-http';
import { ConfigError, interpolateEnv, loadDotEnv } from './env.js';

/**
 * `bte.config.*` contract. Everything a consumer needs to point BTE at an
 * application lives here: where the rules are, which evidence sources exist
 * and how to reach them, and the gate for CI. Secrets are referenced as
 * `${ENV_VAR}` and resolved at load time.
 */
const nonEmpty = z.string().trim().min(1);

export const NdjsonSourceConfigSchema = z
  .object({
    type: z.literal('ndjson'),
    /** Logical name is taken from the records themselves; this is only a label. */
    name: nonEmpty.optional(),
    files: z.array(nonEmpty).min(1),
  })
  .strict();

export const PostgresSourceConfigSchema = z
  .object({
    type: z.literal('postgres'),
    name: nonEmpty.optional(),
    url: nonEmpty,
    schema: nonEmpty.optional(),
    /** Only load rows collected at or before the evaluation instant (default true). */
    asOf: z.boolean().default(true),
  })
  .strict();

export const CustomSourceConfigSchema = z
  .object({
    type: z.literal('custom'),
    name: nonEmpty,
    /** Module path (relative to the config file) exporting an EvidenceSource or a factory returning one. */
    module: nonEmpty,
    export: nonEmpty.default('default'),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const SourceConfigSchema = z.discriminatedUnion('type', [
  NdjsonSourceConfigSchema,
  HttpSourceConfigSchema,
  PostgresSourceConfigSchema,
  CustomSourceConfigSchema,
]);
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export const BteConfigSchema = z
  .object({
    /** Rule files or directories, relative to the config file. */
    rules: z.array(nonEmpty).min(1),
    sources: z.array(SourceConfigSchema).min(1),
    app: z.object({ baseUrl: z.url().optional() }).strict().optional(),
    gate: z
      .object({ failOn: z.enum(['fail', 'unknown', 'pending']).default('fail') })
      .strict()
      .default({ failOn: 'fail' }),
    report: z
      .object({ dir: nonEmpty.default('bte-report') })
      .strict()
      .default({ dir: 'bte-report' }),
    /** Fixed evaluation instant (ISO-8601) for reproducible runs; default: wall clock. */
    now: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type BteConfigInput = z.input<typeof BteConfigSchema>;
export type BteConfig = z.infer<typeof BteConfigSchema>;

export interface LoadedConfig {
  config: BteConfig;
  /** Absolute path of the file the config came from. */
  file: string;
  /** Directory relative paths resolve against. */
  dir: string;
  env: Readonly<Record<string, string | undefined>>;
}

/** Author a config in TypeScript with full typing; validated when loaded. */
export function defineConfig(config: BteConfigInput): BteConfigInput {
  return config;
}

export const CONFIG_FILES = [
  'bte.config.ts',
  'bte.config.mts',
  'bte.config.mjs',
  'bte.config.js',
  'bte.config.json',
] as const;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function findConfigFile(cwd: string): Promise<string | undefined> {
  for (const name of CONFIG_FILES) {
    const candidate = path.join(cwd, name);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

export function validateConfig(raw: unknown, file = '<inline>'): BteConfig {
  const result = BteConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      `${file}: invalid BTE configuration`,
      result.error.issues.map(
        (issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}

export interface LoadConfigOptions {
  cwd?: string | undefined;
  /** Explicit config file; otherwise the first of CONFIG_FILES in cwd. */
  file?: string | undefined;
  env?: Readonly<Record<string, string | undefined>> | undefined;
  /** `.env` file to merge (never overriding real environment variables). Default: `<cwd>/.env`. */
  dotenv?: string | false | undefined;
}

export interface RawConfig {
  raw: unknown;
  file: string;
  dir: string;
}

/**
 * Read a config file without interpolating environment variables or validating it.
 * Used by tooling that must not need secrets (e.g. `bte rules validate` only needs `rules`).
 */
export async function loadRawBteConfig(options: LoadConfigOptions = {}): Promise<RawConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const file =
    options.file === undefined ? await findConfigFile(cwd) : path.resolve(cwd, options.file);
  if (file === undefined) {
    throw new ConfigError(
      `no BTE configuration found in ${cwd} (looked for ${CONFIG_FILES.join(', ')}); run \`bte init\``,
    );
  }
  if (!(await exists(file))) throw new ConfigError(`configuration file not found: ${file}`);
  let raw: unknown;
  if (file.endsWith('.json')) {
    const { readFile } = await import('node:fs/promises');
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      throw new ConfigError(
        `${file}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    let module: Record<string, unknown>;
    try {
      module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    } catch (error) {
      throw new ConfigError(
        `${file}: could not import configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    raw = module['default'] ?? module['config'];
    if (raw === undefined) {
      throw new ConfigError(
        `${file}: export the configuration as default (e.g. \`export default defineConfig({...})\`)`,
      );
    }
  }
  return { raw, file, dir: path.dirname(file) };
}

/** The `rules` targets of a config, resolved against its directory, without touching sources or secrets. */
export async function loadRuleTargets(options: LoadConfigOptions = {}): Promise<string[]> {
  const { raw, file, dir } = await loadRawBteConfig(options);
  const rules = (raw as { rules?: unknown } | null)?.rules;
  if (
    !Array.isArray(rules) ||
    rules.length === 0 ||
    !rules.every((r) => typeof r === 'string' && r.trim() !== '')
  ) {
    throw new ConfigError(`${file}: "rules" must be a non-empty array of paths`);
  }
  return rules.map((r) => path.resolve(dir, r));
}

/**
 * Load, interpolate and validate a config file. TypeScript configs are imported
 * natively (Node >= 24 strips types); JSON is parsed; both go through the same
 * `${ENV}` interpolation and schema.
 */
export async function loadBteConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const { raw, file, dir } = await loadRawBteConfig(options);
  const dotenvFile =
    options.dotenv === false ? undefined : (options.dotenv ?? path.join(dir, '.env'));
  const env =
    dotenvFile === undefined
      ? { ...(options.env ?? process.env) }
      : await loadDotEnv(dotenvFile, options.env ?? process.env);
  const interpolated = interpolateEnv(raw, env);
  const config = validateConfig(interpolated, file);
  return { config, file, dir, env };
}
