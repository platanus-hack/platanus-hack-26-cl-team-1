/**
 * Live controller integration test with fake solver / IR / interpreter
 * (other modules are mocked so this test does not depend on their progress).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CircuitInputs, CircuitResult, ProgramIR, ProjectModel } from '@/contracts';
import type { InterpreterHost, RunResult } from '@/program/interpreter';

const h = vi.hoisted(() => ({
  ir: null as unknown as ProgramIR,
  overload: false,
  failAt: Infinity,
  interpreters: 0,
  throwSolve: false,
  /** Extra LEDs in the fake result (overloaded together with led1). */
  extraLeds: [] as string[],
}));

vi.mock('@/store/derived', () => ({
  getNetlist: () => ({ nets: [], pinNet: {}, insertions: [] }),
  getBindings: () => [],
}));

vi.mock('@/program/context', async () => {
  const { projectBoard } = await import('@/catalog');
  return {
    programContext: (project: ProjectModel) => {
      const b = projectBoard(project);
      return { project, board: b?.profile ?? null, boardPartId: b?.part.id ?? null, bindings: [] };
    },
  };
});

vi.mock('@/program/blocks', () => ({ getProgramIR: () => h.ir }));

vi.mock('@/circuit', () => ({
  solveCircuit: (project: ProjectModel, _n: unknown, inputs: CircuitInputs): CircuitResult => {
    if (h.throwSolve) throw new Error('matriz singular');
    const d = inputs.drives.D13;
    const on = d?.mode === 'output' && d.level === 1;
    const burned = inputs.burned.includes('led1');
    return {
      project, converged: true, iterations: 1, netVoltages: {}, pinVoltages: {}, wireCurrents: {}, pinCurrents: {},
      parts: {
        led1: { currentA: on ? 0.02 : 0, voltage: 2, brightness: on && !burned ? 1 : 0, overloaded: h.overload && !burned, burned },
        ...Object.fromEntries(
          h.extraLeds.map((id) => {
            const b = inputs.burned.includes(id);
            return [id, { currentA: 0.1, voltage: 2, overloaded: h.overload && !b, burned: b }];
          }),
        ),
      },
      supplies: [], boardPins: { D2: { volts: 5, currentA: 0, digital: inputs.runtime.btn1?.pressed ? 0 : 1 } }, shorts: [], boardPart: 'uno1',
    };
  },
}));

vi.mock('@/program/interpreter', () => ({
  /** Blink D13 every 500 ms and print the state. */
  createInterpreter: (_ir: ProgramIR, _ctx: unknown, host: InterpreterHost) => {
    h.interpreters++;
    let t = 0;
    let next = 0;
    let n = 0;
    return {
      get timeMs() {
        return t;
      },
      runUntil(until: number): RunResult {
        while (next <= until) {
          t = next;
          if (t >= h.failAt) return { status: 'error', error: 'división rara' };
          host.digitalWrite('D13', n % 2 === 0 ? 1 : 0);
          host.serial('LED: ');
          host.serial(n % 2 === 0 ? 'encendido\n' : 'apagado\n');
          n++;
          next += 500;
        }
        t = until;
        return { status: 'waiting', nextWakeMs: next };
      },
      reset() {},
    };
  },
}));

const { useProject } = await import('@/store/project');
const { useSim } = await import('@/store/sim');
const { useUI } = await import('@/store/ui');
const { createStarterProject } = await import('@/store/newProject');
const { simRuntime } = await import('./runtime');

const IR = (loop: number): ProgramIR => ({ version: 1, board: 'uno', variables: [], setup: [], loop: Array.from({ length: loop }, () => ({ k: 'delay', ms: { k: 'num', v: 500 } })), functions: [] });
const toasts = () => useUI.getState().toasts.map((t) => t.text);
const advance = (ms: number) => vi.advanceTimersByTime(ms);

function withLed(p: ProjectModel): ProjectModel {
  return { ...p, parts: [...p.parts, { id: 'led1', type: 'led', label: 'LED 1', x: 40, y: 6, rotation: 0, props: {} }] };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  h.ir = IR(1);
  useProject.getState().replaceProject(withLed(createStarterProject('uno')));
  simRuntime.init();
  simRuntime.init(); // idempotent
});

afterAll(() => {
  vi.useRealTimers();
});

describe('live sim runtime', () => {
  it('solves the circuit on the next frame after init', () => {
    advance(20);
    const r = useSim.getState().result;
    expect(r).not.toBeNull();
    expect(r!.project).toBe(useProject.getState().project);
  });

  it('runs the program in virtual time and publishes drives, clock and serial', () => {
    simRuntime.startProgram();
    expect(useSim.getState().program).toBe('running');
    advance(100);
    expect(useSim.getState().drives.D13).toEqual({ mode: 'output', level: 1 });
    advance(600);
    const s = useSim.getState();
    expect(s.timeMs).toBeGreaterThan(500);
    expect(s.drives.D13.level).toBe(0);
    expect(s.serial.map((l) => l.text)).toEqual(['LED: encendido', 'LED: apagado']);
    expect(s.result?.parts.led1.brightness).toBe(0);
  });

  it('pause freezes the clock and start resumes it', () => {
    simRuntime.pauseProgram();
    advance(50);
    const t0 = useSim.getState().timeMs;
    advance(500);
    expect(useSim.getState().timeMs).toBe(t0);
    expect(useSim.getState().program).toBe('paused');
    simRuntime.startProgram();
    advance(300);
    expect(useSim.getState().timeMs).toBeGreaterThan(t0);
  });

  it('speed multiplies virtual time', () => {
    useSim.getState().setSpeed(4);
    const t0 = useSim.getState().timeMs;
    advance(400);
    expect(useSim.getState().timeMs - t0).toBeGreaterThan(1200);
    useSim.getState().setSpeed(1);
  });

  it('restarts from t=0 when the program IR changes while running', () => {
    const before = h.interpreters;
    h.ir = IR(2);
    useProject.getState().dispatch({ op: 'program.set', workspace: { changed: true } });
    advance(40);
    expect(h.interpreters).toBe(before + 1);
    expect(useSim.getState().timeMs).toBeLessThan(100);
    expect(toasts()).toContain('Programa actualizado');
  });

  it('burns an overloaded LED after > 300 ms and toasts', () => {
    h.overload = true;
    useSim.getState().setRuntime('btn1', 'pressed', true); // any input change → re-solve
    advance(200);
    expect(useSim.getState().burned).toEqual([]);
    advance(250);
    expect(useSim.getState().burned).toEqual(['led1']);
    expect(toasts().some((t) => t.startsWith('¡El LED 1 se quemó!'))).toBe(true);
    h.overload = false;
  });

  it('stop resets drives, clock and active block but keeps serial', () => {
    simRuntime.stopProgram();
    advance(20);
    const s = useSim.getState();
    expect(s.program).toBe('stopped');
    expect(s.drives).toEqual({});
    expect(s.timeMs).toBe(0);
    expect(s.activeBlockId).toBeNull();
    expect(s.serial.length).toBeGreaterThan(0);
  });

  it('stops with an error toast when the interpreter fails', () => {
    h.failAt = 1000;
    simRuntime.startProgram();
    advance(1200);
    const s = useSim.getState();
    expect(s.program).toBe('stopped');
    expect(s.error).toMatch(/división rara/);
    expect(toasts().some((t) => t.includes('división rara'))).toBe(true);
    h.failAt = Infinity;
  });

  it('refuses to run without a board or with an empty program', () => {
    h.ir = IR(0);
    simRuntime.startProgram();
    expect(useSim.getState().program).toBe('stopped');
    expect(toasts().some((t) => t.startsWith('El programa está vacío'))).toBe(true);
    h.ir = IR(1);
  });

  it('reset clears serial, burned parts and runtime props', () => {
    simRuntime.reset();
    advance(20);
    const s = useSim.getState();
    expect(s.serial).toEqual([]);
    expect(s.burned).toEqual([]);
    expect(s.runtime).toEqual({});
    expect(s.error).toBeNull();
  });

  it('a new project id triggers reset', () => {
    simRuntime.startProgram();
    advance(100);
    expect(useSim.getState().serial.length).toBeGreaterThan(0);
    useProject.getState().dispatch({ op: 'project.load', project: createStarterProject(null) });
    advance(20);
    expect(useSim.getState().program).toBe('stopped');
    expect(useSim.getState().serial).toEqual([]);
    simRuntime.startProgram();
    expect(useSim.getState().program).toBe('stopped');
    expect(toasts().some((t) => t.startsWith('Para ejecutar un programa'))).toBe(true);
  });

  it('re-loading a project with the SAME id (re-import of a file) also resets the sim', () => {
    const p = withLed(createStarterProject('uno'));
    useProject.getState().dispatch({ op: 'project.load', project: p });
    advance(20);
    simRuntime.startProgram();
    advance(100);
    useSim.getState().patch({ burned: ['led1'] });
    useSim.getState().setRuntime('btn1', 'pressed', true);
    advance(20);
    expect(useSim.getState().serial.length).toBeGreaterThan(0);
    // Import the same file again: identical id, new object.
    useProject.getState().dispatch({ op: 'project.load', project: JSON.parse(JSON.stringify(p)) as ProjectModel }, { label: 'Importar proyecto' });
    advance(20);
    const s = useSim.getState();
    expect(s.program).toBe('stopped');
    expect(s.serial).toEqual([]);
    expect(s.burned).toEqual([]);
    expect(s.runtime).toEqual({});
  });

  it('later ops merged into the same agent turn as a load do not reset again', () => {
    const p = withLed(createStarterProject('uno'));
    useProject.getState().dispatch({ op: 'project.load', project: p }, { group: 'turn-1', source: 'agent' });
    advance(20);
    simRuntime.startProgram();
    advance(100);
    expect(useSim.getState().program).toBe('running');
    useProject.getState().dispatch({ op: 'project.rename', name: 'Otro nombre' }, { group: 'turn-1', source: 'agent' });
    advance(20);
    expect(useSim.getState().program).toBe('running');
    expect(useSim.getState().serial.length).toBeGreaterThan(0);
    simRuntime.stopProgram();
    advance(20);
  });

  it('turning live off clears the published result', () => {
    useSim.getState().setLive(false);
    advance(20);
    expect(useSim.getState().result).toBeNull();
    useSim.getState().setLive(true);
    advance(20);
    expect(useSim.getState().result).not.toBeNull();
  });

  it('a failing solve during an overload does not keep the frame loop running forever', () => {
    h.overload = true;
    useSim.getState().setRuntime('btn1', 'pressed', false); // re-solve → overload timer starts
    advance(50);
    expect(useSim.getState().burned).toEqual([]);
    h.throwSolve = true;
    useSim.getState().setRuntime('btn1', 'pressed', true); // next solve throws → no fresh result
    advance(50);
    expect(useSim.getState().error).toMatch(/matriz singular/);
    advance(5000); // toasts expire; only a live frame loop would leave a timer pending
    expect(vi.getTimerCount()).toBe(0);
    expect(useSim.getState().burned).toEqual([]);
    h.throwSolve = false;
    h.overload = false;
    useSim.getState().setRuntime('btn1', 'pressed', false);
    advance(20);
    expect(useSim.getState().error).toBeNull();
  });

  it('starting / pausing / stopping many times never leaves more than one frame loop', () => {
    advance(5000); // let pending toasts expire
    for (let i = 0; i < 40; i++) {
      simRuntime.startProgram();
      if (i % 3 === 0) simRuntime.pauseProgram();
      if (i % 5 === 0) simRuntime.startProgram();
      useSim.getState().setLive(i % 7 !== 0);
      simRuntime.stopProgram();
    }
    useSim.getState().setLive(true);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    simRuntime.startProgram();
    advance(100);
    expect(vi.getTimerCount()).toBe(1); // exactly one pending frame while running
    simRuntime.stopProgram();
    advance(100);
    expect(vi.getTimerCount()).toBe(0); // idle: no loop at all
  });

  it('LEDs that burn in the same instant produce ONE toast, not one per LED', () => {
    advance(5000);
    const extra = ['led2', 'led3', 'led4'];
    const base = withLed(createStarterProject('uno'));
    const p: ProjectModel = {
      ...base,
      parts: [...base.parts, ...extra.map((id, i) => ({ id, type: 'led', label: `LED ${i + 2}`, x: 44 + 2 * i, y: 6, rotation: 0 as const, props: {} }))],
    };
    useProject.getState().dispatch({ op: 'project.load', project: p });
    advance(20);
    h.extraLeds = extra;
    h.overload = true;
    const before = useUI.getState().toasts.length;
    useSim.getState().setRuntime('btn1', 'pressed', true);
    advance(450);
    expect([...useSim.getState().burned].sort()).toEqual(['led1', 'led2', 'led3', 'led4']);
    const burnToasts = useUI.getState().toasts.slice(before).map((t) => t.text).filter((t) => t.includes('quem'));
    expect(burnToasts).toHaveLength(1);
    expect(burnToasts[0]).toMatch(/^¡Se quemaron LED 1, LED 2, LED 3 y LED 4!/);
    h.overload = false;
    h.extraLeds = [];
  });
});
