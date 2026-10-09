#!/usr/bin/env node
/**
 * Runs one checkout against an in-process demo with a seeded fault, advances
 * a manual clock past the invoice deadline, collects evidence, and writes it
 * as NDJSON so the standard `bte evaluate` CLI can judge it.
 *
 *   node apps/demo/dist/scenario.js --fault duplicate-invoice --out bte-report/demo-duplicate-invoice.ndjson
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ManualClock, toIso } from '@bte/core';
import { runScenario, type ScenarioResult } from './scenario-runner.js';
import { FAULTS, FaultSchema, type Fault } from './faults.js';

const { values } = parseArgs({
  options: {
    fault: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
    start: { type: 'string', default: '2026-01-15T10:00:00.000Z' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  process.stdout.write(
    `usage: scenario [--fault <name>]... [--out <file.ndjson>] [--start <iso>]\nfaults: ${FAULTS.join(', ')}\n`,
  );
  process.exit(0);
}

const faults: Fault[] = values.fault.map((name) => FaultSchema.parse(name));
const clock = new ManualClock(values.start);
const result: ScenarioResult = await runScenario({ clock, faults });

if (values.out !== undefined) {
  await mkdir(path.dirname(values.out), { recursive: true });
  const count = await result.collector.writeTo(values.out);
  process.stderr.write(`wrote ${count} evidence records to ${values.out}\n`);
}
process.stdout.write(
  `${JSON.stringify({ faults, orderId: result.orderId, paymentId: result.paymentId, total: result.total, uiConfirmed: result.uiConfirmed, evaluateAt: toIso(clock.now()) })}\n`,
);
