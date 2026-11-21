/**
 * Helpers shared by the C++ generator, the program checks and the interpreter.
 * Everything here implements the NUMERIC MODEL / IMPLICIT SETUP / SENSOR
 * FORMULAS of contracts/ir.ts, so codegen and the simulator always agree.
 */
import type { Binding, BoardPin, BoardProfile, Id, PartInstance, PinCap, ProgramIR } from '@/contracts';
import { getBoardProfile } from '@/catalog';
import type { ProgramContext } from '../context';
import { isPartNode, visitProgram, type PartNode } from './walk';

export * from './numeric';

/* ------------------------------------------------------------------------- */
/* Board & pins                                                              */
/* ------------------------------------------------------------------------- */

/** ctx.board wins; ir.board is only a fallback when the canvas has no board. */
export function resolveBoard(ir: ProgramIR, ctx: ProgramContext): BoardProfile | null {
  if (ctx.board) return ctx.board;
  if (!ir.board) return null;
  try {
    return getBoardProfile(ir.board);
  } catch {
    return null;
  }
}

/** Canonical board pin id (aliasOf resolved: SDA → A4). */
export function canonicalPin(board: BoardProfile | null, pinId: string): string {
  if (!board) return pinId;
  return board.pins.find((p) => p.id === pinId)?.aliasOf ?? pinId;
}

export function boardPinDef(board: BoardProfile | null, pinId: string): BoardPin | undefined {
  if (!board) return undefined;
  const canon = canonicalPin(board, pinId);
  return board.pins.find((p) => p.id === canon);
}

export const pinHasCap = (def: BoardPin | undefined, cap: PinCap) => !!def?.caps?.includes(cap);

/** Human pin name for comments and messages: 'pin 13', 'pin A0', 'GPIO4'. */
export function pinDisplay(board: BoardProfile | null, pinId: string): string {
  const def = boardPinDef(board, pinId);
  if (!def) return `pin ${pinId}`;
  if (/^GPIO\d+$/.test(def.id)) return def.id;
  return `pin ${def.codeName ?? def.label ?? def.id}`;
}

export interface GenericPin {
  boardPin: string; // canonical id
  codeName: string; // C identifier: '13', 'A0', '4'
  def: BoardPin | undefined;
}

/**
 * Resolve a generic pin field (BoardPin.id) to its canonical GPIO.
 * Returns null when the pin does not exist on the board or is not a GPIO.
 * Without a board the id is used as-is (best effort: 'D13' → '13', 'GPIO4' → '4').
 */
export function resolveGenericPin(board: BoardProfile | null, pinId: string): GenericPin | null {
  if (typeof pinId !== 'string' || !pinId) return null;
  if (!board) {
    const m = /^(?:D|GPIO)(\d+)$/.exec(pinId);
    return { boardPin: pinId, codeName: m ? m[1] : pinId, def: undefined };
  }
  const def = boardPinDef(board, pinId);
  if (!def || def.kind !== 'gpio' || !def.codeName) return null;
  return { boardPin: def.id, codeName: def.codeName, def };
}

/* ------------------------------------------------------------------------- */
/* Bindings                                                                  */
/* ------------------------------------------------------------------------- */

/** Same lookup as program/context bindingFor (prefers a bound binding). */
export function findBinding(ctx: ProgramContext, part: Id, channel?: string): Binding | undefined {
  const match = (b: Binding) => b.part === part && (channel === undefined || b.channel === channel);
  return ctx.bindings.find((b) => match(b) && b.boardPin !== null) ?? ctx.bindings.find(match);
}

export interface ResolvedPin extends GenericPin {
  binding: Binding;
}

/** Binding of (part, channel) resolved to a canonical board pin, or null when unbound. */
export function resolvePart(
  ctx: ProgramContext,
  board: BoardProfile | null,
  part: Id,
  channel?: string,
): ResolvedPin | null {
  const binding = findBinding(ctx, part, channel);
  if (!binding || !binding.boardPin) return null;
  const boardPin = canonicalPin(board, binding.boardPin);
  const def = boardPinDef(board, boardPin);
  // A binding to a non-GPIO pin (power, GND…) cannot be driven/read by code.
  if (board && (!def || def.kind !== 'gpio' || !def.codeName)) return null;
  const codeName = def?.codeName ?? binding.codeName ?? boardPin;
  return { binding, boardPin, codeName, def };
}

export const RGB_CHANNELS = ['r', 'g', 'b'] as const;
export type RgbChannel = (typeof RGB_CHANNELS)[number];

export function findPart(ctx: ProgramContext, id: Id): PartInstance | undefined {
  return ctx.project.parts.find((p) => p.id === id);
}

/** Display label of a part ('LED 1'), falling back to its id. */
export function partLabel(ctx: ProgramContext, id: Id): string {
  return cleanText(findPart(ctx, id)?.label ?? '') || cleanText(String(id));
}

/** Text safe for a `//` comment or a message (no newlines / line continuations). */
export function cleanText(s: string): string {
  return String(s).replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\\/g, '/').trim();
}

/* ------------------------------------------------------------------------- */
/* Program usage                                                             */
/* ------------------------------------------------------------------------- */

export interface PartUsage {
  part: Id;
  kinds: Set<PartNode['k']>;
  /** Block ids of every node that references the part (in program order). */
  blockIds: string[];
}

/** Parts referenced by part-level nodes, in project order (unknown ids last). */
export function collectPartUsage(ir: ProgramIR, ctx: ProgramContext): PartUsage[] {
  const map = new Map<Id, PartUsage>();
  const add = (n: PartNode) => {
    let u = map.get(n.part);
    if (!u) map.set(n.part, (u = { part: n.part, kinds: new Set(), blockIds: [] }));
    u.kinds.add(n.k);
    if (n.id) u.blockIds.push(n.id);
  };
  visitProgram(ir, {
    stmt: (s) => isPartNode(s) && add(s),
    expr: (e) => isPartNode(e) && add(e),
  });
  const order = new Map(ctx.project.parts.map((p, i) => [p.id, i]));
  return [...map.values()].sort((a, b) => (order.get(a.part) ?? 1e9) - (order.get(b.part) ?? 1e9));
}

export interface VarInfo {
  name: string;
  type: 'number' | 'boolean';
  init: number | boolean;
  /** false = referenced but missing from ir.variables (auto-declared as number). */
  declared: boolean;
}

/** Declared variables (first declaration wins) + every referenced-but-undeclared one. */
export function collectVariables(ir: ProgramIR): VarInfo[] {
  const out = new Map<string, VarInfo>();
  for (const v of Array.isArray(ir.variables) ? ir.variables : []) {
    if (!v || typeof v.name !== 'string' || !v.name || out.has(v.name)) continue;
    const type = v.type === 'boolean' ? 'boolean' : 'number';
    const init = type === 'boolean' ? Boolean(v.init) : typeof v.init === 'number' && Number.isFinite(v.init) ? v.init : 0;
    out.set(v.name, { name: v.name, type, init, declared: true });
  }
  const ref = (name: unknown) => {
    if (typeof name !== 'string' || !name || out.has(name)) return;
    out.set(name, { name, type: 'number', init: 0, declared: false });
  };
  visitProgram(ir, {
    stmt: (s) => {
      if (s.k === 'set' || s.k === 'change' || s.k === 'for') ref(s.var);
    },
    expr: (e) => {
      if (e.k === 'var') ref(e.name);
    },
  });
  return [...out.values()];
}

export const usesSerial = (ir: ProgramIR) => {
  let found = false;
  visitProgram(ir, { stmt: (s) => (found ||= s.k === 'serialPrint') });
  return found;
};

/* ------------------------------------------------------------------------- */
/* Implicit setup (identical in codegen and interpreter)                     */
/* ------------------------------------------------------------------------- */

export type DigitalMode = 'OUTPUT' | 'INPUT' | 'INPUT_PULLUP';

export interface PinSetup {
  boardPin: string;
  codeName: string;
  mode: DigitalMode;
  reason: 'part' | 'onboard' | 'auto';
  part?: Id;
  channel?: string;
  blockId?: string;
}

export interface ServoSetup {
  part: Id;
  boardPin: string;
  codeName: string;
  blockId?: string;
}

export interface SetupPlan {
  board: BoardProfile | null;
  serial: boolean;
  /** pinMode calls in emission order: parts (project order) → onboard LED → automatic outputs. */
  pinModes: PinSetup[];
  servos: ServoSetup[];
  parts: PartUsage[];
  /** Parts referenced by the program with no bound board pin at all. */
  unboundParts: Id[];
  /** Pins configured by explicit pinMode nodes. */
  explicitPins: Set<string>;
}

const GENERIC_WRITES = new Set(['digitalWrite', 'analogWrite', 'tone']);

export function planSetup(ir: ProgramIR, ctx: ProgramContext, board: BoardProfile | null): SetupPlan {
  const parts = collectPartUsage(ir, ctx);
  const pinModes: PinSetup[] = [];
  const servos: ServoSetup[] = [];
  const unboundParts: Id[] = [];
  const configured = new Set<string>();
  const addMode = (p: PinSetup) => {
    const key = `${p.boardPin}|${p.mode}`;
    if (configured.has(key)) return;
    configured.add(key);
    pinModes.push(p);
  };

  for (const u of parts) {
    const bound = ctx.bindings.filter((b) => b.part === u.part && b.boardPin);
    if (bound.length === 0) {
      unboundParts.push(u.part);
      continue;
    }
    if (u.kinds.has('servo')) {
      const r = resolvePart(ctx, board, u.part);
      if (r) servos.push({ part: u.part, boardPin: r.boardPin, codeName: r.codeName, blockId: u.blockIds[0] });
      continue;
    }
    const seen = new Set<string>();
    for (const b of bound) {
      const ch = b.channel;
      if (seen.has(ch ?? '')) continue;
      seen.add(ch ?? '');
      const r = resolvePart(ctx, board, u.part, ch);
      if (!r || r.binding.mode === 'ANALOG') continue;
      addMode({ boardPin: r.boardPin, codeName: r.codeName, mode: r.binding.mode, reason: 'part', part: u.part, channel: ch, blockId: u.blockIds[0] });
    }
  }

  const explicitPins = new Set<string>();
  let onboardLedId: string | undefined;
  let usesOnboardLed = false;
  const writes: Array<{ pin: string; blockId?: string }> = [];
  visitProgram(ir, {
    stmt: (s) => {
      if (s.k === 'pinMode') {
        const g = resolveGenericPin(board, s.pin);
        if (g) explicitPins.add(g.boardPin);
      } else if (s.k === 'onboardLed') {
        usesOnboardLed = true;
        onboardLedId ??= s.id;
      } else if (GENERIC_WRITES.has(s.k) && 'pin' in s) {
        writes.push({ pin: s.pin, blockId: s.id });
      }
    },
  });

  const onboardLed = board?.onboard.find((o) => o.kind === 'led');
  if (usesOnboardLed && onboardLed) {
    const pin = canonicalPin(board, onboardLed.pin);
    addMode({ boardPin: pin, codeName: 'LED_BUILTIN', mode: 'OUTPUT', reason: 'onboard', blockId: onboardLedId });
  }

  const anyMode = (pin: string) => pinModes.some((p) => p.boardPin === pin);
  for (const w of writes) {
    const g = resolveGenericPin(board, w.pin);
    if (!g || explicitPins.has(g.boardPin) || anyMode(g.boardPin)) continue;
    addMode({ boardPin: g.boardPin, codeName: g.codeName, mode: 'OUTPUT', reason: 'auto', blockId: w.blockId });
  }

  return { board, serial: usesSerial(ir), pinModes, servos, parts, unboundParts, explicitPins };
}

/** Effective PWM capability of a pin right now (timer conflicts disable PWM on some pins). */
export function pwmAvailable(board: BoardProfile | null, pin: string, active: { servo: boolean; tone: boolean }): boolean {
  if (!board) return true;
  const def = boardPinDef(board, pin);
  if (!pinHasCap(def, 'pwm')) return false;
  return !board.conflicts.some((c) => active[c.when] && c.disablesPwm.map((p) => canonicalPin(board, p)).includes(def!.id));
}

/**
 * Canonical pins that receive PWM writes anywhere in the program (analogWrite,
 * brightness, motor speed, RGB channels).
 */
export function pwmPins(ir: ProgramIR, ctx: ProgramContext, board: BoardProfile | null): Set<string> {
  const out = new Set<string>();
  visitProgram(ir, {
    stmt: (s) => {
      if (s.k === 'analogWrite') {
        const g = resolveGenericPin(board, s.pin);
        if (g) out.add(g.boardPin);
      } else if (s.k === 'ledBrightness' || s.k === 'motor') {
        const r = resolvePart(ctx, board, s.part);
        if (r) out.add(r.boardPin);
      } else if (s.k === 'rgb') {
        for (const ch of RGB_CHANNELS) {
          const r = resolvePart(ctx, board, s.part, ch);
          if (r) out.add(r.boardPin);
        }
      }
    },
  });
  return out;
}

/**
 * ESP32 core 3.x: once analogWrite attaches a pin to LEDC, digitalWrite on it
 * is ignored. On those pins digital writes are emitted (and simulated) as
 * analogWrite(pin, 0 | 255), which is electrically identical.
 */
export const digitalAsPwm = (board: BoardProfile | null, pin: string, pwm: ReadonlySet<string>) =>
  board?.toolchain.core === 'esp32:esp32' && pwm.has(pin);
