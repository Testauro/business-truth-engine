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

/**
 * A clock that only moves when told to. Used by integration tests and demo
 * scenarios so timelines (deadlines, delays) are controlled, not awaited.
 */
export class ManualClock implements Clock {
  #now: number;

  constructor(start: number | string | Date) {
    this.#now = toEpochMillis(start);
  }

  now(): number {
    return this.#now;
  }

  advance(millis: number): number {
    if (!Number.isFinite(millis) || millis < 0) {
      throw new TypeError(
        `ManualClock.advance expects a non-negative number, got ${String(millis)}`,
      );
    }
    this.#now += millis;
    return this.#now;
  }

  set(instant: number | string | Date): number {
    const next = toEpochMillis(instant);
    if (next < this.#now) throw new TypeError('ManualClock cannot move backwards');
    this.#now = next;
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
