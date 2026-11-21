/**
 * The interpreter state machine: implicit setup → setup() once → loop()
 * forever, driven in virtual time by runUntil().
 */
import type { ProgramIR } from '@/contracts';
import type { ProgramContext } from '../context';
import { collectVariables, planSetup, pwmPins, resolveBoard, type SetupPlan } from '../codegen/shared';
import { isEmptyProgram } from '../codegen/walk';
import type { Slot } from './compileExpr';
import { compileBlock, runBlock } from './compileStmt';
import type { CStmt, StmtEnv } from './env';
import type { Interpreter, InterpreterHost, RunResult } from './index';
import { InterpError, LOOP_MIN_TICKS, OP_BUDGET, PAUSE, Runtime, TICKS_PER_MS } from './runtime';

/** Servo.attach() starts sending the default 1500 µs pulse (90°). */
const SERVO_ATTACH_ANGLE = 90;

interface Booted {
  rt: Runtime;
  main: Generator<number, void, void>;
}

export class Machine implements Interpreter {
  private readonly empty: boolean;
  private readonly plan: SetupPlan;
  private booted!: Booted;
  private pendingWake: number | null = null;
  private error: string | null = null;

  constructor(
    private readonly ir: ProgramIR,
    private readonly ctx: ProgramContext,
    private readonly host: InterpreterHost,
  ) {
    this.empty = isEmptyProgram(ir);
    this.plan = planSetup(ir, ctx, resolveBoard(ir, ctx));
    this.reset();
  }

  get timeMs(): number {
    return this.booted.rt.ticks / TICKS_PER_MS;
  }

  reset(): void {
    this.pendingWake = null;
    this.error = null;
    try {
      this.booted = this.boot();
    } catch (e) {
      this.booted = { rt: new Runtime(this.host, this.plan.board), main: (function* () {})() };
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private boot(): Booted {
    const rt = new Runtime(this.host, this.plan.board);
    const slots = new Map<string, Slot>();
    for (const v of collectVariables(this.ir)) slots.set(v.name, { type: v.type, v: v.init });
    const env: StmtEnv = {
      rt,
      ctx: this.ctx,
      slots,
      functions: new Map(),
      servos: new Set(this.plan.servos.map((s) => s.part)),
      pwmPins: pwmPins(this.ir, this.ctx, this.plan.board),
    };
    for (const f of this.ir.functions ?? []) {
      if (f && typeof f.name === 'string' && !env.functions.has(f.name)) env.functions.set(f.name, compileBlock(env, f.body, false));
    }
    const setup = compileBlock(env, this.ir.setup, false);
    const loop = compileBlock(env, this.ir.loop, false);
    return { rt, main: this.mainLoop(rt, setup, loop) };
  }

  private *mainLoop(rt: Runtime, setup: CStmt[], loop: CStmt[]): Generator<number, void, void> {
    this.implicitSetup(rt);
    yield* runBlock(rt, setup);
    for (;;) {
      while (rt.mustPause) yield PAUSE;
      rt.ops++;
      const start = rt.ticks;
      yield* runBlock(rt, loop);
      if (rt.ticks - start < LOOP_MIN_TICKS) rt.ticks = start + LOOP_MIN_TICKS;
    }
  }

  /** Same order as the generated setup(): pinMode for parts/onboard/auto, then servo.attach. */
  private implicitSetup(rt: Runtime): void {
    for (const p of this.plan.pinModes) this.host.pinMode(p.boardPin, p.mode);
    for (const s of this.plan.servos) {
      this.host.pinMode(s.boardPin, 'OUTPUT');
      rt.attachPwmChannel(s.boardPin); // ESP32Servo takes a LEDC channel at attach()
      this.host.servoWrite(s.part, SERVO_ATTACH_ANGLE);
    }
    rt.servoActive = this.plan.servos.length > 0;
  }

  runUntil(untilMs: number): RunResult {
    if (this.error) return { status: 'error', error: this.error };
    const { rt, main } = this.booted;
    const until = Math.floor(Math.max(0, Number(untilMs) || 0) * TICKS_PER_MS + 1e-6);
    if (this.empty) {
      rt.ticks = Math.max(rt.ticks, until);
      return { status: 'done' };
    }
    rt.untilTicks = until;
    rt.ops = 0;
    try {
      for (;;) {
        if (this.pendingWake !== null) {
          const wake = this.pendingWake;
          rt.fireTimers(Math.min(wake, until));
          if (wake > until) {
            rt.ticks = Math.max(rt.ticks, until);
            return { status: 'waiting', nextWakeMs: Math.min(wake, rt.nextTimer()) / TICKS_PER_MS };
          }
          rt.ticks = Math.max(rt.ticks, wake);
          this.pendingWake = null;
        }
        const r = main.next();
        if (r.done) return { status: 'done' };
        if (r.value === PAUSE) {
          rt.fireTimers(rt.ticks);
          const status = rt.ops >= OP_BUDGET && rt.ticks < until ? 'yield' : 'waiting';
          return { status, nextWakeMs: rt.ticks / TICKS_PER_MS };
        }
        this.pendingWake = r.value;
      }
    } catch (e) {
      this.error = e instanceof InterpError ? e.message : `Error inesperado al ejecutar el programa: ${e instanceof Error ? e.message : String(e)}`;
      return { status: 'error', error: this.error };
    }
  }
}
