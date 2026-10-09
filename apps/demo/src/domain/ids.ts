/**
 * Deterministic, human-readable ids. The demo never uses randomness so that
 * scenarios replay identically and evidence files diff cleanly.
 */
export class IdSequence {
  readonly #counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.#counters.get(prefix) ?? 0) + 1;
    this.#counters.set(prefix, n);
    return `${prefix}_${String(n).padStart(4, '0')}`;
  }
}
