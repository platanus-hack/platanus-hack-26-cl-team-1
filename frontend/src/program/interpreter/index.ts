/**
 * WORKSTREAM B — Block IR interpreter.
 * Runs the program in virtual time against an InterpreterHost (implemented by
 * sim/runtime.ts, which talks to the circuit solver). The IR is compiled into
 * closures + generators (machine.ts) that suspend on delay() and resume later.
 * Semantics mirror the generated C exactly (program/codegen/shared.ts):
 * doubles, real division, implicit setup, sensor formulas, cvPrint formatting,
 * Arduino's analogWrite threshold on non-PWM pins and timer conflicts.
 */
import type { Id, ProgramIR } from '@/contracts';
import type { ProgramContext } from '../context';
import { Machine } from './machine';

export interface InterpreterHost {
  pinMode(pin: string, mode: 'OUTPUT' | 'INPUT' | 'INPUT_PULLUP'): void;
  digitalWrite(pin: string, level: 0 | 1): void;
  /** 0..255 */
  analogWrite(pin: string, value: number): void;
  tone(pin: string, freq: number): void;
  noTone(pin: string): void;
  servoWrite(part: Id, angle: number): void;
  onboardRgb(r: number, g: number, b: number): void;
  serial(text: string): void;
  digitalRead(pin: string): 0 | 1;
  analogRead(pin: string): number;
  /** Called before executing each statement that has a block id. */
  onBlock?(blockId: string): void;
}

/**
 * RUN PROTOCOL
 *  - 'waiting': blocked in delay/waitUntil until nextWakeMs (> untilMs).
 *  - 'yield'  : op budget (~20k statements) used up before reaching untilMs — call again.
 *  - 'done'   : only for an empty program (nothing to run).
 *  - 'error'  : runtime error (Spanish message); stop.
 * Each statement costs 0.01 ms virtual time; each loop() pass ≥ 0.1 ms.
 * tone(pin, f, ms): the interpreter calls host.tone(pin, f) and itself calls
 * host.noTone(pin) after ms of VIRTUAL time.
 * HOST DUTY: before answering digitalRead/analogRead the host re-solves the
 * circuit if any drive or runtime prop changed since the last solve.
 * Bindings/IR are snapshotted at creation; the runtime restarts the
 * interpreter when the program or the wiring changes.
 */
export interface RunResult {
  status: 'waiting' | 'yield' | 'done' | 'error';
  /** Sim time (ms) at which the program wants to continue. */
  nextWakeMs?: number;
  error?: string;
}

export interface Interpreter {
  /** Virtual time in ms (millis()). */
  readonly timeMs: number;
  /** Execute until virtual time reaches `untilMs` (delays advance time). Never blocks the UI: yields after ~20k statements. */
  runUntil(untilMs: number): RunResult;
  reset(): void;
}

/**
 * Build an interpreter for `ir` (snapshotted with ctx.bindings). Random numbers
 * come from a fixed-seed PRNG, so two runs with the same inputs are identical.
 */
export function createInterpreter(ir: ProgramIR, ctx: ProgramContext, host: InterpreterHost): Interpreter {
  return new Machine(ir, ctx, host);
}

export { OP_BUDGET, TICKS_PER_MS } from './runtime';
