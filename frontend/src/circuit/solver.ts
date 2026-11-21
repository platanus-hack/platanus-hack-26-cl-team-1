/**
 * solveCircuit: DC operating point of the whole project (always-live sim).
 * Never throws: on failure returns a best-effort result with converged=false.
 */
import type {
  Binding,
  BoardPinState,
  CircuitInputs,
  CircuitResult,
  Netlist,
  PartSimState,
  PinDrive,
  ProjectModel,
  SupplyState,
} from '@/contracts';
import { formatCurrent } from '@/lib/format';
import { activeBoard, type ActiveBoard } from './board';
import { deriveBindings } from './bindings';
import { chooseReferences, resCurrent, solveNetwork, srcCurrent, terminalCurrents, type NetworkSolution } from './mna';
import { buildDevices, canonicalDrives, type Built, type Device, type NpnState, type SupplyInfo } from './models';
import { netIdOf } from './netlist';
import { partState, type PartStateContext } from './partStates';
import { conductorPath } from './paths';
import { clamp } from './props';
import { getTopology, type Topology } from './topology';

interface Pass {
  built: Built;
  sol: NetworkSolution;
}

type PassKind = 'main' | 'low';

/** Last converged device states per topology + pass: warm start for the next solve (usually 1 iteration). */
const warmStates = new WeakMap<Topology, Record<PassKind, Map<string, boolean | NpnState>>>();

function warmStart(topo: Topology, kind: PassKind, devices: Device[]): void {
  const saved = warmStates.get(topo)?.[kind];
  if (!saved) return;
  for (const d of devices) {
    if (d.kind !== 'diode' && d.kind !== 'npn') continue;
    const s = saved.get(`${d.owner}|${d.role}`);
    if (d.kind === 'diode' && typeof s === 'boolean') d.on = s;
    else if (d.kind === 'npn' && typeof s === 'string') d.state = s;
  }
}

function saveStates(topo: Topology, kind: PassKind, devices: Device[]): void {
  let entry = warmStates.get(topo);
  if (!entry) {
    entry = { main: new Map(), low: new Map() };
    warmStates.set(topo, entry);
  }
  const m = entry[kind];
  m.clear();
  for (const d of devices) {
    if (d.kind === 'diode') m.set(`${d.owner}|${d.role}`, d.on);
    else if (d.kind === 'npn') m.set(`${d.owner}|${d.role}`, d.state);
  }
}

function runPass(
  topo: Topology,
  board: ActiveBoard | null,
  inputs: CircuitInputs,
  kind: PassKind,
  pwmLevel: (pin: string) => boolean | undefined,
): Pass {
  const built = buildDevices({ topo, board, inputs, pwmLevel });
  const refs = chooseReferences(topo.nodeCount, built.devices, built.refPriority);
  warmStart(topo, kind, built.devices);
  const sol = solveNetwork(topo.nodeCount, built.devices, refs);
  if (sol.converged) saveStates(topo, kind, built.devices);
  return { built, sol };
}

function normalizeInputs(inputs: CircuitInputs | null | undefined): CircuitInputs {
  return {
    drives: inputs?.drives ?? {},
    runtime: inputs?.runtime ?? {},
    burned: inputs?.burned ?? [],
    servoAngles: inputs?.servoAngles,
    onboardRgb: inputs?.onboardRgb ?? null,
  };
}

export function emptyResult(project: ProjectModel, converged = true): CircuitResult {
  return {
    project,
    converged,
    iterations: 0,
    netVoltages: {},
    pinVoltages: {},
    wireCurrents: {},
    pinCurrents: {},
    parts: {},
    supplies: [],
    boardPins: {},
    shorts: [],
    boardPart: null,
  };
}

export function solveCircuit(project: ProjectModel, netlist: Netlist, inputs: CircuitInputs): CircuitResult {
  try {
    return solveImpl(project, netlist, normalizeInputs(inputs));
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[circuit] solve failed', err);
    return emptyResult(project, false);
  }
}

function solveImpl(project: ProjectModel, netlist: Netlist, inputs: CircuitInputs): CircuitResult {
  const topo = getTopology(project);
  const board = activeBoard(topo);
  const bindings = deriveBindings(project, netlist);
  const drives = board ? canonicalDrives(board, inputs.drives) : new Map<string, PinDrive>();

  const main = runPass(topo, board, inputs, 'main', () => undefined);
  // Loads that are ON while a PWM pin is LOW (sinking LED…) are read from a second, LOW-phase solve.
  const lowPins = new Set<string>();
  for (const b of bindings) {
    if (!b.activeLow || b.mode !== 'OUTPUT' || !b.boardPin) continue;
    const d = drives.get(b.boardPin);
    if (d?.mode === 'output' && d.duty !== undefined && d.duty > 0 && d.duty < 1) lowPins.add(b.boardPin);
  }
  const low = lowPins.size ? runPass(topo, board, inputs, 'low', (pin) => (lowPins.has(pin) ? false : undefined)) : null;
  return collect({ project, netlist, topo, board, inputs, bindings, drives, main, low, lowPins });
}

interface CollectContext {
  project: ProjectModel;
  netlist: Netlist;
  topo: Topology;
  board: ActiveBoard | null;
  inputs: CircuitInputs;
  bindings: Binding[];
  drives: Map<string, PinDrive>;
  main: Pass;
  low: Pass | null;
  lowPins: Set<string>;
}

function groupByOwner(devices: Device[]): Map<string, Device[]> {
  const m = new Map<string, Device[]>();
  for (const d of devices) {
    if (d.role === 'link' || d.role === 'wire') continue;
    const list = m.get(d.owner);
    if (list) list.push(d);
    else m.set(d.owner, [d]);
  }
  return m;
}

function collect(c: CollectContext): CircuitResult {
  const { topo, board, main, netlist } = c;
  const v = main.sol.v;
  const nodeV = (pin: number) => v[topo.node[pin]];
  const netIdOfPin = (pin: number) => netlist.pinNet[topo.pins[pin].ref] ?? netIdOf(topo.net[pin]);

  /* voltages */
  const netVoltages: Record<string, number> = {};
  for (const net of netlist.nets) {
    const idx = topo.pinIndex.get(net.pins[0] ?? '');
    netVoltages[net.id] = idx !== undefined ? nodeV(idx) : 0;
  }
  for (let g = 0; g < topo.netCount; g++) {
    const first = topo.netPins[g][0];
    const id = netIdOfPin(first);
    if (!(id in netVoltages)) netVoltages[id] = nodeV(first);
  }
  const pinVoltages: Record<string, number> = {};
  for (const pin of topo.pins) pinVoltages[pin.ref] = nodeV(pin.idx);

  /* pin currents from the devices (into each leg / board pin), per pass */
  const devicePinCurrents = (p: Pass): Float64Array => {
    const out = new Float64Array(topo.pins.length);
    for (const d of p.built.devices) {
      if (d.role === 'wire') continue;
      for (const [t, i] of terminalCurrents(d, p.sol.v)) if (t.pin >= 0) out[t.pin] += i;
    }
    return out;
  };
  const pinI = devicePinCurrents(main);

  /* wire currents */
  const wireCurrents: Record<string, number> = {};
  for (const w of topo.wires) wireCurrents[w.wire.id] = 0;
  for (const d of main.built.devices) if (d.role === 'wire' && d.kind === 'res') wireCurrents[d.owner] = resCurrent(d, v);

  /* supplies + same-net shorts */
  const supplies: SupplyState[] = [];
  const shorts: CircuitResult['shorts'] = [];
  const boardLabel = board ? board.part.label || board.rec.def.name : 'la placa';
  const lowSupply = new Map((c.low?.built.supplies ?? []).map((s) => [s.id, s] as const));
  for (const s of main.built.supplies) {
    let delivered = s.device ? -srcCurrent(s.device, v) : s.nominal / s.ohms;
    let volts = s.device ? nodeV(s.plusPin) - nodeV(s.minusPin) : 0;
    // With a LOW-phase solve (sinking PWM loads), report the PEAK draw of the two phases.
    const ls = lowSupply.get(s.id);
    if (c.low && ls?.device) {
      const lv = c.low.sol.v;
      const lowDelivered = -srcCurrent(ls.device, lv);
      if (Math.abs(lowDelivered) > Math.abs(delivered)) {
        delivered = lowDelivered;
        volts = lv[topo.node[s.plusPin]] - lv[topo.node[s.minusPin]];
      }
    }
    // Negative = another source pushes current back INTO this one (battery on the 5V pin…): just as harmful.
    supplies.push({ id: s.id, part: s.part, label: s.label, volts, currentA: delivered, limitA: s.limitA, overloaded: Math.abs(delivered) > s.limitA });
    if (!s.device) {
      addPathCurrent(topo, s, delivered, wireCurrents, pinI);
      shorts.push({
        parts: [s.part],
        nets: [netIdOfPin(s.plusPin)],
        currentA: delivered,
        message: sameNetShortMessage(s, boardLabel, delivered),
      });
    }
  }

  /* pin currents (into each leg / hole / board pin) */
  const wireOut = new Float64Array(topo.pins.length);
  for (const w of topo.wires) {
    if (w.from < 0 || w.to < 0) continue;
    const i = wireCurrents[w.wire.id] ?? 0;
    wireOut[w.from] += i;
    wireOut[w.to] -= i;
  }
  const pinCurrents: Record<string, number> = {};
  const holeI = new Float64Array(topo.pins.length);
  for (const pin of topo.pins) if (pin.hole) holeI[pin.idx] = wireOut[pin.idx];
  for (const [m, f] of topo.insertions) if (topo.pins[f].hole) holeI[f] += pinI[m] + wireOut[m];
  for (const pin of topo.pins) pinCurrents[pin.ref] = pin.hole ? holeI[pin.idx] : pinI[pin.idx];

  /* parts */
  const bindingMap = new Map<string, Binding>();
  for (const b of c.bindings) bindingMap.set(`${b.part}|${b.channel ?? ''}`, b);
  const binding = (part: string, channel?: string) => bindingMap.get(`${part}|${channel ?? ''}`);
  const burned = new Set(c.inputs.burned);
  const mkCtx = (p: Pass): PartStateContext => ({
    topo,
    board,
    inputs: c.inputs,
    drives: c.drives,
    v: p.sol.v,
    devices: p.built.devices,
    supplies: p.built.supplies,
    binding,
    burned,
  });
  const mainCtx = mkCtx(main);
  const lowCtx = c.low ? mkCtx(c.low) : null;
  const mainOwned = groupByOwner(main.built.devices);
  const lowOwned = c.low ? groupByOwner(c.low.built.devices) : null;
  const parts: Record<string, PartSimState> = {};
  for (const rec of topo.parts) {
    const id = rec.part.id;
    const hi = partState(rec, mainCtx, mainOwned.get(id) ?? []);
    if (!lowCtx || !lowOwned) {
      parts[id] = hi;
      continue;
    }
    const b = binding(id);
    if (b && b.mode === 'OUTPUT') {
      // A bound load: read it in the phase where it is ON (activeLow on a PWM pin → the LOW phase).
      parts[id] = b.activeLow && b.boardPin && c.lowPins.has(b.boardPin) ? partState(rec, lowCtx, lowOwned.get(id) ?? []) : hi;
      continue;
    }
    // Everything else (series resistor of a sinking LED, the NPN…): PEAK of the two PWM phases.
    const lo = partState(rec, lowCtx, lowOwned.get(id) ?? []);
    parts[id] = Math.abs(lo.currentA) > Math.abs(hi.currentA) + 1e-9 ? lo : hi;
  }

  /* solved shorts: a supply over its limit whose terminal voltage collapsed */
  for (const s of main.built.supplies) {
    if (!s.device) continue;
    const st = supplies.find((x) => x.id === s.id);
    if (!st || st.currentA <= s.limitA || st.volts >= 0.5 * s.nominal) continue;
    const culprits = topo.parts
      .filter((r) => !r.bus && !r.board && r.part.id !== s.part && Math.abs(parts[r.part.id]?.currentA ?? 0) > 0.5 * st.currentA);
    // Two sources shorting each other (series-opposed batteries) are ONE short: report it once.
    if (shorts.some((sh) => sh.parts.includes(s.part) && culprits.some((r) => r.part.id === sh.parts[0]))) continue;
    shorts.push({
      parts: [s.part, ...culprits.map((r) => r.part.id)],
      nets: [netIdOfPin(s.plusPin), netIdOfPin(s.minusPin)],
      currentA: st.currentA,
      message: `¡Cortocircuito! ${s.kind === 'rail' ? `El pin ${s.label} de ${boardLabel}` : s.label} entrega ≈ ${formatCurrent(st.currentA)} por un camino casi sin resistencia${
        culprits.length ? ` (a través de ${culprits.map((r) => r.part.label || r.def.name).join(', ')})` : ''
      }. Nada limita la corriente: los componentes se calientan y la fuente se cae.`,
    });
  }

  /* board pins */
  const boardPins: Record<string, BoardPinState> = {};
  if (board) {
    const { profile } = board;
    const outCurrent = new Map<string, number>();
    const lowPinI = c.low && c.lowPins.size ? devicePinCurrents(c.low) : null;
    const lowOut = new Map<string, number>();
    for (const bp of profile.pins) {
      const idx = board.rec.pins.get(bp.id);
      if (idx === undefined) continue;
      const id = board.canonical(bp.id);
      outCurrent.set(id, (outCurrent.get(id) ?? 0) - pinI[idx]);
      if (lowPinI && c.lowPins.has(id)) lowOut.set(id, (lowOut.get(id) ?? 0) - lowPinI[idx]);
    }
    // PWM pins driving a sinking load: report the PEAK pin current (it flows in the LOW phase).
    for (const [id, i] of lowOut) if (Math.abs(i) > Math.abs(outCurrent.get(id) ?? 0)) outCurrent.set(id, i);
    for (const bp of profile.pins) {
      if (bp.aliasOf) continue;
      const idx = board.rec.pins.get(bp.id);
      if (idx === undefined) continue;
      const volts = nodeV(idx);
      const digital: 0 | 1 = volts >= profile.vih ? 1 : volts <= profile.vil ? 0 : volts > profile.logicVoltage / 2 ? 1 : 0;
      const st: BoardPinState = { volts, currentA: outCurrent.get(bp.id) ?? 0, digital };
      if (bp.caps?.includes('analog')) st.adc = clamp(Math.round((volts / profile.adc.vref) * profile.adc.maxValue), 0, profile.adc.maxValue);
      boardPins[bp.id] = st;
    }
  }

  const converged = main.sol.converged && (c.low?.sol.converged ?? true);
  return {
    project: c.project,
    converged,
    iterations: main.sol.iterations + (c.low?.sol.iterations ?? 0),
    netVoltages,
    pinVoltages,
    wireCurrents,
    pinCurrents,
    parts,
    supplies,
    boardPins,
    shorts,
    boardPart: board?.part.id ?? null,
  };
}

function sameNetShortMessage(s: SupplyInfo, boardLabel: string, currentA: number): string {
  const amps = formatCurrent(currentA);
  if (s.kind === 'rail') {
    return `¡Cortocircuito! El pin ${s.label} de ${boardLabel} está unido directamente a GND. La corriente (≈ ${amps}) no pasa por ningún componente que la limite: en la vida real el fusible del USB cortaría la energía o la placa se dañaría.`;
  }
  return `¡Cortocircuito! Los dos polos de ${s.label} están unidos sin nada en medio. Circularían ≈ ${amps}: la batería se calienta y se descarga en minutos.`;
}

/**
 * Shorted source (removed from the solve): put the short current on the conductor
 * path + → − so the flow animation, the wires AND the per-pin currents agree
 * (KCL holds at every node): out of the + pin, along wires and part-internal
 * buses, into the − pin.
 */
function addPathCurrent(topo: Topology, s: SupplyInfo, currentA: number, wireCurrents: Record<string, number>, pinI: Float64Array) {
  const path = conductorPath(topo, s.plusPin, s.minusPin);
  if (!path) return;
  pinI[s.plusPin] -= currentA;
  pinI[s.minusPin] += currentA;
  for (const step of path) {
    if (step.link) {
      pinI[step.link[0]] += currentA;
      pinI[step.link[1]] -= currentA;
    } else wireCurrents[step.wire] = (wireCurrents[step.wire] ?? 0) + step.sign * currentA;
  }
}
