import { describe, expect, it } from 'vitest';
import { loadConfig, parseFaultList, FaultController, FAULTS } from '../src/index.js';

describe('demo configuration', () => {
  it('applies defaults and parses every variable', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '127.0.0.1',
      faults: [],
      log: false,
      tickMs: 1000,
      clock: 'system',
      clockStart: undefined,
    });
    expect(
      loadConfig({
        BTE_DEMO_PORT: '0',
        BTE_DEMO_HOST: '0.0.0.0',
        BTE_DEMO_FAULTS: ' wrong-amount , missing-invoice ',
        BTE_DEMO_LOG: 'true',
        BTE_DEMO_TICK_MS: '250',
        BTE_DEMO_CLOCK: 'manual',
        BTE_DEMO_CLOCK_START: '2026-01-15T10:00:00.000Z',
      }),
    ).toEqual({
      port: 0,
      host: '0.0.0.0',
      faults: ['wrong-amount', 'missing-invoice'],
      log: true,
      tickMs: 250,
      clock: 'manual',
      clockStart: '2026-01-15T10:00:00.000Z',
    });
  });

  it('rejects unknown faults, bad ports and bad clock modes', () => {
    expect(() => loadConfig({ BTE_DEMO_FAULTS: 'explode' })).toThrow();
    expect(() => loadConfig({ BTE_DEMO_PORT: '70000' })).toThrow();
    expect(() => loadConfig({ BTE_DEMO_CLOCK: 'quartz' })).toThrow();
    expect(() => loadConfig({ BTE_DEMO_TICK_MS: '10' })).toThrow();
  });

  it('parseFaultList ignores blanks and FaultController lists in canonical order', () => {
    expect(parseFaultList('')).toEqual([]);
    expect(parseFaultList('duplicate-delivery,,delayed-invoice')).toEqual([
      'duplicate-delivery',
      'delayed-invoice',
    ]);
    const controller = new FaultController(['wrong-amount', 'missing-invoice']);
    expect(controller.list()).toEqual(['missing-invoice', 'wrong-amount']);
    expect(controller.isActive('wrong-amount')).toBe(true);
    controller.set([]);
    expect(controller.list()).toEqual([]);
    expect(FAULTS).toHaveLength(6);
  });
});
