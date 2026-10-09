import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  defineRule,
  interpolateEnv,
  loadBteConfig,
  parseDotEnv,
  resolveSources,
  verify,
} from '../src/index.js';

async function scratch(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'bte-sdk-'));
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
  return dir;
}

describe('interpolateEnv / dotenv', () => {
  it('substitutes placeholders with defaults and reports every missing variable at once', () => {
    expect(interpolateEnv({ a: '${X}', b: ['${Y:-dflt}'], c: 1 }, { X: 'x' })).toEqual({
      a: 'x',
      b: ['dflt'],
      c: 1,
    });
    try {
      interpolateEnv({ a: '${MISSING_ONE}', b: { c: '${MISSING_TWO}' } }, {});
      throw new Error('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toEqual([
        'MISSING_ONE (set it in the environment or in a git-ignored .env file)',
        'MISSING_TWO (set it in the environment or in a git-ignored .env file)',
      ]);
    }
  });
  it('parses .env lines with quotes, comments and export prefix', () => {
    expect(parseDotEnv('# c\nexport A=1\nB="two words"\nC=\'x\'\nbad\n')).toEqual({
      A: '1',
      B: 'two words',
      C: 'x',
    });
  });
});

describe('loadBteConfig', () => {
  it('loads a TypeScript config natively, interpolates env from .env, resolves paths relative to the file', async () => {
    const dir = await scratch({
      'bte.config.ts': `export default { rules: ['rules'], sources: [{ type: 'http', name: 'lms', baseUrl: '\${LMS_URL}', auth: { type: 'bearer', token: '\${LMS_TOKEN}' }, requests: [{ url: '/x', mapping: { type: 't', eventId: 'id', occurredAt: 'at', payload: { k: 'k' } } }] }] };`,
      '.env': 'LMS_URL=http://127.0.0.1:1\nLMS_TOKEN=tkn\n',
    });
    const loaded = await loadBteConfig({ cwd: dir, env: {} });
    expect(loaded.file).toBe(path.join(dir, 'bte.config.ts'));
    expect(loaded.config.sources[0]).toMatchObject({
      type: 'http',
      baseUrl: 'http://127.0.0.1:1',
      auth: { type: 'bearer', token: 'tkn' },
    });
    expect(loaded.config.gate.failOn).toBe('fail');
  });

  it('loads JSON, prefers real env over .env, and names the file in schema errors', async () => {
    const dir = await scratch({
      'bte.config.json': JSON.stringify({
        rules: ['r'],
        sources: [{ type: 'ndjson', files: ['${F}'] }],
        gate: { failOn: 'sometimes' },
      }),
      '.env': 'F=dotenv.ndjson\n',
    });
    await expect(loadBteConfig({ cwd: dir, env: { F: 'real.ndjson' } })).rejects.toThrow(
      /bte\.config\.json: invalid BTE configuration[\s\S]*gate\.failOn/,
    );
    const dir2 = await scratch({
      'bte.config.json': JSON.stringify({
        rules: ['r'],
        sources: [{ type: 'ndjson', files: ['${F}'] }],
      }),
      '.env': 'F=dotenv.ndjson\n',
    });
    const loaded = await loadBteConfig({ cwd: dir2, env: { F: 'real.ndjson' } });
    expect(loaded.config.sources[0]).toMatchObject({ files: ['real.ndjson'] });
  });

  it('explains a missing config, a missing default export and unknown source types', async () => {
    const empty = await scratch({});
    await expect(loadBteConfig({ cwd: empty, env: {} })).rejects.toThrow(
      /no BTE configuration found.*run `bte init`/,
    );
    const noDefault = await scratch({ 'bte.config.mjs': 'export const nope = 1;' });
    await expect(loadBteConfig({ cwd: noDefault, env: {} })).rejects.toThrow(
      /export the configuration as default/,
    );
    const unknown = await scratch({
      'bte.config.json': JSON.stringify({ rules: ['r'], sources: [{ type: 'kafka' }] }),
    });
    await expect(loadBteConfig({ cwd: unknown, env: {} })).rejects.toThrow(/sources\.0/);
  });
});

describe('resolveSources + verify', () => {
  it('resolves ndjson and custom sources relative to the config, enforces matching names, and verifies end to end', async () => {
    const dir = await scratch({
      'bte.config.json': JSON.stringify({
        rules: ['rules'],
        now: '2026-01-15T10:03:00Z',
        sources: [
          { type: 'ndjson', name: 'files', files: ['evidence.ndjson'] },
          { type: 'custom', name: 'extra', module: './adapter.mjs' },
        ],
      }),
      'evidence.ndjson':
        [
          '{"kind":"source","source":"orders","observedAt":"2026-01-15T10:03:00.000Z","status":"available","authoritative":true,"completeThrough":"2026-01-15T10:03:00.000Z"}',
          '{"kind":"event","eventId":"o1","type":"thing.started","source":"orders","occurredAt":"2026-01-15T10:00:00.000Z","collectedAt":"2026-01-15T10:00:00.000Z","payload":{"thingId":"t1"}}',
        ].join('\n') + '\n',
      'adapter.mjs': `export default { name: 'extra', collect: async ({ now }) => [{ kind: 'source', source: 'extra', observedAt: new Date(now).toISOString(), status: 'available', authoritative: true, completeThrough: new Date(now).toISOString() }] };`,
    });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.join(dir, 'rules'));
    await writeFile(
      path.join(dir, 'rules', 'thing.yaml'),
      'id: thing-finished\nversion: 1\ntrigger: { type: thing.started, correlationKey: thingId }\nexpectations:\n  - type: thing.finished\n    source: extra\n    window: { within: 60s }\n    cardinality: exactly-one\n',
    );
    const loaded = await loadBteConfig({ cwd: dir, env: {} });
    const sources = await resolveSources(loaded);
    expect(sources.map((s) => s.name)).toEqual(['files', 'extra']);
    const result = await verify(loaded);
    expect(result.failures).toEqual([]);
    expect(result.verdicts.map((v) => [v.ruleId, v.verdict, v.reasons[0]?.code])).toEqual([
      ['thing-finished', 'FAIL', 'MISSING_EXPECTED_OUTCOME'],
    ]);
    expect(result.evaluatedAt).toBe(Date.parse('2026-01-15T10:03:00Z'));
  });

  it('rejects a custom adapter whose name differs from the config entry, and a non-adapter export', async () => {
    const dir = await scratch({
      'bte.config.json': JSON.stringify({
        rules: ['r'],
        sources: [{ type: 'custom', name: 'lms', module: './a.mjs' }],
      }),
      'a.mjs': "export default { name: 'other', collect: async () => [] };",
    });
    await expect(resolveSources(await loadBteConfig({ cwd: dir, env: {} }))).rejects.toThrow(
      /reports name "other"; names must match/,
    );
    const dir2 = await scratch({
      'bte.config.json': JSON.stringify({
        rules: ['r'],
        sources: [{ type: 'custom', name: 'lms', module: './a.mjs', export: 'thing' }],
      }),
      'a.mjs': 'export const thing = 42;',
    });
    await expect(resolveSources(await loadBteConfig({ cwd: dir2, env: {} }))).rejects.toThrow(
      /is not an EvidenceSource/,
    );
  });
});

describe('defineRule', () => {
  it('returns a validated rule or throws with the schema issues', () => {
    const rule = defineRule({
      id: 'x',
      version: 1,
      trigger: { type: 'a', correlationKey: 'k' },
      expectations: [
        { type: 'b', source: 's', window: { within: '1s' }, cardinality: 'exactly-one' },
      ],
    });
    expect(rule.expectations[0]?.assertions).toEqual([]);
    expect(() =>
      defineRule({
        id: 'Bad Id',
        version: 0,
        trigger: { type: 'a', correlationKey: 'k' },
        expectations: [],
      }),
    ).toThrow(/invalid rule "Bad Id":[\s\S]*id:[\s\S]*version/);
  });
});

describe('ndjsonSource and postgres source config', () => {
  it('ndjsonSource replays files verbatim', async () => {
    const { ndjsonSource } = await import('../src/index.js');
    const dir = await scratch({
      'a.ndjson':
        '{"kind":"source","source":"x","observedAt":"2026-01-01T00:00:00Z","status":"available","authoritative":true}\n',
    });
    const source = ndjsonSource('files', [path.join(dir, 'a.ndjson')]);
    expect((await source.collect({ now: 0 })).map((r) => r.kind)).toEqual(['source']);
  });

  it.skipIf(!process.env['BTE_TEST_POSTGRES_URL'])(
    'postgres source loads as-of the evaluation instant',
    async () => {
      const url = process.env['BTE_TEST_POSTGRES_URL'] ?? '';
      const dir = await scratch({
        'bte.config.json': JSON.stringify({
          rules: ['r'],
          sources: [{ type: 'postgres', name: 'store', url, schema: 'bte_sdk_test' }],
        }),
      });
      const { PostgresEvidenceStore } = await import('@bte/evidence-postgres');
      const store = PostgresEvidenceStore.connect(url, { schema: 'bte_sdk_test' });
      try {
        await store.migrate();
        await store.append({
          kind: 'source',
          source: 'x',
          observedAt: '2026-01-15T10:00:00.000Z',
          status: 'available',
          authoritative: true,
        });
        const [source] = await resolveSources(await loadBteConfig({ cwd: dir, env: {} }));
        expect(source?.name).toBe('store');
        expect(await source?.collect({ now: Date.parse('2026-01-15T09:00:00Z') })).toEqual([]);
        expect(await source?.collect({ now: Date.parse('2026-01-15T11:00:00Z') })).toHaveLength(1);
      } finally {
        await store.destroy();
        await store.close();
      }
    },
  );
});
