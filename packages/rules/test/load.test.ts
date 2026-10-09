import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RuleLoadError, loadRules, parseRuleYaml, ruleJsonSchema } from '../src/index.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('loadRules', () => {
  it('loads the repository rules directory', async () => {
    const rules = await loadRules(path.join(repoRoot, 'rules'));
    expect(rules.map((rule) => `${rule.id}@${rule.version}`)).toEqual(['invoice-created-once@1']);
    expect(rules[0]?.expectations[0]?.assertions).toHaveLength(5);
    expect(rules[0]?.expectations[0]?.assertions.map((a) => a.op)).toEqual([
      'equals',
      'equals',
      'equals',
      'in',
      'matches',
    ]);
  });

  it('reports schema violations with the file name and path', () => {
    expect(() => parseRuleYaml('id: nope\nversion: 1\n', 'bad.yaml')).toThrow(RuleLoadError);
    try {
      parseRuleYaml('id: nope\nversion: 1\n', 'bad.yaml');
    } catch (error) {
      expect(error).toBeInstanceOf(RuleLoadError);
      expect((error as RuleLoadError).issues.join('\n')).toContain('trigger');
    }
  });

  it('reports YAML syntax errors', () => {
    expect(() => parseRuleYaml('id: [unclosed', 'bad.yaml')).toThrow(/invalid YAML/);
  });

  it('rejects duplicate id/version across files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bte-rules-'));
    const body = `id: r\nversion: 1\ntrigger: { type: a, correlationKey: k }\nexpectations:\n  - type: b\n    source: s\n    window: { within: 1s }\n    cardinality: exactly-one\n`;
    await writeFile(path.join(dir, 'a.yaml'), body);
    await writeFile(path.join(dir, 'b.yml'), body);
    await writeFile(path.join(dir, 'notes.txt'), 'ignored');
    await expect(loadRules(dir)).rejects.toThrow(/duplicate rule id\/version/);
  });

  it('exposes a JSON schema for editors', () => {
    const schema = ruleJsonSchema();
    expect(schema['type']).toBe('object');
  });
});
