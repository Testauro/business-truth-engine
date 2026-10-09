#!/usr/bin/env node
import { SystemClock } from '@bte/core';
import { loadConfig } from './config.js';
import { buildDemo } from './http/app.js';

const config = loadConfig();
const demo = buildDemo({ clock: new SystemClock(), faults: config.faults, logger: config.log });

const ticker = setInterval(() => demo.invoicing.tick(), config.tickMs);
ticker.unref();

const address = await demo.app.listen({ port: config.port, host: config.host });
process.stderr.write(
  `BTE demo shop listening on ${address} (faults: ${config.faults.length === 0 ? 'none' : config.faults.join(',')})\n`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(ticker);
    void demo.app.close().then(() => process.exit(0));
  });
}
