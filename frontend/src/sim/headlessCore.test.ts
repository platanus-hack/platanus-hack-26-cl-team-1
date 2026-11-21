import { describe, expect, it } from 'vitest';
import type { CircuitInputs, CircuitResult, ElectricalModelName, PartSimState, ProjectModel } from '@/contracts';
import type { Interpreter, InterpreterHost, RunResult } from '@/program/interpreter';
import { runHeadlessCore, type HeadlessDeps } from './headlessCore';

const project = { version: 1, id: 'p', name: 'test', parts: [], wires: [], program: { workspace: null }, meta: { createdAt: '', updatedAt: '' } } as ProjectModel;

function result(parts: Record<string, PartSimState>, boardPins: CircuitResult['boardPins'] = {}): CircuitResult {
  return {
    project, converged: true, iterations: 1, netVoltages: {}, pinVoltages: {}, wireCurrents: {}, pinCurrents: {},
    parts, supplies: [], boardPins, shorts: [], boardPart: null,
  };
}

/** Fake solver: led1 lit by D13 (duty-scaled); D2 reads LOW while btn1 is pressed (pull-up button). */
function fakeSolve(inputs: CircuitInputs): CircuitResult {
  const d = inputs.drives.D13;
  const on = d?.mode === 'output' && d.level === 1;
  const pressed = inputs.runtime.btn1?.pressed === true;
  return result(
    { led1: { currentA: on ? 0.015 : 0, voltage: on ? 2 : 0, brightness: on ? (d?.duty ?? 1) : 0, burned: inputs.burned.includes('led1') } },
    { D2: { volts: pressed ? 0 : 5, currentA: 0, digital: pressed ? 0 : 1 } },
  );
}

/** Fake interpreter: each step runs at `period` intervals. */
function fakeInterpreter(host: InterpreterHost, period: number, step: (h: InterpreterHost, n: number, t: number) => void): Interpreter {
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
        step(host, n++, t);
        next += period;
      }
      t = until;
      return { status: 'waiting', nextWakeMs: next };
    },
    reset() {
      t = 0;
      next = 0;
      n = 0;
    },
  };
}

const models: Record<string, ElectricalModelName> = { led1: 'led' };
const baseDeps = (over: Partial<HeadlessDeps> = {}): HeadlessDeps => ({
  solve: fakeSolve,
  board: null,
  createInterpreter: null,
  checks: () => [],
  modelOf: (id) => models[id],
  ...over,
});

describe('runHeadlessCore', () => {
  it('records a blink at the exact program times and serial lines', async () => {
    const tl = await runHeadlessCore(project, 2000, [], baseDeps({
      createInterpreter: (host) =>
        fakeInterpreter(host, 500, (h, n, t) => {
          h.digitalWrite('D13', n % 2 === 0 ? 1 : 0);
          h.serial(`t=${t}`);
          h.serial('\n');
        }),
    }));
    expect(tl.error).toBeUndefined();
    expect(tl.durationMs).toBe(2000);
    expect(tl.changes.map((c) => [c.t, c.state.brightness])).toEqual([
      [0, 1],
      [500, 0],
      [1000, 1],
      [1500, 0],
      [2000, 1],
    ]);
    expect(tl.serial.map((s) => s.text)).toEqual(['t=0', 't=500', 't=1000', 't=1500', 't=2000']);
  });

  it('applies input events at their time and the program reads them through the host', async () => {
    const tl = await runHeadlessCore(project, 1000, [
      { atMs: 300, part: 'btn1', prop: 'pressed', value: true },
      { atMs: 600, part: 'btn1', prop: 'pressed', value: false },
    ], baseDeps({
      createInterpreter: (host) =>
        fakeInterpreter(host, 10, (h) => {
          h.digitalWrite('D13', h.digitalRead('D2') === 0 ? 1 : 0);
        }),
    }));
    const on = tl.changes.filter((c) => c.part === 'led1').map((c) => [c.t, c.state.brightness]);
    expect(on).toEqual([
      [0, 0],
      [300, 1],
      [600, 0],
    ]);
  });

  it('burns an overloaded LED after > 300 ms of virtual time', async () => {
    const solve = (inp: CircuitInputs): CircuitResult => {
      const burned = inp.burned.includes('led1');
      return result({ led1: { currentA: burned ? 0 : 0.08, voltage: 2, brightness: burned ? 0 : 1, overloaded: !burned, burned } });
    };
    const tl = await runHeadlessCore(project, 1000, [], baseDeps({ solve }));
    const burnedAt = tl.changes.find((c) => c.state.burned);
    expect(burnedAt).toBeDefined();
    expect(burnedAt!.t).toBeGreaterThan(300);
    expect(burnedAt!.t).toBeLessThanOrEqual(320);
  });

  it('jumps over idle time quickly (20 s of virtual time)', async () => {
    let solves = 0;
    const t0 = Date.now();
    const tl = await runHeadlessCore(project, 20000, [], baseDeps({
      solve: (i) => {
        solves++;
        return fakeSolve(i);
      },
      createInterpreter: (host) => fakeInterpreter(host, 1000, (h, n) => h.analogWrite('D13', n % 2 ? 0 : 128)),
    }));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(tl.changes.length).toBe(21);
    expect(tl.changes[1].state.brightness).toBe(0);
    expect(tl.changes[2].state.brightness).toBe(0.5);
    expect(solves).toBeLessThan(100);
  });

  it('reports program errors and keeps the electrical sim going', async () => {
    const tl = await runHeadlessCore(project, 500, [], baseDeps({
      createInterpreter: () => ({ timeMs: 0, runUntil: () => ({ status: 'error', error: 'variable no definida' }), reset() {} }),
    }));
    expect(tl.error).toMatch(/variable no definida/);
    expect(tl.durationMs).toBe(500);
  });

  it('never throws when the solver throws', async () => {
    const tl = await runHeadlessCore(project, 500, [], baseDeps({
      solve: () => {
        throw new Error('matriz singular');
      },
    }));
    expect(tl.error).toBe('matriz singular');
    expect(tl.changes).toEqual([]);
  });

  it('returns check issues computed from the last result', async () => {
    const tl = await runHeadlessCore(project, 100, [], baseDeps({
      checks: (r) => (r ? [{ id: 'x', code: 'no-board', severity: 'error', title: 'Sin placa', message: '', parts: [] }] : []),
    }));
    expect(tl.issues.map((i) => i.code)).toEqual(['no-board']);
  });
});
