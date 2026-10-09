import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { RuleSchema } from '@bte/core';
import type { Rule } from '@bte/core';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { RuleLoadError } from './errors.js';

const RULE_EXTENSIONS = new Set(['.yaml', '.yml']);

/** Parse YAML text into a validated rule. `file` is used for error messages only. */
export function parseRuleYaml(text: string, file = '<inline>'): Rule {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (error) {
    throw new RuleLoadError(
      file,
      `invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = RuleSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`,
    );
    throw new RuleLoadError(file, 'rule does not match the schema', issues);
  }
  return result.data;
}

export async function loadRuleFile(file: string): Promise<Rule> {
  const text = await readFile(file, 'utf8');
  return parseRuleYaml(text, file);
}

/** Load every `*.yaml` / `*.yml` rule from a file or directory (non-recursive directories are walked one level deep per call, recursively). */
export async function loadRules(target: string): Promise<Rule[]> {
  const info = await stat(target);
  if (info.isFile()) return [await loadRuleFile(target)];
  const entries = await readdir(target, { withFileTypes: true });
  const rules: Rule[] = [];
  const names = entries.map((entry) => entry.name).sort();
  for (const name of names) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (entry === undefined) continue;
    const full = path.join(target, name);
    if (entry.isDirectory()) {
      rules.push(...(await loadRules(full)));
    } else if (RULE_EXTENSIONS.has(path.extname(name))) {
      rules.push(await loadRuleFile(full));
    }
  }
  assertUniqueIds(rules, target);
  return rules;
}

function assertUniqueIds(rules: readonly Rule[], target: string): void {
  const seen = new Map<string, number>();
  for (const rule of rules) {
    const key = `${rule.id}@${rule.version}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  if (duplicates.length > 0) {
    throw new RuleLoadError(target, 'duplicate rule id/version', duplicates);
  }
}

/** Useful for tooling that wants the JSON Schema of a rule document. */
export function ruleJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(RuleSchema, { io: 'input' });
}
