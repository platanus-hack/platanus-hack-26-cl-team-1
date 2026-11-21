import taskJson from '../../../../tasks/aviation/c172_takeoff.json';
import { describe, expect, it } from 'vitest';
import type { Task } from '../../contracts/task';
import { apply, type Command, initialSim, type Inputs, type Sim, SIM_ACTIONS, type SimAction, step } from './model';

const task = taskJson as unknown as Task;

const IDLE: Inputs = { throttleIn: false, throttleOut: false, pitchUp: false, pitchDown: false, starter: false };
const DT = 1 / 30;

class Pilot {
  sim: Sim = initialSim();
  events: SimAction[] = [];
  press(...commands: Command[]) {
    for (const command of commands) {
      const r = apply(this.sim.controls, command);
      this.sim = { ...this.sim, controls: r.controls };
      if (r.action) this.events.push(r.action);
    }
  }
  hold(inputs: Partial<Inputs>, seconds: number, until?: (s: Sim) => boolean) {
    for (let t = 0; t < seconds; t += DT) {
      const r = step(this.sim, { ...IDLE, ...inputs }, DT);
      this.sim = r.sim;
      this.events.push(...r.events);
      if (until?.(this.sim)) return;
    }
  }
}

function startedPilot(): Pilot {
  const p = new Pilot();
  p.press('toggle_master', 'toggle_fuel', 'toggle_mixture');
  p.hold({ starter: true }, 1.5);
  p.hold({}, 1);
  return p;
}

describe('c172 model', () => {
  it('only emits actions the task knows', () => {
    for (const action of SIM_ACTIONS) expect(task.actions).toContain(action);
  });

  it('a correct run emits every step action in recipe order', () => {
    const p = startedPilot();
    expect(p.sim.flight.engine).toBe('running');
    p.press('flaps_down', 'toggle_landing_light', 'toggle_parking_brake');
    p.hold({ throttleIn: true }, 30, (s) => s.flight.airspeedKt >= 56);
    expect(p.sim.flight.airspeedKt).toBeGreaterThanOrEqual(55);
    p.hold({ throttleIn: true, pitchUp: true }, 3, (s) => !s.flight.onGround);
    expect(p.sim.flight.onGround).toBe(false);
    // Hold ~7° nose up and let the speed settle.
    p.hold({ throttleIn: true, pitchUp: true }, 2, (s) => s.flight.pitchDeg >= 7);
    p.hold({ throttleIn: true }, 30, (s) => s.flight.climbed);
    const stepActions = task.steps.map((s) => s.action);
    expect(p.events.filter((e) => stepActions.includes(e))).toEqual(stepActions);
    expect(p.sim.flight.airspeedKt).toBeGreaterThan(68);
    expect(p.sim.flight.vsFpm).toBeGreaterThan(400);
  });

  it("the engine doesn't start without fuel", () => {
    const p = new Pilot();
    p.press('toggle_master', 'toggle_mixture');
    p.hold({ starter: true }, 3);
    expect(p.events).toContain('start_engine');
    expect(p.sim.flight.engine).toBe('cranking');
    p.hold({}, 1);
    expect(p.sim.flight.engine).toBe('off');
  });

  it("full power with the parking brake set doesn't move the plane", () => {
    const p = startedPilot();
    p.hold({ throttleIn: true }, 5);
    expect(p.events).toContain('apply_full_throttle');
    expect(p.sim.flight.rpm).toBeGreaterThan(2200);
    expect(p.sim.flight.airspeedKt).toBe(0);
  });

  it('pulling the yoke below 50 kt is an early rotation and lights STALL', () => {
    const p = startedPilot();
    p.press('toggle_parking_brake');
    p.hold({ throttleIn: true }, 30, (s) => s.flight.airspeedKt >= 42);
    p.hold({ throttleIn: true, pitchUp: true }, 1.5);
    expect(p.events).toContain('rotate_early');
    expect(p.sim.flight.stall).toBe(true);
    expect(p.sim.flight.onGround).toBe(true);
  });

  it('flaps to 30 is the flaps_full mistake', () => {
    const p = new Pilot();
    p.press('flaps_down', 'flaps_down', 'flaps_down');
    expect(p.events).toEqual(['set_flaps_takeoff', 'set_flaps_full']);
  });

  it('cutting the mixture stops a running engine', () => {
    const p = startedPilot();
    p.press('toggle_mixture');
    p.hold({}, 2);
    expect(p.sim.flight.engine).toBe('off');
  });
});
