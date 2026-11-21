/**
 * Live simulation controller (singleton behind simRuntime).
 *  - Electrical solve is always live: any change of the project or of the sim
 *    inputs schedules ONE solve on the next animation frame (coalesced).
 *  - The block program runs in virtual time on requestAnimationFrame and talks
 *    to the solver through the DriveBank host.
 *  - LED burnout (real time), short toasts, buzzer audio.
 */
import type { BoardProfile, CircuitResult, ElectricalModelName, Id, PinDrive, ProgramIR, ProjectModel, PropValue } from '@/contracts';
import { solveCircuit } from '@/circuit';
import { canonicalBoardPin, findPartDef, projectBoard } from '@/catalog';
import { getProgramIR } from '@/program/blocks';
import { createInterpreter, type Interpreter, type RunResult } from '@/program/interpreter';
import { programContext, type ProgramContext } from '@/program/context';
import { getNetlist } from '@/store/derived';
import { useProject } from '@/store/project';
import { useSim, type SimState } from '@/store/sim';
import { useUI } from '@/store/ui';
import { audioUnlocked, silenceAudio, syncAudio, unlockAudio, wantedTones } from './audio';
import { nowMs, requestFrame } from './clock';
import { DriveBank, type RgbTriple } from './drives';
import { BurnoutTracker, ShortTracker } from './health';
import { isEmptyProgram } from './headless';
import { createDriveHost } from './host';
import { MSG, errorText } from './messages';
import { SerialBuffer } from './serial';

type SimPatch = Parameters<SimState['patch']>[0];

interface SolveInputs {
  project: ProjectModel;
  drives: Record<string, PinDrive>;
  runtime: Record<Id, Record<string, PropValue>>;
  burned: Id[];
  servoAngles: Record<Id, number>;
  onboardRgb: RgbTriple | null;
}

const NO_ANGLES: Record<Id, number> = Object.freeze({}) as Record<Id, number>;
const MAX_FRAME_MS = 100;
const BURNABLE: ReadonlySet<ElectricalModelName> = new Set(['led', 'rgb-led']);

const toast = (text: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info') => {
  try {
    useUI.getState().toast(text, kind);
  } catch {
    /* UI store unavailable (tests) */
  }
};

/** Part id → electrical model + label, memoized per project object. */
const partInfoCache = new WeakMap<ProjectModel, Map<Id, { model?: ElectricalModelName; label: string }>>();
function partInfo(project: ProjectModel) {
  let m = partInfoCache.get(project);
  if (!m) {
    m = new Map(project.parts.map((p) => [p.id, { model: findPartDef(p.type)?.electrical.model, label: p.label || p.id }]));
    partInfoCache.set(project, m);
  }
  return m;
}

type ProjectStoreState = ReturnType<typeof useProject.getState>;

/**
 * True when THIS dispatch applied a `project.load` (undo/redo included). Only
 * the ops it appended count: later ops merged into the same agent-turn entry
 * (group) must not look like a new load again.
 */
function loadedNewProject(s: ProjectStoreState, prev: ProjectStoreState): boolean {
  const last = s.past[s.past.length - 1];
  if (!last || prev.past.includes(last)) return false; // undo, or no history change
  const prevLast = prev.past[prev.past.length - 1];
  const merged =
    !!prevLast && s.past.length === prev.past.length && !s.past.includes(prevLast) &&
    last.ops.length > prevLast.ops.length && last.ops[0] === prevLast.ops[0];
  const added = merged ? last.ops.slice(prevLast.ops.length) : last.ops;
  return added.some((o) => o.op === 'project.load');
}

/** Changes only when parts are added/removed/retyped or wires change (not on moves). */
function structureSignature(p: ProjectModel): string {
  return `${p.parts.map((x) => `${x.id}:${x.type}`).join(',')}|${p.wires.map((w) => `${w.id}:${w.from}>${w.to}`).join(',')}`;
}

/**
 * Restart key: the IR, the board and ONLY the bindings of parts the program
 * references — adding or rewiring an unrelated part must not restart it.
 */
const programKey = (ir: ProgramIR, ctx: ProgramContext) => {
  const irJson = JSON.stringify(ir);
  const used = new Set<string>();
  for (const m of irJson.matchAll(/"part":"([^"]+)"/g)) used.add(m[1]);
  const bindings = ctx.bindings.filter((b) => used.has(b.part));
  return JSON.stringify([irJson, bindings, ctx.board?.id ?? null]);
};

class LiveSim {
  private initialized = false;
  private cancelFrame: (() => void) | null = null;
  private lastFrameAt = 0;

  // program
  private interp: Interpreter | null = null;
  private key = '';
  private keyProject: ProjectModel | null = null;
  private simTime = 0;
  private bank = new DriveBank();
  private serial = new SerialBuffer(500);
  private publishedSerial = 0;
  private activeBlock: string | null = null;
  private lastUpdateToast = 0;

  // solve
  private solved: SolveInputs | null = null;
  private result: CircuitResult | null = null;
  private resultDirty = false;
  private solverError: string | null = null;

  // health
  private burn = new BurnoutTracker();
  private shorts = new ShortTracker();
  private structure = '';

  get servoAngles(): Record<Id, number> {
    return this.interp ? this.bank.servoAngles : NO_ANGLES;
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.structure = structureSignature(useProject.getState().project);
    useProject.subscribe((s, prev) => {
      if (s.project !== prev.project) this.onProjectChange(prev.project, s.project, loadedNewProject(s, prev));
    });
    useSim.subscribe((s, prev) => this.onSimChange(s, prev));
    if (typeof window !== 'undefined') {
      const unlock = () => {
        unlockAudio();
        if (audioUnlocked()) {
          window.removeEventListener('pointerdown', unlock, true);
          window.removeEventListener('keydown', unlock, true);
        }
      };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    }
    this.schedule();
  }

  /* ----------------------------------------------------------------------- */
  /* Store reactions                                                         */
  /* ----------------------------------------------------------------------- */

  private onProjectChange(prev: ProjectModel, next: ProjectModel, loaded: boolean): void {
    // A whole new project: a different id, or a load that kept the id
    // (re-importing the same file / example JSON to start over).
    if (next.id !== prev.id || loaded) {
      this.structure = structureSignature(next);
      this.reset();
      return;
    }
    const sig = structureSignature(next);
    if (sig !== this.structure) {
      this.structure = sig;
      this.burn.reset();
      const ids = new Set(next.parts.map((p) => p.id));
      const burned = useSim.getState().burned;
      if (burned.some((id) => !ids.has(id))) useSim.getState().patch({ burned: burned.filter((id) => ids.has(id)) });
    }
    this.schedule();
  }

  private onSimChange(s: SimState, prev: SimState): void {
    if (s.serial !== prev.serial && s.serial.length === 0 && this.serial.length > 0) {
      // cleared from the UI
      this.serial.clear();
      this.publishedSerial = this.serial.version;
    }
    if (s.live !== prev.live) {
      this.burn.reset();
      this.shorts.reset();
      if (s.live) this.resultDirty = true;
    }
    if (
      s.live !== prev.live || s.runtime !== prev.runtime || s.burned !== prev.burned || s.drives !== prev.drives ||
      s.onboardRgb !== prev.onboardRgb || s.program !== prev.program
    ) {
      this.schedule();
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Frame loop                                                              */
  /* ----------------------------------------------------------------------- */

  private schedule(): void {
    if (this.cancelFrame) return;
    this.cancelFrame = requestFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.cancelFrame = null;
    const dt = this.lastFrameAt > 0 ? Math.min(MAX_FRAME_MS, Math.max(0, now - this.lastFrameAt)) : 16;
    this.lastFrameAt = now;
    try {
      this.tick(dt);
    } catch (e) {
      this.fail(e);
    }
    const ticking = (useSim.getState().program === 'running' && this.interp !== null) || this.burn.active;
    if (ticking) this.schedule();
    else this.lastFrameAt = 0;
  };

  private tick(dt: number): void {
    const s = useSim.getState();
    if (s.program === 'running' && this.interp) this.stepProgram(dt * (s.speed > 0 ? s.speed : 1));
    this.publishProgram();

    const sim = useSim.getState();
    if (!sim.live) {
      if (sim.result) sim.patch({ result: null });
      this.resultDirty = false;
      silenceAudio();
      return;
    }
    const project = useProject.getState().project;
    if (this.needsSolve(project)) this.solveNow(project);
    if (this.resultDirty) {
      this.resultDirty = false;
      useSim.getState().patch({ result: this.result });
    }
    const r = this.result && this.result.project === project ? this.result : null;
    if (r) this.trackHealth(project, r, dt);
    // No valid solve (solver error): nothing can be overloaded right now. Keeping
    // the timers would also keep the frame loop alive forever (burn.active).
    else this.burn.reset();
    syncAudio(useSim.getState().program === 'paused' ? new Map() : wantedTones(r));
  }

  private fail(e: unknown): void {
    console.error('[sim]', e);
    this.burn.reset();
    if (this.interp) this.stopProgram();
    useSim.getState().patch({ error: MSG.solverError(errorText(e)) });
  }

  /* ----------------------------------------------------------------------- */
  /* Electrical solve                                                        */
  /* ----------------------------------------------------------------------- */

  private currentInputs(): Omit<SolveInputs, 'project'> {
    const s = useSim.getState();
    const active = this.interp !== null;
    return {
      drives: active ? this.bank.drives : s.drives,
      runtime: s.runtime,
      burned: s.burned,
      servoAngles: active ? this.bank.servoAngles : NO_ANGLES,
      onboardRgb: active ? this.bank.onboardRgb : s.onboardRgb,
    };
  }

  private needsSolve(project: ProjectModel): boolean {
    const p = this.solved;
    if (!p || p.project !== project) return true;
    const i = this.currentInputs();
    return p.drives !== i.drives || p.runtime !== i.runtime || p.burned !== i.burned || p.servoAngles !== i.servoAngles || p.onboardRgb !== i.onboardRgb;
  }

  private solveNow(project: ProjectModel): CircuitResult | null {
    const inputs = this.currentInputs();
    this.solved = { project, ...inputs };
    try {
      this.result = solveCircuit(project, getNetlist(project), { ...inputs });
      if (this.solverError) {
        if (useSim.getState().error === this.solverError) useSim.getState().patch({ error: null });
        this.solverError = null;
      }
    } catch (e) {
      this.result = null;
      const msg = MSG.solverError(errorText(e));
      if (msg !== this.solverError) {
        console.error('[sim] solve failed', e);
        this.solverError = msg;
        useSim.getState().patch({ error: msg });
      }
    }
    this.resultDirty = true;
    return this.result;
  }

  /** Solve that reflects the current drives (host reads). */
  private freshResult(): CircuitResult | null {
    const project = useProject.getState().project;
    return this.needsSolve(project) ? this.solveNow(project) : this.result;
  }

  private trackHealth(project: ProjectModel, r: CircuitResult, dt: number): void {
    const s = useSim.getState();
    const info = partInfo(project);
    const burnedSet = new Set(s.burned);
    const newly = this.burn.update(r.parts, dt, (id) => {
      const m = info.get(id)?.model;
      return !!m && BURNABLE.has(m) && !burnedSet.has(id);
    });
    if (newly.length) {
      s.patch({ burned: [...s.burned, ...newly] });
      const labels = newly.map((id) => info.get(id)?.label ?? id);
      toast(labels.length === 1 ? MSG.burned(labels[0]) : MSG.burnedMany(labels), 'error');
    }
    for (const sh of this.shorts.update(r.shorts ?? [], nowMs())) toast(MSG.short(sh), 'error');
  }

  /* ----------------------------------------------------------------------- */
  /* Program                                                                 */
  /* ----------------------------------------------------------------------- */

  private startFresh(project: ProjectModel): boolean {
    const bp = projectBoard(project);
    if (!bp) {
      this.stopProgram();
      toast(MSG.noBoard, 'warning');
      return false;
    }
    let ir: ProgramIR;
    let ctx: ProgramContext;
    try {
      ir = getProgramIR(project);
      ctx = programContext(project);
    } catch (e) {
      this.programError(errorText(e));
      return false;
    }
    if (isEmptyProgram(ir)) {
      this.stopProgram();
      toast(MSG.emptyProgram, 'info');
      return false;
    }
    const board: BoardProfile = bp.profile;
    this.bank.reset();
    this.simTime = 0;
    this.activeBlock = null;
    const host = createDriveHost(this.bank, {
      canon: (pin) => canonicalBoardPin(board, pin),
      board,
      freshResult: () => this.freshResult(),
      serial: (text) => this.serial.write(text, this.interp ? this.interp.timeMs : this.simTime),
      onBlock: (id) => {
        this.activeBlock = id;
      },
    });
    try {
      this.interp = createInterpreter(ir, ctx, host);
    } catch (e) {
      this.interp = null;
      this.programError(errorText(e));
      return false;
    }
    this.key = programKey(ir, ctx);
    this.keyProject = project;
    useSim.getState().patch({ program: 'running', error: null, timeMs: 0, activeBlockId: null, drives: this.bank.drives, onboardRgb: null });
    this.lastFrameAt = 0;
    this.schedule();
    return true;
  }

  /** True when the IR or the bindings changed since the interpreter was created. */
  private programChanged(): boolean {
    const project = useProject.getState().project;
    if (project === this.keyProject) return false;
    this.keyProject = project;
    try {
      return programKey(getProgramIR(project), programContext(project)) !== this.key;
    } catch {
      return true;
    }
  }

  private restart(): void {
    if (this.startFresh(useProject.getState().project)) {
      const now = Date.now();
      if (now - this.lastUpdateToast > 1500) toast(MSG.programUpdated, 'info');
      this.lastUpdateToast = now;
    }
  }

  private stepProgram(simDt: number): void {
    const interp = this.interp;
    if (!interp) return;
    if (this.programChanged()) {
      this.restart();
      return;
    }
    const target = this.simTime + simDt;
    let r: RunResult;
    try {
      r = interp.runUntil(target);
    } catch (e) {
      r = { status: 'error', error: errorText(e) };
    }
    if (this.interp !== interp) return;
    switch (r.status) {
      case 'waiting':
        this.simTime = target;
        break;
      case 'yield':
        this.simTime = Math.min(target, Math.max(this.simTime, interp.timeMs));
        break;
      case 'done':
        this.simTime = target;
        this.stopProgram();
        toast(MSG.programDone, 'info');
        break;
      case 'error':
        this.programError(r.error ?? 'error desconocido');
        break;
    }
  }

  private programError(msg: string): void {
    this.stopProgram();
    const text = MSG.programError(msg);
    useSim.getState().patch({ error: text });
    toast(text, 'error');
  }

  /** Publish drives / time / active block / serial (at most once per frame). */
  private publishProgram(): void {
    const s = useSim.getState();
    const p: SimPatch = {};
    if (this.interp) {
      if (s.drives !== this.bank.drives) p.drives = this.bank.drives;
      if (s.onboardRgb !== this.bank.onboardRgb) p.onboardRgb = this.bank.onboardRgb;
      if (s.servoAngles !== this.bank.servoAngles) p.servoAngles = this.bank.servoAngles;
      if (s.timeMs !== this.simTime) p.timeMs = this.simTime;
      if (s.activeBlockId !== this.activeBlock) p.activeBlockId = this.activeBlock;
    }
    if (this.serial.version !== this.publishedSerial) {
      p.serial = this.serial.snapshot();
      this.publishedSerial = this.serial.version;
    }
    if (Object.keys(p).length) s.patch(p);
  }

  /* ----------------------------------------------------------------------- */
  /* Public commands                                                         */
  /* ----------------------------------------------------------------------- */

  startProgram(): void {
    unlockAudio();
    const s = useSim.getState();
    if (s.program === 'running' && this.interp) return;
    if (s.program === 'paused' && this.interp) {
      if (this.programChanged()) {
        this.restart();
        return;
      }
      s.patch({ program: 'running' });
      this.lastFrameAt = 0;
      this.schedule();
      return;
    }
    this.startFresh(useProject.getState().project);
  }

  pauseProgram(): void {
    if (useSim.getState().program !== 'running') return;
    this.publishProgram();
    useSim.getState().patch({ program: 'paused' });
    this.schedule();
  }

  stopProgram(): void {
    this.interp = null;
    this.bank.reset();
    this.simTime = 0;
    this.activeBlock = null;
    this.key = '';
    this.keyProject = null;
    const p: SimPatch = { program: 'stopped', drives: this.bank.drives, onboardRgb: null, servoAngles: {}, timeMs: 0, activeBlockId: null };
    if (this.serial.version !== this.publishedSerial) {
      p.serial = this.serial.snapshot();
      this.publishedSerial = this.serial.version;
    }
    useSim.getState().patch(p);
    this.schedule();
  }

  reset(): void {
    this.stopProgram();
    this.serial.clear();
    this.publishedSerial = this.serial.version;
    this.burn.reset();
    this.shorts.reset();
    useSim.getState().patch({ serial: [], burned: [], runtime: {}, error: null });
    this.schedule();
  }
}

export const live = new LiveSim();
