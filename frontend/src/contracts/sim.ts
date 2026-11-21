/**
 * Simulation, checks, guide and compile result types (shared by workstreams).
 * ---------------------------------------------------------------------------
 * Data flow (one "tick"):
 *   ProjectModel ──buildNetlist──▶ Netlist ──deriveBindings──▶ Binding[]
 *   Interpreter (IR) ──writes──▶ CircuitInputs.drives (per board pin)
 *   solveCircuit(project, netlist, inputs) ──▶ CircuitResult
 *   Interpreter reads boardPins[pin].volts for digitalRead/analogRead
 *   SimRuntime updates burned parts, audio, and the sim store; views render.
 *
 * The ELECTRICAL simulation is always live (board powered by USB, batteries
 * connected). The PROGRAM only runs when the user presses ▶.
 */
import type { BoardId, Id, NetId, PinRef, ProjectModel, PropValue } from './model';

/**
 * Drive of one board pin (keys are CANONICAL board pin ids).
 *  digitalWrite(v)  → { mode:'output', level: v }            (duty cleared)
 *  analogWrite(v)   → { mode:'output', level: v>0?1:0, duty: v/255 }
 *  tone(f)          → { mode:'output', level: 1, duty: 0.5, toneHz: f }
 * OWNERSHIP OF PWM/TONE EFFECTS: solveCircuit solves every PWM/tone pin as HIGH,
 * then multiplies brightness, rgb[channel] and motor speed by the duty of the
 * part's Binding.boardPin (found with deriveBindings, including through an NPN),
 * and sets buzzer sounding/toneHz from that pin's toneHz. currentA/voltage stay
 * PEAK values (burnout uses peak current). The runtime never rescales.
 */
export interface PinDrive {
  mode: 'input' | 'input_pullup' | 'output';
  level: 0 | 1; // output level
  /** PWM duty 0..1 (analogWrite / tone). */
  duty?: number;
  /** tone() frequency on this pin, Hz. */
  toneHz?: number;
}

export interface CircuitInputs {
  /** Board pin id → drive. Missing pins are high-impedance inputs. */
  drives: Record<string, PinDrive>;
  /** Live runtime prop overrides per part (button pressed, knob position, light…). */
  runtime: Record<Id, Record<string, PropValue>>;
  /** Parts destroyed earlier in this session (open circuit). */
  burned: Id[];
  /** Servo angles commanded by the program (degrees), by part id. */
  servoAngles?: Record<Id, number>;
  /** ESP32-C6 onboard WS2812 colour commanded by the program (0..255 each). */
  onboardRgb?: [number, number, number] | null;
}

/**
 * Main terminals (sign convention of currentA/voltage, current flowing INTO the
 * first terminal and out of the second):
 *   resistor a→b · diode/led anode→cathode · rgb-led channel→com (currentA = sum)
 *   potentiometer a→b · ldr a→b · battery: currentA > 0 when DISCHARGING (+ to circuit)
 *   switch push a-group→b-group · slide com→closed throw · buzzer plus→minus
 *   motor a→b · npn c→e (base current in pinCurrents) · servo vcc→gnd · mcu: 0
 */
export interface PartSimState {
  /** Main through-current in amperes (see the table above). */
  currentA: number;
  /** Voltage across the main terminals (V). */
  voltage: number;
  powerW?: number;
  /** LEDs: 0..1 perceived brightness (already scaled by PWM duty). */
  brightness?: number;
  /** RGB LED channels 0..1. */
  rgb?: [number, number, number];
  /** Motor: -1..1 (sign = direction). */
  speed?: number;
  /** Buzzer. */
  sounding?: boolean;
  toneHz?: number;
  /** Servo: degrees 0..180 (only moves when powered). */
  angle?: number;
  powered?: boolean;
  /** Exceeding a rating right now (LED/diode/motor/npn/GPIO). */
  overloaded?: boolean;
  burned?: boolean;
  /** LED/diode reverse-biased with a meaningful voltage (likely inserted backwards). */
  reversed?: boolean;
  /** npn: 'corte' | 'activa' | 'saturación'. */
  region?: string;
  /** Board part only: onboard indicators. led = Uno 'L' (D13, 0..1 incl. duty); rgb 0..1 from CircuitInputs.onboardRgb. */
  onboard?: { power: boolean; led?: number; rgb?: [number, number, number] };
}

export interface SupplyState {
  id: string; // 'uno1:5V', 'bat1'
  part: Id;
  label: string; // 'USB 5V', 'Batería 9V'
  volts: number;
  currentA: number; // delivered
  limitA?: number;
  overloaded: boolean;
}

export interface BoardPinState {
  volts: number;
  /** Current flowing OUT of the pin into the circuit (A). Negative = sinking. */
  currentA: number;
  /** Digital reading with the board thresholds (0 | 1). */
  digital: 0 | 1;
  /** Raw ADC reading for analog-capable pins. */
  adc?: number;
}

export interface CircuitResult {
  /** The project object this result was solved for (staleness check: result.project === current project). */
  project: ProjectModel;
  converged: boolean;
  iterations: number;
  netVoltages: Record<NetId, number>;
  pinVoltages: Record<PinRef, number>;
  /**
   * Wire id → current (A); positive flows from wire.from to wire.to. Wires are
   * modelled as tiny resistors between the overlap/bus-merged nodes; a wire whose
   * two ends are already in the same merged node carries 0.
   */
  wireCurrents: Record<Id, number>;
  /** Every pin (incl. breadboard holes) → current flowing from its node INTO that pin/leg (A). Use for per-leg readouts (npn base vs collector, wiper) and strip-flow animation. */
  pinCurrents: Record<PinRef, number>;
  parts: Record<Id, PartSimState>;
  supplies: SupplyState[];
  /** Board pin id → state (for the single active board). */
  boardPins: Record<string, BoardPinState>;
  shorts: Array<{ parts: Id[]; nets: NetId[]; currentA: number; message: string }>;
  /** Id of the board part used as reference, if any. */
  boardPart: Id | null;
}

/* ------------------------------------------------------------------------- */
/* Checks (educational design rules)                                         */
/* ------------------------------------------------------------------------- */

export type CheckCode =
  | 'no-board'
  | 'multiple-boards'
  | 'short-circuit'
  | 'led-no-resistor'
  | 'led-reversed'
  | 'part-burned'
  | 'pin-overcurrent'
  | 'pin-overvoltage'
  | 'supply-overload'
  | 'motor-direct-gpio'
  | 'missing-flyback'
  | 'no-common-ground'
  | 'floating-input'
  | 'unconnected-part'
  | 'unconnected-pin'
  | 'servo-power'
  | 'strapping-pin'
  | 'part-bypassed' // both legs of a part in the same strip/net (LED rotated into one column…)
  // program checks (program/codegen programChecks)
  | 'block-unbound'
  | 'pin-not-analog'
  | 'pin-not-pwm'
  | 'block-unsupported-board'
  | 'timer-conflict'
  | 'program-error';

export interface CheckIssue {
  id: string; // stable: `${code}:${partIds.join(',')}` (+ optional `:${pinOrRail}` for per-pin/per-rail issues)
  code: CheckCode;
  severity: 'error' | 'warning' | 'info';
  title: string; // Spanish, short
  message: string; // Spanish: what happens and WHY (educational)
  fix?: string; // Spanish suggestion
  parts: Id[];
  wires?: Id[];
  nets?: NetId[];
}

/* ------------------------------------------------------------------------- */
/* Wiring guide                                                              */
/* ------------------------------------------------------------------------- */

export interface GuideStep {
  id: string;
  index: number; // 1-based
  kind: 'board' | 'breadboard' | 'part' | 'wire' | 'power' | 'check' | 'program';
  title: string; // Spanish: 'Coloca el LED rojo'
  detail: string; // Spanish, with exact holes/pins: 'Pata larga (ánodo) en e10, pata corta en e11'
  highlight: string[]; // part ids / wire ids / pin refs to highlight
  tip?: string;
}

/* ------------------------------------------------------------------------- */
/* Headless simulation (agent `simulate` tool, tests)                        */
/* ------------------------------------------------------------------------- */

export interface SimInputEvent {
  atMs: number;
  part: Id;
  prop: string; // runtime prop, e.g. 'pressed', 'position', 'light'
  value: PropValue;
}

export interface SimTimeline {
  durationMs: number;
  /** Sampled part states (only changes are recorded). */
  changes: Array<{ t: number; part: Id; state: Partial<PartSimState> }>;
  serial: Array<{ t: number; text: string }>;
  issues: CheckIssue[];
  /** True when the change cap was hit (final state of each affected part appended). */
  truncated?: boolean;
  error?: string;
}

/* ------------------------------------------------------------------------- */
/* Compile                                                                    */
/* ------------------------------------------------------------------------- */

export interface CompileDiagnostic {
  line: number; // 1-based line in the generated sketch
  column?: number;
  severity: 'error' | 'warning';
  message: string;
  blockId?: string; // mapped back through codegen lineMap
}

export interface CompileResult {
  jobId: string;
  status: 'queued' | 'running' | 'success' | 'error';
  board: BoardId;
  fqbn: string;
  /** Backend fills line/column/severity/message; the FRONTEND maps blockId via CodegenResult.lineMap. */
  diagnostics: CompileDiagnostic[];
  /** Raw arduino-cli output (stdout+stderr, trimmed). */
  log: string;
  sizes?: { flashBytes: number; flashMax: number; ramBytes?: number; ramMax?: number };
  /** Relative URL to download the binary (.hex for Uno, merged .bin for ESP32-C6). */
  artifactUrl?: string;
  artifactName?: string;
  durationMs?: number;
}

export interface CodegenResult {
  code: string;
  /** 1-based line number → Blockly block id. */
  lineMap: Record<number, string>;
  warnings: Array<{ message: string; blockId?: string; part?: Id }>;
}
