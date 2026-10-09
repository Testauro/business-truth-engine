/**
 * Clock abstraction. The evaluator never reads the wall clock directly; a
 * clock is injected so every evaluation is reproducible.
 */
export interface Clock {
  /** Current instant as epoch milliseconds. */
  now(): number;
}

/** A clock frozen at a single instant. Used by tests and CLI `--now`. */
export class FixedClock implements Clock {
  readonly #now: number;

  constructor(instant: number | string | Date) {
    this.#now = toEpochMillis(instant);
  }

  now(): number {
    return this.#now;
  }
}

/** The wall clock. Only adapters (CLI, Playwright) should construct this. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export function toEpochMillis(instant: number | string | Date): number {
  if (typeof instant === 'number') {
    if (!Number.isFinite(instant)) throw new TypeError(`Invalid epoch millis: ${String(instant)}`);
    return instant;
  }
  const ms = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (Number.isNaN(ms)) throw new TypeError(`Invalid timestamp: ${String(instant)}`);
  return ms;
}

export function toIso(epochMillis: number): string {
  return new Date(epochMillis).toISOString();
}
