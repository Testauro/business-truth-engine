import { z } from 'zod';
import { parseFaultList } from './faults.js';

export const EnvSchema = z.object({
  BTE_DEMO_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  BTE_DEMO_HOST: z.string().default('127.0.0.1'),
  BTE_DEMO_FAULTS: z.string().default(''),
  BTE_DEMO_LOG: z
    .string()
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  BTE_DEMO_TICK_MS: z.coerce.number().int().min(100).default(1000),
  BTE_DEMO_CLOCK: z.enum(['system', 'manual']).default('system'),
  BTE_DEMO_CLOCK_START: z.string().optional(),
});

export interface DemoConfig {
  port: number;
  host: string;
  faults: ReturnType<typeof parseFaultList>;
  log: boolean;
  tickMs: number;
  clock: 'system' | 'manual';
  clockStart: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.BTE_DEMO_PORT,
    host: parsed.BTE_DEMO_HOST,
    faults: parseFaultList(parsed.BTE_DEMO_FAULTS),
    log: parsed.BTE_DEMO_LOG,
    tickMs: parsed.BTE_DEMO_TICK_MS,
    clock: parsed.BTE_DEMO_CLOCK,
    clockStart: parsed.BTE_DEMO_CLOCK_START,
  };
}
