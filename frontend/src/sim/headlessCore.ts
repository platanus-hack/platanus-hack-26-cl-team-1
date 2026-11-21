/**
 * Headless simulation core (dependency-injected so it is unit-testable with
 * fake solvers/interpreters). Never touches the live stores.
 *
 * Virtual time advances in ticks of `tickMs` while something is happening
 * (program busy, overload accumulating) and jumps straight to the next
 * interesting instant otherwise (program wake-up, input event, end).
 */
import type {
  BoardProfile, CheckIssue, CircuitInputs, CircuitResult, ElectricalModelName, Id, ProjectModel, PropValue,
  SimInputEvent, SimTimeline,
} from '@/contracts';
import type { Interpreter, InterpreterHost, RunResult } from '@/program/interpreter';
import { DriveBank } from './drives';
import { BurnoutTracker } from './health';
import { createDriveHost } from './host';
import { errorText } from './messages';
import { SerialBuffer } from './serial';
import { TimelineRecorder, partSnapshot } from './timeline';

export interface HeadlessDeps {
  solve: (inputs: CircuitInputs) => CircuitResult;
  board: BoardProfile | null;
  canon?: (pin: string) => string;
  /** null when there is no board or the program is empty. */
  createInterpreter: ((host: InterpreterHost) => Interpreter) | null;
  checks: (result: CircuitResult | null) => CheckIssue[];
  modelOf: (partId: Id) => ElectricalModelName | undefined;
  tickMs?: number;
  maxChanges?: number;
  maxSerialLines?: number;
  /** Wall-clock budget before giving up with partial results. */
  wallClockMs?: number;
  now?: () => number;
}

export type HeadlessTimeline = SimTimeline & { truncated?: boolean };

const MAX_DURATION_MS = 60_000;
/** Input events are applied just BEFORE program statements scheduled at the same instant. */
const EVENT_EPS = 1e-6;
const BURNABLE: ReadonlySet<ElectricalModelName> = new Set(['led', 'rgb-led']);

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const breather = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function sanitizeEvents(inputs: SimInputEvent[] | undefined, duration: number): SimInputEvent[] {
  return (Array.isArray(inputs) ? inputs : [])
    .filter((e) => e && typeof e.part === 'string' && typeof e.prop === 'string' && Number.isFinite(e.atMs))
    .map((e) => ({ ...e, atMs: Math.max(0, e.atMs) }))
    .filter((e) => e.atMs <= duration)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.atMs - b.e.atMs || a.i - b.i)
    .map((x) => x.e);
}

export async function runHeadlessCore(
  project: ProjectModel,
  durationMs: number,
  inputs: SimInputEvent[] | undefined,
  deps: HeadlessDeps,
): Promise<HeadlessTimeline> {
  const duration = Number.isFinite(durationMs) ? Math.min(MAX_DURATION_MS, Math.max(0, Math.round(durationMs))) : 0;
  const tick = deps.tickMs ?? 5;
  const now = deps.now ?? defaultNow;
  const wallBudget = deps.wallClockMs ?? 5000;
  const started = now();
  let lastBreath = started;

  const bank = new DriveBank();
  const serial = new SerialBuffer(deps.maxSerialLines ?? 300);
  const recorder = new TimelineRecorder(deps.maxChanges ?? 300);
  const burn = new BurnoutTracker();
  const events = sanitizeEvents(inputs, duration);

  let runtime: Record<Id, Record<string, PropValue>> = {};
  let burned: Id[] = [];
  let result: CircuitResult | null = null;
  let solved: { drives: unknown; servo: unknown; rgb: unknown; runtime: unknown; burned: unknown } | null = null;
  let interp: Interpreter | null = null;
  let t = 0;
  let evIdx = 0;
  let changeAt: number | null = null;
  let error: string | undefined;

  const solve = () => {
    result = deps.solve({ drives: bank.drives, runtime, burned, servoAngles: bank.servoAngles, onboardRgb: bank.onboardRgb });
    solved = { drives: bank.drives, servo: bank.servoAngles, rgb: bank.onboardRgb, runtime, burned };
  };
  const dirty = () =>
    !solved || solved.drives !== bank.drives || solved.servo !== bank.servoAngles || solved.rgb !== bank.onboardRgb ||
    solved.runtime !== runtime || solved.burned !== burned;
  const fresh = (): CircuitResult | null => {
    if (dirty()) solve();
    return result;
  };
  const vtime = () => (interp ? interp.timeMs : t);

  const host = createDriveHost(bank, {
    canon: deps.canon,
    board: deps.board,
    freshResult: fresh,
    serial: (text) => serial.write(text, vtime()),
  });
  bank.onChange = () => {
    if (changeAt === null) changeAt = vtime();
  };

  const observe = (time: number) => {
    const r = result as CircuitResult | null;
    if (!r) return;
    for (const [id, st] of Object.entries(r.parts)) recorder.observe(time, id, partSnapshot(deps.modelOf(id), st));
  };
  const applyEvents = (upTo: number) => {
    while (evIdx < events.length && events[evIdx].atMs <= upTo) {
      const e = events[evIdx++];
      runtime = { ...runtime, [e.part]: { ...(runtime[e.part] ?? {}), [e.prop]: e.value } };
    }
  };
  const canBurn = (id: Id) => {
    const m = deps.modelOf(id);
    return !!m && BURNABLE.has(m) && !burned.includes(id);
  };
  const runInterp = (target: number): RunResult => {
    let r: RunResult = { status: 'yield' };
    for (let guard = 0; guard < 2000 && interp; guard++) {
      r = interp.runUntil(target);
      if (r.status !== 'yield') return r;
      if (interp.timeMs >= target) return r;
    }
    return r;
  };

  try {
    applyEvents(0);
    solve();
    observe(0);
    if (result) burn.update((result as CircuitResult).parts, 0, canBurn); // start overload timers at t=0
    if (deps.createInterpreter) interp = deps.createInterpreter(host);

    let status: RunResult['status'] = 'yield';
    let wake = 0;
    while (t < duration) {
      const wall = now();
      if (wall - started > wallBudget) {
        error = `La simulación se detuvo a los ${(t / 1000).toFixed(1)} s porque tardaba demasiado en calcularse.`;
        break;
      }
      if (wall - lastBreath > 30) {
        await breather();
        lastBreath = now();
      }

      let target = duration;
      if (evIdx < events.length) target = Math.min(target, events[evIdx].atMs - EVENT_EPS);
      if (burn.active) target = Math.min(target, t + tick);
      if (interp) target = Math.min(target, status === 'waiting' && wake > t + tick ? wake : t + tick);
      if (!(target > t)) target = Math.min(duration, t + tick);

      changeAt = null;
      if (interp) {
        let r: RunResult;
        try {
          r = runInterp(target);
        } catch (e) {
          r = { status: 'error', error: errorText(e) };
        }
        status = r.status;
        if (r.status === 'waiting') wake = r.nextWakeMs ?? target;
        else if (r.status === 'done') interp = null;
        else if (r.status === 'error') {
          error = `Error en el programa a los ${(vtime() / 1000).toFixed(2)} s: ${r.error ?? 'error desconocido'}`;
          interp = null;
          bank.reset();
        }
      }

      const dt = target - t;
      t = target;
      applyEvents(t + EVENT_EPS);
      if (dirty()) solve();
      observe(changeAt ?? t);

      const r = result as CircuitResult | null;
      if (r) {
        const newly = burn.update(r.parts, dt, canBurn);
        if (newly.length) {
          burned = [...burned, ...newly];
          solve();
          observe(t);
        }
      }
    }
  } catch (e) {
    error = error ?? errorText(e);
  }

  let issues: CheckIssue[] = [];
  try {
    issues = deps.checks(result);
  } catch {
    /* checks must never break the timeline */
  }

  const timeline: HeadlessTimeline = {
    durationMs: Math.min(duration, Math.round(t)),
    changes: recorder.finish(),
    serial: serial.snapshot().map((l) => ({ t: Math.round(l.t), text: l.text })),
    issues,
  };
  if (error) timeline.error = error;
  if (recorder.truncated) timeline.truncated = true;
  return timeline;
}
