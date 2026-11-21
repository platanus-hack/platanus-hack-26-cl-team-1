/**
 * Per-part simulation state (PartSimState) from a solved network.
 * Sign conventions: see the "Main terminals" table in contracts/sim.ts.
 */
import type { Binding, CircuitInputs, PartSimState, PinDrive } from '@/contracts';
import type { ActiveBoard } from './board';
import { diodeCurrent, npnCurrents, resCurrent, srcCurrent } from './mna';
import { NPN_MAX_W, driveIsHigh, switchState, type Device, type DiodeDevice, type SupplyInfo } from './models';
import { clamp } from './props';
import type { PartRec, Topology } from './topology';

/** PWM/tone effect of the binding on a part (duty already flipped for activeLow loads). */
export interface PwmEffect {
  duty: number;
  toneHz?: number;
}

export interface PartStateContext {
  topo: Topology;
  board: ActiveBoard | null;
  inputs: CircuitInputs;
  drives: Map<string, PinDrive>;
  v: Float64Array;
  devices: Device[];
  supplies: SupplyInfo[];
  /** Binding for (part, channel); channel '' for single-signal parts. */
  binding: (part: string, channel?: string) => Binding | undefined;
  burned: Set<string>;
}

const DEFAULT_BUZZER_HZ = 2300;
const MIN_ON_CURRENT = 1e-6;

/** Perceived LED brightness (0..1) for a forward current. */
export function ledBrightness(currentA: number, ratedmA: number): number {
  if (currentA <= MIN_ON_CURRENT) return 0;
  return Math.min(1, Math.pow(currentA / (ratedmA / 1000), 0.6));
}

const netOf = (topo: Topology, rec: PartRec, pinId: string): number => {
  const idx = rec.pins.get(pinId);
  return idx === undefined ? -1 : topo.net[idx];
};

/** Loads that kick back when switched off: a diode across them (cathode to +) is a flyback diode. */
const INDUCTIVE = new Set(['motor', 'buzzer']);

/**
 * A reverse-biased diode/LED that is MEANT to be: another diode/LED in antiparallel
 * (bicolor LED pair, reverse-protection diode) or, for a plain diode, an inductive
 * load in parallel (flyback diode). Such a part is not "inserted backwards".
 */
export function reverseByDesign(topo: Topology, rec: PartRec, anode: string, cathode: string): boolean {
  const na = netOf(topo, rec, anode);
  const nc = netOf(topo, rec, cathode);
  if (na < 0 || nc < 0 || na === nc) return false;
  const plain = rec.def.electrical.model === 'diode';
  for (const q of topo.parts) {
    if (q === rec || q.bus || q.board) continue;
    const m = q.def.electrical.model;
    if (m === 'led' || m === 'diode') {
      if (netOf(topo, q, 'anode') === nc && netOf(topo, q, 'cathode') === na) return true;
    } else if (m === 'rgb-led') {
      if (netOf(topo, q, 'com') === na && ['r', 'g', 'b'].some((ch) => netOf(topo, q, ch) === nc)) return true;
    } else if (plain && INDUCTIVE.has(m)) {
      const nets = q.def.pins.map((p) => netOf(topo, q, p.id));
      if (nets.includes(na) && nets.includes(nc)) return true;
    }
  }
  return false;
}

export function pwmEffect(b: Binding | undefined, drives: Map<string, PinDrive>): PwmEffect {
  if (!b?.boardPin) return { duty: 1 };
  const d = drives.get(b.boardPin);
  if (!d || d.mode !== 'output') return { duty: 1 };
  const toneHz = d.toneHz && d.toneHz > 0 && driveIsHigh(d) ? d.toneHz : undefined;
  if (d.duty === undefined || d.duty <= 0 || d.duty >= 1) return { duty: 1, toneHz };
  return { duty: b.activeLow ? 1 - d.duty : d.duty, toneHz };
}

export function partState(rec: PartRec, ctx: PartStateContext, owned: Device[]): PartSimState {
  const { v, topo } = ctx;
  const id = rec.part.id;
  const el = rec.def.electrical;
  const burned = ctx.burned.has(id);
  const pv = (pinId: string) => {
    const idx = rec.pins.get(pinId);
    return idx === undefined ? 0 : v[topo.node[idx]];
  };
  const across = (p: string, n: string) => pv(p) - pv(n);
  const dev = (role = 'main') => owned.find((d) => d.role === role);
  const resI = (role = 'main') => {
    const d = dev(role);
    return d && d.kind === 'res' ? resCurrent(d, v) : 0;
  };
  const withBurn = (s: PartSimState): PartSimState => (burned ? { ...s, burned: true } : s);

  switch (el.model) {
    case 'resistor':
    case 'ldr': {
      const voltage = across('a', 'b');
      const currentA = resI();
      return withBurn({ currentA, voltage, powerW: voltage * currentA });
    }
    case 'potentiometer': {
      const aw = dev('aw');
      const wb = dev('wb');
      const iaw = aw && aw.kind === 'res' ? resCurrent(aw, v) : 0;
      const iwb = wb && wb.kind === 'res' ? resCurrent(wb, v) : 0;
      const powerW = (aw && aw.kind === 'res' ? iaw * iaw * aw.ohms : 0) + (wb && wb.kind === 'res' ? iwb * iwb * wb.ohms : 0);
      return withBurn({ currentA: iaw, voltage: across('a', 'b'), powerW });
    }
    case 'battery': {
      const sup = ctx.supplies.find((s) => s.part === id);
      const d = sup?.device;
      const currentA = d ? -srcCurrent(d, v) : sup ? sup.nominal / sup.ohms : 0;
      const voltage = d ? across('plus', 'minus') : 0;
      return withBurn({ currentA, voltage, powerW: voltage * currentA, overloaded: !!sup && Math.abs(currentA) > sup.limitA });
    }
    case 'switch': {
      if (el.kind === 'push') return withBurn({ currentA: resI(), voltage: across('a1', 'b1') });
      const pos = switchState(rec, { topo, board: ctx.board, inputs: ctx.inputs, pwmLevel: () => undefined }).position ?? 'a';
      return withBurn({ currentA: resI(pos === 'a' ? 'ca' : 'cb'), voltage: across('com', pos) });
    }
    case 'buzzer': {
      const voltage = across('plus', 'minus');
      const currentA = resI();
      const fx = pwmEffect(ctx.binding(id), ctx.drives);
      const powered = !burned && Math.abs(voltage) >= el.minVolts;
      let sounding = false;
      let toneHz: number | undefined;
      if (powered && el.kind === 'passive' && fx.toneHz) {
        sounding = true;
        toneHz = fx.toneHz;
      } else if (powered && el.kind === 'active') {
        sounding = true;
        toneHz = el.fixedHz ?? DEFAULT_BUZZER_HZ;
      }
      return withBurn({ currentA, voltage, powerW: voltage * currentA, sounding, toneHz });
    }
    case 'motor': {
      const voltage = across('a', 'b');
      const currentA = resI();
      const b = ctx.binding(id);
      const fx = pwmEffect(b, ctx.drives);
      const mag = clamp((Math.abs(voltage) - el.minVolts) / Math.max(1e-6, el.ratedVolts - el.minVolts), 0, 1);
      const speed = burned ? 0 : Math.sign(voltage) * mag * fx.duty;
      const gpioLimit = ctx.board ? ctx.board.profile.pinCurrent.recommendedmA / 1000 : Infinity;
      const overloaded = !!b?.boardPin && b.driver === 'direct' && Math.abs(currentA) > gpioLimit;
      return withBurn({ currentA, voltage, powerW: voltage * currentA, speed: speed === 0 ? 0 : speed, overloaded });
    }
    case 'servo': {
      const voltage = across('vcc', 'gnd');
      const currentA = resI();
      const powered = !burned && voltage >= el.minVolts;
      const s: PartSimState = { currentA, voltage, powerW: voltage * currentA, powered };
      const angle = ctx.inputs.servoAngles?.[id];
      if (powered && typeof angle === 'number' && Number.isFinite(angle)) s.angle = clamp(angle, 0, 180);
      return withBurn(s);
    }
    case 'led': {
      const d = dev();
      const voltage = across('anode', 'cathode');
      const currentA = d && d.kind === 'diode' ? diodeCurrent(d, v) : 0;
      const fx = pwmEffect(ctx.binding(id), ctx.drives);
      return withBurn({
        currentA,
        voltage,
        powerW: voltage * currentA,
        brightness: ledBrightness(currentA, el.ratedmA) * fx.duty,
        overloaded: currentA > el.maxmA / 1000,
        reversed: voltage < -1 && !reverseByDesign(topo, rec, 'anode', 'cathode'),
      });
    }
    case 'rgb-led': {
      let currentA = 0;
      let voltage = 0;
      let overloaded = false;
      let reversed = false;
      const rgb: [number, number, number] = [0, 0, 0];
      (['r', 'g', 'b'] as const).forEach((ch, k) => {
        const d = dev(ch) as DiodeDevice | undefined;
        const vch = across(ch, 'com');
        const i = d ? diodeCurrent(d, v) : 0;
        currentA += i;
        if (Math.abs(vch) > Math.abs(voltage)) voltage = vch;
        if (i > el.maxmA / 1000) overloaded = true;
        if (vch < -1) reversed = true;
        rgb[k] = ledBrightness(i, el.ratedmA) * pwmEffect(ctx.binding(id, ch), ctx.drives).duty;
      });
      return withBurn({ currentA, voltage, powerW: voltage * currentA, rgb, brightness: Math.max(...rgb), overloaded, reversed });
    }
    case 'diode': {
      const d = dev();
      const voltage = across('anode', 'cathode');
      const currentA = d && d.kind === 'diode' ? diodeCurrent(d, v) : 0;
      return withBurn({
        currentA,
        voltage,
        powerW: voltage * currentA,
        overloaded: currentA > el.maxmA / 1000,
        reversed: voltage < -1 && !reverseByDesign(topo, rec, 'anode', 'cathode'),
      });
    }
    case 'npn': {
      const d = dev();
      const voltage = across('c', 'e');
      if (!d || d.kind !== 'npn') return withBurn({ currentA: 0, voltage, region: 'corte' });
      const { ib, ic } = npnCurrents(d, v);
      const conducting = ib > MIN_ON_CURRENT || Math.abs(ic) > MIN_ON_CURRENT;
      const region = d.state === 'off' || !conducting ? 'corte' : d.state === 'active' ? 'activa' : 'saturación';
      const powerW = voltage * ic + across('b', 'e') * ib;
      return withBurn({
        currentA: ic,
        voltage,
        powerW,
        region,
        // Collector current over the rating, or overheating (e.g. base wired to 5 V without a resistor).
        overloaded: ic > el.maxmA / 1000 || powerW > NPN_MAX_W,
      });
    }
    case 'mcu':
      return boardState(rec, ctx);
    default:
      return { currentA: 0, voltage: 0 };
  }
}

function boardState(rec: PartRec, ctx: PartStateContext): PartSimState {
  const active = ctx.board?.rec === rec;
  const onboard: NonNullable<PartSimState['onboard']> = { power: active };
  const profile = active ? ctx.board?.profile : undefined;
  const ledDef = profile?.onboard.find((o) => o.kind === 'led');
  if (ledDef) {
    const d = ctx.drives.get(ledDef.pin);
    onboard.led = d && d.mode === 'output' && driveIsHigh(d) ? clamp(d.duty ?? 1, 0, 1) : 0;
  }
  if (profile?.onboard.some((o) => o.kind === 'rgb-ws2812')) {
    const c = ctx.inputs.onboardRgb;
    onboard.rgb = c ? [clamp(c[0] / 255, 0, 1), clamp(c[1] / 255, 0, 1), clamp(c[2] / 255, 0, 1)] : [0, 0, 0];
  }
  return { currentA: 0, voltage: 0, onboard };
}
