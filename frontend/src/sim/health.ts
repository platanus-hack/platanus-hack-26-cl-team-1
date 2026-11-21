/**
 * Burnout + short-circuit trackers (pure; time is passed in).
 * Live runtime feeds real elapsed ms; runHeadless feeds virtual ms.
 */
import type { CircuitResult, Id, PartSimState } from '@/contracts';

export const BURN_AFTER_MS = 300;

/** Accumulates continuous overload time per part; returns parts that just burned. */
export class BurnoutTracker {
  private acc = new Map<Id, number>();

  constructor(private readonly thresholdMs = BURN_AFTER_MS) {}

  /** True while at least one part is accumulating overload time (keep ticking). */
  get active(): boolean {
    return this.acc.size > 0;
  }

  /**
   * @param parts   latest solved part states
   * @param dtMs    time elapsed since the previous update
   * @param canBurn filter (LED / RGB LED that is not burned yet)
   */
  update(parts: Record<Id, PartSimState>, dtMs: number, canBurn: (id: Id) => boolean): Id[] {
    const burned: Id[] = [];
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    for (const id of [...this.acc.keys()]) {
      if (!parts[id]?.overloaded || !canBurn(id)) this.acc.delete(id);
    }
    for (const [id, st] of Object.entries(parts)) {
      if (!st.overloaded || st.burned || !canBurn(id)) continue;
      const prev = this.acc.get(id);
      if (prev === undefined) {
        this.acc.set(id, 0); // overload just started
        continue;
      }
      const next = prev + dt;
      if (next > this.thresholdMs) {
        this.acc.delete(id);
        burned.push(id);
      } else {
        this.acc.set(id, next);
      }
    }
    return burned;
  }

  reset(): void {
    this.acc.clear();
  }
}

export type ShortInfo = CircuitResult['shorts'][number];

export const shortKey = (s: ShortInfo): string => (s.parts.length ? [...s.parts].sort().join('|') : s.message);

/** Reports each distinct short once while it persists (with a re-appear cooldown). */
export class ShortTracker {
  private present = new Set<string>();
  private lastToast = new Map<string, number>();

  constructor(private readonly cooldownMs = 4000) {}

  update(shorts: ShortInfo[], nowMs: number): ShortInfo[] {
    const fresh: ShortInfo[] = [];
    const next = new Set<string>();
    for (const s of shorts) {
      const k = shortKey(s);
      if (next.has(k)) continue;
      next.add(k);
      if (this.present.has(k)) continue;
      const last = this.lastToast.get(k);
      if (last !== undefined && nowMs - last < this.cooldownMs) continue;
      this.lastToast.set(k, nowMs);
      fresh.push(s);
    }
    this.present = next;
    return fresh;
  }

  reset(): void {
    this.present.clear();
    this.lastToast.clear();
  }
}
