// Cessna 172 "good enough" flight model for the takeoff task (owner: Anaís). Not real aerodynamics:
// tuned so the cockpit reacts believably and the recipe's numbers hold (rotate at 55 kt, climb at
// ~75 kt with ~7° nose up). Pure: no DOM, so it is unit-tested and shared by the renderer and recorder.
//
// It also emits the ground-truth action events (ids from tasks/aviation/ontology.json) that a control
// change or a flight condition means. Those label recordings and feed the debug overlay; they are never
// sent to the server in practice mode (the supervisor must see the video, not the answer).

export const FIELD_ELEVATION_FT = 1555; // Santiago (SCEL), runway 35R
export const RUNWAY_HEADING = 350;
export const ROTATE_KT = 55;
export const LIFTOFF_KT = 53;
export const EARLY_ROTATE_KT = 50;
export const FLAP_DETENTS = [0, 10, 20, 30] as const;
export type FlapDetent = (typeof FLAP_DETENTS)[number];

/** Action ids the simulator can emit: every one must exist in tasks/aviation/c172_takeoff.json. */
export const SIM_ACTIONS = [
  'turn_master_on',
  'set_fuel_both',
  'set_mixture_rich',
  'start_engine',
  'set_flaps_takeoff',
  'set_flaps_full',
  'turn_landing_light_on',
  'release_parking_brake',
  'apply_full_throttle',
  'rotate',
  'rotate_early',
  'establish_climb',
] as const;
export type SimAction = (typeof SIM_ACTIONS)[number];

export type Magnetos = 'off' | 'both' | 'start';
export type EngineState = 'off' | 'cranking' | 'running';

/** What the pilot sets. Discrete switches change through `apply`; continuous inputs through `Inputs`. */
export type Controls = {
  master: boolean;
  fuelBoth: boolean; // false = OFF
  mixtureRich: boolean; // false = IDLE CUTOFF (pulled out)
  magnetos: Magnetos;
  flaps: FlapDetent; // lever position
  landingLight: boolean;
  parkingBrake: boolean; // true = SET (pulled out)
  throttle: number; // 0 idle … 1 full
};

/** Held keys, sampled every tick. */
export type Inputs = {
  throttleIn: boolean;
  throttleOut: boolean;
  pitchUp: boolean; // pull the yoke
  pitchDown: boolean;
  starter: boolean; // key held at START
};

export type Flight = {
  t: number; // s since start
  engine: EngineState;
  crankS: number;
  stallS: number; // s the engine has been starved (fuel off / cutoff / mags off)
  rpm: number;
  flapsDeg: number; // actual flap position, follows the lever
  airspeedKt: number;
  altitudeFt: number;
  pitchDeg: number;
  vsFpm: number;
  onGround: boolean;
  stall: boolean;
  distanceM: number;
  propDeg: number;
  climbS: number; // s spent in the climb window
  climbed: boolean; // establish_climb already emitted
};

export type Sim = { controls: Controls; flight: Flight };

export function initialSim(): Sim {
  return {
    controls: {
      master: false,
      fuelBoth: false,
      mixtureRich: false,
      magnetos: 'off',
      flaps: 0,
      landingLight: false,
      parkingBrake: true,
      throttle: 0,
    },
    flight: {
      t: 0,
      engine: 'off',
      crankS: 0,
      stallS: 0,
      rpm: 0,
      flapsDeg: 0,
      airspeedKt: 0,
      altitudeFt: FIELD_ELEVATION_FT,
      pitchDeg: 0,
      vsFpm: 0,
      onGround: true,
      stall: false,
      distanceM: 0,
      propDeg: 0,
      climbS: 0,
      climbed: false,
    },
  };
}

/** Discrete pilot commands (one key press each). */
export type Command =
  | 'toggle_master'
  | 'toggle_fuel'
  | 'toggle_mixture'
  | 'flaps_down'
  | 'flaps_up'
  | 'toggle_landing_light'
  | 'toggle_parking_brake';

/** Apply a discrete command; returns the new controls and the action it means, if any. */
export function apply(controls: Controls, command: Command): { controls: Controls; action: SimAction | null } {
  const c = { ...controls };
  let action: SimAction | null = null;
  switch (command) {
    case 'toggle_master':
      c.master = !c.master;
      if (c.master) action = 'turn_master_on';
      break;
    case 'toggle_fuel':
      c.fuelBoth = !c.fuelBoth;
      if (c.fuelBoth) action = 'set_fuel_both';
      break;
    case 'toggle_mixture':
      c.mixtureRich = !c.mixtureRich;
      if (c.mixtureRich) action = 'set_mixture_rich';
      break;
    case 'flaps_down':
    case 'flaps_up': {
      const i = FLAP_DETENTS.indexOf(c.flaps) + (command === 'flaps_down' ? 1 : -1);
      if (i < 0 || i >= FLAP_DETENTS.length) break;
      c.flaps = FLAP_DETENTS[i];
      if (c.flaps === 10 && command === 'flaps_down') action = 'set_flaps_takeoff';
      if (c.flaps === 30) action = 'set_flaps_full';
      break;
    }
    case 'toggle_landing_light':
      c.landingLight = !c.landingLight;
      if (c.landingLight) action = 'turn_landing_light_on';
      break;
    case 'toggle_parking_brake':
      c.parkingBrake = !c.parkingBrake;
      if (!c.parkingBrake) action = 'release_parking_brake';
      break;
  }
  return { controls: c, action };
}

const THROTTLE_RATE = 0.6; // full travel per s
const PITCH_RATE = 6; // °/s
const THRUST_MAX = 5.5; // kt/s at full static power
const DRAG_K = 0.000356; // kt/s per kt²: ~2 kt/s at 75 kt
const PITCH_DRAG = 0.47; // kt/s per ° of climb
const ROLLING = 0.3;
const KT_TO_FPM = 101.27;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const approach = (x: number, target: number, rate: number, dt: number) =>
  x < target ? Math.min(target, x + rate * dt) : Math.max(target, x - rate * dt);

/** Advance the simulation by `dt` seconds. Returns the new state and the events that happened. */
export function step(sim: Sim, inputs: Inputs, dt: number): { sim: Sim; events: SimAction[] } {
  const c: Controls = { ...sim.controls };
  const f: Flight = { ...sim.flight };
  const events: SimAction[] = [];
  f.t += dt;

  // Key: held = START (springs back to BOTH when released, as long as it was turned at all).
  if (inputs.starter && c.magnetos !== 'start') {
    c.magnetos = 'start';
    events.push('start_engine');
  } else if (!inputs.starter && c.magnetos === 'start') {
    c.magnetos = 'both';
  }

  // Throttle.
  const before = c.throttle;
  if (inputs.throttleIn) c.throttle = clamp(c.throttle + THROTTLE_RATE * dt, 0, 1);
  if (inputs.throttleOut) c.throttle = clamp(c.throttle - THROTTLE_RATE * dt, 0, 1);
  if (before < 0.95 && c.throttle >= 0.95) events.push('apply_full_throttle');

  // Engine.
  const fed = c.fuelBoth && c.mixtureRich;
  if (c.magnetos === 'start' && c.master && f.engine !== 'running') {
    f.engine = 'cranking';
    f.crankS += dt;
    if (f.crankS >= 1.0 && fed) f.engine = 'running';
  } else if (f.engine === 'cranking') {
    f.engine = 'off';
    f.crankS = 0;
  }
  if (f.engine === 'running') {
    f.stallS = !fed || c.magnetos === 'off' ? f.stallS + dt : 0;
    if (f.stallS > 0.6) {
      f.engine = 'off';
      f.crankS = 0;
      f.stallS = 0;
    }
  }
  const rpmTarget =
    f.engine === 'running' ? 900 + c.throttle * 1400 + f.airspeedKt * 3 : f.engine === 'cranking' ? 260 : 0;
  f.rpm = approach(f.rpm, rpmTarget, f.engine === 'off' ? 500 : 900, dt);
  f.propDeg = (f.propDeg + (f.rpm / 60) * 360 * dt) % 360;

  // Flaps follow the lever at ~5°/s.
  f.flapsDeg = approach(f.flapsDeg, c.flaps, 5, dt);

  // Longitudinal dynamics.
  const power = f.engine === 'running' ? clamp((f.rpm - 900) / 1400, 0, 1.1) : 0;
  const drag = DRAG_K * f.airspeedKt ** 2 + f.flapsDeg * 0.02;
  if (f.onGround) {
    if (c.parkingBrake) {
      f.airspeedKt = approach(f.airspeedKt, 0, 8, dt);
    } else {
      const accel = THRUST_MAX * power - drag - (f.airspeedKt > 0 || power > 0.05 ? ROLLING : 0);
      f.airspeedKt = Math.max(0, f.airspeedKt + accel * dt);
    }
    // The elevator only lifts the nose with some airflow: from 25 kt, more with speed.
    const noseUpLimit = clamp((f.airspeedKt - 25) * 0.5, 0, 12);
    const pitchTarget = inputs.pitchUp ? noseUpLimit : 0;
    f.pitchDeg = approach(f.pitchDeg, pitchTarget, PITCH_RATE, dt);
    const early = f.pitchDeg >= 4 && f.airspeedKt < EARLY_ROTATE_KT;
    if (early && !sim.flight.stall) events.push('rotate_early');
    f.stall = early;
    if (f.airspeedKt >= LIFTOFF_KT && f.pitchDeg >= 5) {
      f.onGround = false;
      events.push('rotate');
    }
    f.vsFpm = 0;
  } else {
    if (inputs.pitchUp) f.pitchDeg += PITCH_RATE * dt;
    if (inputs.pitchDown) f.pitchDeg -= PITCH_RATE * dt;
    f.pitchDeg = clamp(f.pitchDeg, -10, 20);
    const accel = THRUST_MAX * power - drag - PITCH_DRAG * f.pitchDeg;
    f.airspeedKt = Math.max(0, f.airspeedKt + accel * dt);
    f.stall = f.airspeedKt < 48;
    const gammaDeg = f.pitchDeg - 2;
    const sink = f.airspeedKt < EARLY_ROTATE_KT ? (EARLY_ROTATE_KT - f.airspeedKt) * 60 : 0;
    const vsTarget = f.airspeedKt * KT_TO_FPM * Math.sin((gammaDeg * Math.PI) / 180) - sink;
    f.vsFpm = approach(f.vsFpm, vsTarget, 1500, dt);
    f.altitudeFt += (f.vsFpm / 60) * dt;
    if (f.altitudeFt <= FIELD_ELEVATION_FT) {
      f.altitudeFt = FIELD_ELEVATION_FT;
      f.onGround = true;
      f.vsFpm = 0;
      f.pitchDeg = Math.max(0, Math.min(f.pitchDeg, 5));
    }
    const inClimb = f.pitchDeg >= 5 && f.pitchDeg <= 10 && f.airspeedKt >= 68 && f.airspeedKt <= 82 && f.vsFpm > 400;
    f.climbS = inClimb ? f.climbS + dt : 0;
    if (!f.climbed && f.climbS >= 2) {
      f.climbed = true;
      events.push('establish_climb');
    }
  }
  f.distanceM += f.airspeedKt * 0.5144 * dt;

  return { sim: { controls: c, flight: f }, events };
}
