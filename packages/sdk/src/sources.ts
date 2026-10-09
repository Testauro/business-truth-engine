import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EvidenceSource } from '@bte/core';
import type * as PostgresModule from '@bte/evidence-postgres';
import { readAllEvidence } from '@bte/evidence';
import { createHttpSource } from '@bte/evidence-http';
import { ConfigError } from './env.js';
import type { LoadedConfig, SourceConfig } from './config.js';

/** Factory for a custom source type; receives the validated config entry and the config directory. */
export type SourceFactory = (
  entry: SourceConfig,
  context: { dir: string; env: Readonly<Record<string, string | undefined>> },
) => Promise<EvidenceSource> | EvidenceSource;

function isEvidenceSource(value: unknown): value is EvidenceSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { collect?: unknown }).collect === 'function'
  );
}

/** NDJSON files become a source that replays their records verbatim (attestations included). */
export function ndjsonSource(name: string, files: readonly string[]): EvidenceSource {
  return {
    name,
    collect: () => readAllEvidence(files),
  };
}

async function customSource(
  entry: Extract<SourceConfig, { type: 'custom' }>,
  dir: string,
  env: LoadedConfig['env'],
): Promise<EvidenceSource> {
  const file = path.resolve(dir, entry.module);
  let module: Record<string, unknown>;
  try {
    module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (error) {
    throw new ConfigError(
      `source "${entry.name}": could not import ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const exported = module[entry.export];
  if (exported === undefined)
    throw new ConfigError(`source "${entry.name}": ${file} has no export "${entry.export}"`);
  const value =
    typeof exported === 'function'
      ? await (exported as SourceFactory)(entry, { dir, env })
      : exported;
  if (!isEvidenceSource(value)) {
    throw new ConfigError(
      `source "${entry.name}": export "${entry.export}" of ${file} is not an EvidenceSource ({ name, collect })`,
    );
  }
  if (value.name !== entry.name) {
    throw new ConfigError(
      `source "${entry.name}": the adapter reports name "${value.name}"; names must match so rules refer to the right source`,
    );
  }
  return value;
}

async function postgresSource(
  entry: Extract<SourceConfig, { type: 'postgres' }>,
): Promise<EvidenceSource> {
  let mod: typeof PostgresModule;
  try {
    mod = await import('@bte/evidence-postgres');
  } catch {
    throw new ConfigError(
      'source type "postgres" needs the optional package @bte/evidence-postgres (npm install @bte/evidence-postgres)',
    );
  }
  const store = mod.PostgresEvidenceStore.connect(entry.url, { schema: entry.schema });
  return {
    name: entry.name ?? 'postgres',
    collect: (context) => store.load(entry.asOf ? { collectedUntil: context.now } : {}),
  };
}

/** Turn every configured source into an EvidenceSource. Paths resolve against the config directory. */
export async function resolveSources(loaded: LoadedConfig): Promise<EvidenceSource[]> {
  const sources: EvidenceSource[] = [];
  const names = new Map<string, number>();
  for (const [index, entry] of loaded.config.sources.entries()) {
    let source: EvidenceSource;
    switch (entry.type) {
      case 'ndjson':
        source = ndjsonSource(
          entry.name ?? `ndjson-${index + 1}`,
          entry.files.map((f) => path.resolve(loaded.dir, f)),
        );
        break;
      case 'http':
        source = createHttpSource(entry);
        break;
      case 'postgres':
        source = await postgresSource(entry);
        break;
      case 'custom':
        source = await customSource(entry, loaded.dir, loaded.env);
        break;
    }
    names.set(source.name, (names.get(source.name) ?? 0) + 1);
    sources.push(source);
  }
  const duplicates = [...names.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  if (duplicates.length > 0) {
    throw new ConfigError(
      'two sources share a name; each logical source must be configured once',
      duplicates,
    );
  }
  return sources;
}
