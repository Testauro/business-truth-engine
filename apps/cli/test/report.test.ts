import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runEvaluate } from '../src/index.js';
import type { EvaluationReport } from '../src/index.js';
import { renderJunit, renderMarkdown } from '../src/index.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const rules = path.join(repoRoot, 'rules');
const fixture = (name: string): string =>
  path.join(repoRoot, 'examples', 'fixtures', `${name}.ndjson`);
const NOW = '2026-01-15T10:03:00Z';

async function report(
  name: string,
  failOn: 'fail' | 'unknown' | 'pending' = 'fail',
): Promise<EvaluationReport> {
  return (
    await runEvaluate({
      rules: [rules],
      evidence: [fixture(name)],
      now: NOW,
      format: 'json',
      failOn,
    })
  ).report;
}

describe('JSON report', () => {
  it('resolves every cited evidence id into a self-contained index', async () => {
    const r = await report('duplicate-invoice');
    expect(r.schemaVersion).toBe(2);
    expect(r.gate).toEqual({
      failOn: 'fail',
      failingVerdicts: ['FAIL'],
      failed: [{ ruleId: 'invoice-created-once', correlationValue: '"ord_1001"', verdict: 'FAIL' }],
    });
    expect(r.exitCode).toBe(1);
    expect(r.evidence.map((e) => e.id)).toEqual(['evt-inv-5001-created', 'evt-inv-5002-created']);
    expect(r.evidence[0]).toMatchObject({
      kind: 'event',
      type: 'invoice.created',
      source: 'invoicing',
      occurredAt: '2026-01-15T10:00:05.000Z',
      deliveries: 1,
    });
    const cited = new Set(
      r.verdicts.flatMap((v) => v.reasons.flatMap((reason) => reason.evidenceIds)),
    );
    expect(new Set(r.evidence.map((e) => e.id))).toEqual(cited);
  });

  it('resolves source attestation references and counts redeliveries', async () => {
    const r = await report('duplicate-delivery');
    const source = r.evidence.find((e) => e.kind === 'source');
    expect(source).toMatchObject({
      id: 'source:invoicing@2026-01-15T10:03:00.000Z',
      source: 'invoicing',
      status: 'available',
      authoritative: true,
      completeThrough: '2026-01-15T10:03:00.000Z',
    });
    expect(r.evidence.find((e) => e.id === 'evt-inv-5001-created')?.deliveries).toBe(2);
  });
});

describe('JUnit report', () => {
  it('maps gated verdicts to <failure> and other non-PASS verdicts to <skipped>', async () => {
    const fail = renderJunit(await report('duplicate-invoice'));
    expect(fail).toMatch(
      /^<\?xml version="1.0" encoding="UTF-8"\?>\n<testsuites name="bte" tests="1" failures="1" errors="0" skipped="0"/,
    );
    expect(fail).toContain(
      '<testsuite name="invoice-created-once@v1" tests="1" failures="1" errors="0" skipped="0"',
    );
    expect(fail).toContain(
      '<testcase name="orderId=&quot;ord_1001&quot;" classname="invoice-created-once"',
    );
    expect(fail).toContain('<failure message="FAIL: DUPLICATE_OUTCOME" type="FAIL">');
    expect(fail).toContain(
      '<property name="bte.evidence" value="evt-inv-5001-created,evt-inv-5002-created"/>',
    );
    expect(fail).toContain('<property name="bte.failOn" value="fail"/>');

    const unknownNotGated = renderJunit(await report('unavailable-source'));
    expect(unknownNotGated).toContain('failures="0" errors="0" skipped="1"');
    expect(unknownNotGated).toContain('<skipped message="UNKNOWN: SOURCE_UNAVAILABLE"/>');

    const unknownGated = renderJunit(await report('unavailable-source', 'unknown'));
    expect(unknownGated).toContain('failures="1" errors="0" skipped="0"');
    expect(unknownGated).toContain(
      '<failure message="UNKNOWN: SOURCE_UNAVAILABLE" type="UNKNOWN">',
    );

    const pass = renderJunit(await report('normal'));
    expect(pass).toContain('failures="0" errors="0" skipped="0"');
    expect(pass).not.toContain('<failure');
    expect(pass).not.toContain('<skipped');
    expect(pass).toContain('<property name="bte.verdict" value="PASS"/>');
  });

  it('escapes XML special characters everywhere', async () => {
    const xml = renderJunit(await report('wrong-amount'));
    expect(xml).not.toMatch(/[^&]"amount"/);
    expect(xml).toContain('&quot;amount&quot; is 4.99, expected equals 49.99');
    expect(xml).not.toContain('<<');
    // No raw ampersands outside entities.
    expect(xml.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toContain('&');
  });

  it('groups several correlations under one rule suite', async () => {
    const xml = renderJunit(await report('mixed-orders'));
    expect(xml).toContain('<testsuites name="bte" tests="2" failures="1" errors="0" skipped="0"');
    expect(xml).toContain('<testcase name="orderId=&quot;ord_1001&quot;"');
    expect(xml).toContain('<testcase name="orderId=&quot;ord_2002&quot;"');
    expect((xml.match(/<testsuite /g) ?? []).length).toBe(1);
  });
});

describe('Markdown report', () => {
  it('renders a summary table, a verdict table with evidence ids, and a cited-evidence section', async () => {
    const md = renderMarkdown(await report('wrong-amount'));
    expect(md).toContain('## Business Truth Engine: gate failed');
    expect(md).toContain('| ❌ FAIL | 1 |');
    expect(md).toContain('`invoice-created-once@v1`');
    expect(md).toContain('`ASSERTION_MISMATCH`');
    expect(md).toContain('`evt-inv-5001-created`');
    expect(md).toContain('<details><summary>Cited evidence</summary>');
    expect(md).toContain('| `evt-order-1001-paid` | event order.paid | orders |');
  });

  it('says so when nothing was evaluated, and JUnit carries zero tests', async () => {
    const r = await report('no-trigger');
    expect(r.verdicts).toEqual([]);
    expect(r.exitCode).toBe(0);
    expect(renderMarkdown(r)).toContain('_No trigger events found; nothing was evaluated._');
    expect(renderJunit(r)).toContain(
      '<testsuites name="bte" tests="0" failures="0" errors="0" skipped="0"',
    );
  });
});
