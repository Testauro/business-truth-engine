import { readFile } from 'node:fs/promises';

export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(message: string, issues: readonly string[] = []) {
    super(issues.length > 0 ? `${message}\n  - ${issues.join('\n  - ')}` : message);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const PLACEHOLDER = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;

/**
 * Replace `${VAR}` and `${VAR:-default}` in every string of a JSON-like value.
 * Missing variables without a default are collected and reported together,
 * so a misconfigured CI job fails with every missing name at once.
 */
export function interpolateEnv<T>(value: T, env: Readonly<Record<string, string | undefined>>): T {
  const missing = new Set<string>();
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return node.replace(PLACEHOLDER, (_m, name: string, fallback: string | undefined) => {
        const found = env[name];
        if (found !== undefined && found !== '') return found;
        if (fallback !== undefined) return fallback;
        missing.add(name);
        return '';
      });
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]),
      );
    }
    return node;
  };
  const result = walk(value) as T;
  if (missing.size > 0) {
    throw new ConfigError(
      'configuration references environment variables that are not set',
      [...missing]
        .sort()
        .map((name) => `${name} (set it in the environment or in a git-ignored .env file)`),
    );
  }
  return result;
}

/** Minimal `.env` parser: KEY=value lines, `#` comments, optional single/double quotes. No expansion. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Load `.env` from a directory if present. Values never override an existing environment variable. */
export async function loadDotEnv(
  file: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Record<string, string | undefined>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { ...env };
  }
  const parsed = parseDotEnv(text);
  const merged: Record<string, string | undefined> = { ...env };
  for (const [key, value] of Object.entries(parsed)) merged[key] ??= value;
  return merged;
}
