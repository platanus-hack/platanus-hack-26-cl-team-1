/**
 * Mutable runtime shared by the compiled program closures: virtual clock,
 * statement budget, host, tone timers, RNG and per-part sensor state.
 * 1 tick = 0.01 ms (the cost of one statement).
 */
import type { BoardProfile, Id } from '@/contracts';
import { constrain, pwmAvailable, toDelayMs } from '../codegen/shared';
import type { InterpreterHost } from './index';

export const TICKS_PER_MS = 100;
export const LOOP_MIN_TICKS = 10; // each loop() pass ≥ 0.1 ms
export const OP_BUDGET = 20_000; // statements per runUntil call
export const MAX_CALL_DEPTH = 64;

/** Yielded when the clock reached the target or the budget is spent. */
export const PAUSE = -1;

export class InterpError extends Error {}

/** Deterministic PRNG (mulberry32) so headless runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RANDOM_SEED = 20261121;

export class Runtime {
  ticks = 0;
  untilTicks = 0;
  ops = 0;
  depth = 0;
  servoActive = false;
  readonly rand: () => number = mulberry32(RANDOM_SEED);
  readonly activeTones = new Set<string>();
  /** Pin → tick at which the interpreter itself calls noTone (tone with duration). */
  readonly toneTimers = new Map<string, number>();
  readonly clicks = new Map<Id, { prev: boolean; last: number }>();
  /** Pins holding one of the board's shared PWM channels (ESP32-C6 LEDC: analogWrite, tone, servo). */
  readonly pwmChannels = new Set<string>();

  constructor(
    readonly host: InterpreterHost,
    readonly board: BoardProfile | null,
  ) {}

  get mustPause(): boolean {
    return this.ticks >= this.untilTicks || this.ops >= OP_BUDGET;
  }

  millis(): number {
    return Math.floor(this.ticks / TICKS_PER_MS);
  }

  nextTimer(): number {
    let next = Infinity;
    for (const t of this.toneTimers.values()) if (t < next) next = t;
    return next;
  }

  /** Fire every scheduled noTone due at or before `limit`. */
  fireTimers(limit: number): void {
    if (this.toneTimers.size === 0) return;
    for (const [pin, t] of [...this.toneTimers]) {
      if (t > limit) continue;
      this.toneTimers.delete(pin);
      this.releaseTone(pin);
      this.host.noTone(pin);
    }
  }

  /** The tone stopped: its timer / PWM channel is free again (ESP32 noTone → ledcDetach). */
  private releaseTone(pin: string): void {
    if (this.activeTones.delete(pin)) this.pwmChannels.delete(pin);
  }

  /**
   * Take a shared PWM channel for `pin` (BoardProfile.maxPwmChannels). Like the
   * ESP32 core's ledcAttach: false when every channel is taken ("No more LEDC
   * channels available!") — the write / tone then does nothing on the chip.
   */
  attachPwmChannel(pin: string): boolean {
    const max = this.board?.maxPwmChannels;
    if (max === undefined || this.pwmChannels.has(pin)) return true;
    if (this.pwmChannels.size >= max) return false;
    this.pwmChannels.add(pin);
    return true;
  }

  /** analogWrite semantics: PWM when available, else Arduino's threshold (v < 128 → LOW). */
  writePwm(pin: string, value: number): void {
    if (!this.attachPwmChannel(pin)) return;
    if (pwmAvailable(this.board, pin, { servo: this.servoActive, tone: this.activeTones.size > 0 })) this.host.analogWrite(pin, value);
    else this.host.digitalWrite(pin, value < 128 ? 0 : 1);
  }

  readAnalog(pin: string): number {
    const max = this.board?.adc.maxValue ?? 1023;
    const v = Math.round(constrain(Number(this.host.analogRead(pin)), 0, max));
    return Number.isNaN(v) ? 0 : v;
  }

  readDigital(pin: string): 0 | 1 {
    return this.host.digitalRead(pin) ? 1 : 0;
  }

  startTone(pin: string, freq: number, ms?: number): void {
    const hz = Math.trunc(freq);
    if (!(hz > 0)) {
      this.stopTone(pin);
      return;
    }
    const max = this.board?.maxConcurrentTones;
    // Like the AVR core: with every tone timer busy, tone() on another pin does nothing.
    if (max !== undefined && !this.activeTones.has(pin) && this.activeTones.size >= max) return;
    if (!this.activeTones.has(pin) && !this.attachPwmChannel(pin)) return;
    this.toneTimers.delete(pin);
    this.activeTones.add(pin);
    this.host.tone(pin, hz);
    if (ms !== undefined) {
      const d = toDelayMs(ms);
      if (d > 0) this.toneTimers.set(pin, this.ticks + d * TICKS_PER_MS);
    }
  }

  stopTone(pin: string): void {
    this.toneTimers.delete(pin);
    this.releaseTone(pin);
    this.host.noTone(pin);
  }
}
