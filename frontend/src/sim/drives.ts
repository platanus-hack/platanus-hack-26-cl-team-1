/**
 * Drive map kept by the program host (pure, no store access).
 * Semantics follow the PinDrive doc in contracts/sim.ts exactly:
 *   digitalWrite(v)  → { mode:'output', level: v }            (duty/tone cleared)
 *   analogWrite(v)   → { mode:'output', level: v>0?1:0, duty: v/255 }
 *   tone(f)          → { mode:'output', level: 1, duty: 0.5, toneHz: f }
 *   noTone()         → { mode:'output', level: 0 }
 * Every change REPLACES the affected record (copy-on-write) so callers can
 * detect changes by reference and publish the objects to the store as-is.
 */
import type { BoardProfile, CircuitResult, Id, PinDrive } from '@/contracts';

export type RgbTriple = [number, number, number];
export type PinModeArg = 'OUTPUT' | 'INPUT' | 'INPUT_PULLUP';

const EMPTY_DRIVES: Record<string, PinDrive> = Object.freeze({}) as Record<string, PinDrive>;
const EMPTY_ANGLES: Record<Id, number> = Object.freeze({}) as Record<Id, number>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: number, fallback = 0) => (Number.isFinite(v) ? v : fallback);

export function sameDrive(a: PinDrive | undefined, b: PinDrive | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.mode === b.mode && a.level === b.level && (a.duty ?? undefined) === (b.duty ?? undefined) && (a.toneHz ?? undefined) === (b.toneHz ?? undefined);
}

export class DriveBank {
  drives: Record<string, PinDrive> = EMPTY_DRIVES;
  servoAngles: Record<Id, number> = EMPTY_ANGLES;
  onboardRgb: RgbTriple | null = null;
  /** Called after every effective change (headless uses it to timestamp changes). */
  onChange: (() => void) | null = null;

  reset(): void {
    this.drives = EMPTY_DRIVES;
    this.servoAngles = EMPTY_ANGLES;
    this.onboardRgb = null;
  }

  private setDrive(pin: string, next: PinDrive): void {
    if (sameDrive(this.drives[pin], next)) return;
    this.drives = { ...this.drives, [pin]: next };
    this.onChange?.();
  }

  pinMode(pin: string, mode: PinModeArg): void {
    if (mode === 'OUTPUT') {
      const prev = this.drives[pin];
      // Re-configuring an output keeps its level/PWM/tone (Arduino does not touch PORT).
      this.setDrive(pin, prev && prev.mode === 'output' ? prev : { mode: 'output', level: 0 });
      return;
    }
    this.setDrive(pin, { mode: mode === 'INPUT_PULLUP' ? 'input_pullup' : 'input', level: 0 });
  }

  digitalWrite(pin: string, level: number): void {
    this.setDrive(pin, { mode: 'output', level: level ? 1 : 0 });
  }

  analogWrite(pin: string, value: number): void {
    const v = clamp(Math.round(finite(value)), 0, 255);
    this.setDrive(pin, { mode: 'output', level: v > 0 ? 1 : 0, duty: v / 255 });
  }

  tone(pin: string, freq: number): void {
    const f = finite(freq);
    if (f <= 0) {
      this.noTone(pin);
      return;
    }
    this.setDrive(pin, { mode: 'output', level: 1, duty: 0.5, toneHz: f });
  }

  noTone(pin: string): void {
    this.setDrive(pin, { mode: 'output', level: 0 });
  }

  servoWrite(part: Id, angle: number): void {
    const a = clamp(finite(angle, 90), 0, 180);
    if (this.servoAngles[part] === a) return;
    this.servoAngles = { ...this.servoAngles, [part]: a };
    this.onChange?.();
  }

  setOnboardRgb(r: number, g: number, b: number): void {
    const c = [r, g, b].map((x) => clamp(Math.round(finite(x)), 0, 255)) as RgbTriple;
    const next = c[0] === 0 && c[1] === 0 && c[2] === 0 ? null : c;
    const prev = this.onboardRgb;
    if (prev === next || (prev && next && prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2])) return;
    this.onboardRgb = next;
    this.onChange?.();
  }
}

/* ------------------------------------------------------------------------- */
/* Pin reads (digitalRead / analogRead)                                      */
/* ------------------------------------------------------------------------- */

/** Digital reading of a canonical board pin from a solve, with a sane fallback for unsolved pins. */
export function readDigitalPin(result: CircuitResult | null, pin: string, drive?: PinDrive): 0 | 1 {
  const st = result?.boardPins[pin];
  if (st) return st.digital ? 1 : 0;
  if (!drive) return 0;
  if (drive.mode === 'output') return drive.level;
  return drive.mode === 'input_pullup' ? 1 : 0;
}

/** Raw ADC reading (board resolution) of a canonical board pin. */
export function readAnalogPin(result: CircuitResult | null, pin: string, board: BoardProfile | null, drive?: PinDrive): number {
  const max = board?.adc.maxValue ?? 1023;
  const vref = board?.adc.vref ?? board?.logicVoltage ?? 5;
  const st = result?.boardPins[pin];
  if (st) {
    if (typeof st.adc === 'number' && Number.isFinite(st.adc)) return st.adc;
    return clamp(Math.round((finite(st.volts) / vref) * max), 0, max);
  }
  if (drive?.mode === 'input_pullup') return max;
  if (drive?.mode === 'output') return drive.level ? max : 0;
  return 0;
}
