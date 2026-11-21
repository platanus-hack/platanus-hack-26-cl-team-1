/** Shared types of the statement compiler (flow signals, compiled statements, env). */
import { digitalAsPwm } from '../codegen/shared';
import type { CompileEnv } from './compileExpr';

/** Loop-control signals (unique symbols: never confused with host return values). */
export const NORMAL: unique symbol = Symbol('normal');
export const BREAK: unique symbol = Symbol('break');
export const CONTINUE: unique symbol = Symbol('continue');
export type Flow = typeof NORMAL | typeof BREAK | typeof CONTINUE;

export type Gen = Generator<number, Flow, void>;

export interface CStmt {
  id?: string;
  /** Plain statement (costs one tick, never suspends). Returns BREAK/CONTINUE for loop control. */
  sync?: () => unknown;
  /** Suspending statement (handles its own time cost). */
  gen?: () => Gen;
}

export interface StmtEnv extends CompileEnv {
  /** Function bodies, filled after every function is compiled (calls resolve lazily). */
  functions: Map<string, CStmt[]>;
  /** Part ids with an attached servo (implicit setup). */
  servos: Set<string>;
  /** Pins written with PWM somewhere in the program (see codegen digitalAsPwm). */
  pwmPins: Set<string>;
}

/** digitalWrite, or analogWrite 0/255 on ESP32 pins that also use PWM (mirrors codegen). */
export function digitalOut(env: StmtEnv, pin: string, on: boolean): void {
  if (digitalAsPwm(env.rt.board, pin, env.pwmPins)) env.rt.writePwm(pin, on ? 255 : 0);
  else env.rt.host.digitalWrite(pin, on ? 1 : 0);
}

export const noop = (): CStmt => ({ sync: () => NORMAL });
