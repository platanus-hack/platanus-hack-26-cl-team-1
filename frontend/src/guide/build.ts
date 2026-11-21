/**
 * buildWiringGuide: step-by-step Spanish build instructions ordered like a
 * real build — board, breadboard, parts left → right with the exact hole of
 * every leg, power wires, signal wires, a final check and the program.
 */
import type { BoardProfile, GuideStep, Netlist, PartDef, PartInstance, PinRef, ProjectModel, Wire } from '@/contracts';
import { describeHole, findPartDef, projectBoard } from '@/catalog';
import { getProgramIR } from '@/program/blocks';
import { localToWorld } from '@/lib/geometry';
import { parsePinRef } from '@/lib/pinref';
import { type HoleInfo, type Occupancy, buildOccupancy, netKindOf } from '@/placement';
import { WIRE_COLOR_ES, capitalize, joinList, partPhrase, partTip, pinLong, pinShort } from './text';

type Draft = Omit<GuideStep, 'index'>;

const isBreadboard = (def: PartDef) => def.electrical.model === 'bus';
const isBoard = (def: PartDef) => def.electrical.model === 'mcu';

interface Ctx {
  project: ProjectModel;
  netlist: Netlist;
  occ: Occupancy;
  board: { part: PartInstance; profile: BoardProfile } | null;
  /** Part pin ref → hole it sits in. */
  holeOf: Map<PinRef, HoleInfo>;
}

function buildCtx(project: ProjectModel, netlist: Netlist): Ctx {
  const occ = buildOccupancy(project);
  const holeOf = new Map<PinRef, HoleInfo>();
  for (const ins of netlist.insertions) {
    const h = occ.holeByRef.get(ins.into);
    if (h) holeOf.set(ins.pin, h);
  }
  // Geometric fallback (works even when the netlist is not available yet).
  for (const part of project.parts) {
    const def = findPartDef(part.type);
    if (!def || isBreadboard(def)) continue;
    for (const pin of def.pins) {
      const ref = `${part.id}.${pin.id}`;
      if (holeOf.has(ref)) continue;
      const w = localToWorld(part, pin);
      const r = `${w.x},${w.y}`;
      const h = occ.holeAt.get(r);
      if (h) holeOf.set(ref, h);
    }
  }
  return { project, netlist, occ, board: projectBoard(project), holeOf };
}

function boardName(profile: BoardProfile): string {
  return profile.id === 'uno' ? 'Arduino' : 'ESP32-C6';
}

function boardPinName(profile: BoardProfile, pinId: string): string {
  const p = profile.pins.find((x) => x.id === pinId);
  if (!p) return pinId;
  if (p.kind === 'ground') return 'GND';
  if (profile.id === 'esp32c6' && p.kind === 'gpio' && p.gpio !== undefined) return `GPIO${p.gpio}`;
  return p.label || p.id;
}

/** Parts whose legs share the hole's strip ("columna del ánodo de LED rojo"). */
function stripContext(ctx: Ctx, hole: HoleInfo): string {
  if (hole.kind !== 'main') return '';
  for (const [ref, h] of ctx.holeOf) {
    if (h.strip !== hole.strip) continue;
    const { part: pid, pin } = parsePinRef(ref);
    const part = ctx.project.parts.find((p) => p.id === pid);
    const def = part && findPartDef(part.type);
    if (!part || !def) continue;
    if (isBoard(def)) return ` (columna del pin ${ctx.board ? boardPinName(ctx.board.profile, pin) : pin})`;
    const short = pinShort(def, pin);
    return ` (columna ${/^(pata|base|señal)/.test(short) ? 'de la' : 'del'} ${short} de ${part.label})`;
  }
  return '';
}

/** True when a pin of the active board is pushed into the hole's strip. */
function boardPinInStrip(ctx: Ctx, hole: HoleInfo): boolean {
  const boardId = ctx.board?.part.id;
  if (!boardId) return false;
  for (const [ref, h] of ctx.holeOf) if (h.strip === hole.strip && parsePinRef(ref).part === boardId) return true;
  return false;
}

interface EndText {
  long: string;
  short: string;
  x: number;
}

function describeEnd(ctx: Ctx, ref: PinRef): EndText {
  const { part: pid, pin } = parsePinRef(ref);
  const part = ctx.project.parts.find((p) => p.id === pid);
  const def = part && findPartDef(part.type);
  if (!part || !def) return { long: ref, short: ref, x: 0 };
  if (isBreadboard(def)) {
    const h = ctx.occ.holeByRef.get(ref);
    const x = h?.x ?? part.x;
    if (h?.kind === 'rail') {
      const sign = h.rail?.endsWith('+') ? '+' : '−';
      return { long: `el ${describeHole(pin)}`, short: `riel ${sign}`, x };
    }
    return { long: `${describeHole(pin)}${h ? stripContext(ctx, h) : ''}`, short: describeHole(pin), x };
  }
  if (isBoard(def) && ctx.board && ctx.board.part.id === part.id) {
    const name = boardPinName(ctx.board.profile, pin);
    const bn = boardName(ctx.board.profile);
    return { long: `el pin ${name} del ${bn}`, short: `${bn} ${name}`, x: part.x };
  }
  const h = ctx.holeOf.get(ref);
  return {
    long: `${pinLong(def, pin)} de ${part.label}`,
    short: `${part.label} ${pinShort(def, pin)}`,
    x: h?.x ?? part.x,
  };
}

function boardStep(ctx: Ctx, part: PartInstance, profile: BoardProfile): Draft {
  const def = findPartDef(part.type)!;
  const pins = def.pins.map((p) => ({ pin: p, hole: ctx.holeOf.get(`${part.id}.${p.id}`) })).filter((x) => x.hole);
  if (pins.length > 0) {
    const byHeader = new Map<string, HoleInfo[]>();
    for (const { pin, hole } of pins) {
      const header = profile.pins.find((bp) => bp.id === pin.id)?.header ?? '';
      byHeader.set(header, [...(byHeader.get(header) ?? []), hole!]);
    }
    const parts = [...byHeader.entries()].map(([header, holes]) => {
      const rows = [...new Set(holes.map((h) => h.row ?? h.rail ?? '?'))].join('/');
      const cols = holes.map((h) => h.col);
      return `la fila de pines ${header} en la fila ${rows} (columnas ${Math.min(...cols)} a ${Math.max(...cols)})`;
    });
    return {
      id: `board-${part.id}`,
      kind: 'board',
      title: `Monta el ${profile.id === 'uno' ? 'Arduino Uno' : 'ESP32-C6'} sobre la protoboard`,
      detail: `Inserta la placa a caballo sobre el canal central: ${joinList(parts)}. Presiona parejo y con cuidado.`,
      highlight: [part.id],
      tip: profile.logicVoltage < 5 ? 'Esta placa trabaja a 3,3 V: nunca conectes 5 V a sus pines GPIO.' : undefined,
    };
  }
  return {
    id: `board-${part.id}`,
    kind: 'board',
    title: profile.id === 'uno' ? 'Ubica el Arduino Uno' : 'Ubica el ESP32-C6',
    detail:
      profile.id === 'uno'
        ? 'Déjalo junto a la protoboard con los pines digitales (0 a 13) hacia arriba. El cable USB lo conectas al final: ese cable le da energía.'
        : 'Déjalo junto a la protoboard. El cable USB-C lo conectas al final: ese cable le da energía.',
    highlight: [part.id],
    tip:
      profile.logicVoltage < 5
        ? 'Trabaja a 3,3 V: nunca conectes 5 V a sus pines GPIO.'
        : `Cada pin entrega como máximo unos ${profile.pinCurrent.recommendedmA} mA: suficiente para un LED, no para un motor.`,
  };
}

function breadboardStep(part: PartInstance): Draft {
  return {
    id: `bb-${part.id}`,
    kind: 'breadboard',
    title: 'Prepara la protoboard',
    detail:
      'Cada columna numerada une sus cinco agujeros a–e (y, por separado, f–j). Los rieles + (línea roja) y − (línea azul) recorren todo el largo.',
    highlight: [part.id],
    tip: 'El canal central separa las dos mitades: lo que está arriba no toca lo de abajo.',
  };
}

function partStep(ctx: Ctx, part: PartInstance, def: PartDef): Draft {
  const placed = def.pins.map((p) => ({ id: p.id, hole: ctx.holeOf.get(`${part.id}.${p.id}`) }));
  const inserted = placed.filter((x) => x.hole);
  const phrase = partPhrase(part, def);
  if (inserted.length > 0) {
    const legs = inserted.map((x) => `${pinLong(def, x.id)} en ${x.hole!.kind === 'rail' ? 'el ' : ''}${describeHole(x.hole!.id)}`);
    const loose = placed.filter((x) => !x.hole).map((x) => pinLong(def, x.id));
    return {
      id: `part-${part.id}`,
      kind: 'part',
      title: `Coloca ${phrase}`,
      detail: `${capitalize(joinList(legs))}.${loose.length ? ` ${capitalize(joinList(loose))} queda${loose.length > 1 ? 'n' : ''} fuera de la protoboard.` : ''}`,
      highlight: [part.id, ...inserted.map((x) => x.hole!.ref)],
      tip: partTip(part, def),
    };
  }
  const terms = def.pins.map((p) => pinLong(def, p.id));
  return {
    id: `part-${part.id}`,
    kind: 'part',
    title: `Ubica ${phrase} junto a la protoboard`,
    detail: terms.length
      ? `Va fuera de la protoboard. En los pasos siguientes conectarás ${joinList(terms)}.`
      : 'Va fuera de la protoboard.',
    highlight: [part.id],
    tip: partTip(part, def),
  };
}

function wireStep(ctx: Ctx, wire: Wire, power: boolean): Draft & { sortX: number; source: number } {
  const a = describeEnd(ctx, wire.from);
  const b = describeEnd(ctx, wire.to);
  // Read from the source side: board / battery first (also a hole in the column
  // of a board header pin pushed into the breadboard), rails before holes.
  const rank = (ref: PinRef, e: EndText) => {
    const def = findPartDef(ctx.project.parts.find((p) => p.id === parsePinRef(ref).part)?.type ?? '');
    if (def && (isBoard(def) || def.electrical.model === 'battery')) return 0;
    const hole = def && isBreadboard(def) ? ctx.occ.holeByRef.get(ref) : undefined;
    if (hole && hole.kind === 'main' && ctx.board && boardPinInStrip(ctx, hole)) return 0;
    if (e.short.startsWith('riel')) return 1;
    return 2;
  };
  const [first, second] = rank(wire.to, b) < rank(wire.from, a) ? [b, a] : [a, b];
  const color = WIRE_COLOR_ES[wire.color] ?? wire.color;
  const battery = [wire.from, wire.to].some((r) => findPartDef(ctx.project.parts.find((p) => p.id === parsePinRef(r).part)?.type ?? '')?.electrical.model === 'battery');
  return {
    id: `wire-${wire.id}`,
    kind: power ? 'power' : 'wire',
    title: `Cable ${color}: ${first.short} → ${second.short}`,
    detail: `Cable ${color}: desde ${first.long} hasta ${second.long}.`,
    highlight: [wire.id, wire.from, wire.to],
    tip: battery
      ? 'Conecta la batería al final, cuando hayas revisado todo el circuito.'
      : power && wire.color === 'black'
        ? 'Negro para GND y rojo para el +: así se lee el circuito de un vistazo.'
        : undefined,
    sortX: Math.min(a.x, b.x),
    source: Math.min(rank(wire.from, a), rank(wire.to, b)),
  };
}

/** A program with at least one block inside "al iniciar" / "repetir para siempre" (empty hats do not count). */
function hasProgram(project: ProjectModel): boolean {
  if (!project.program.workspace) return false;
  try {
    const ir = getProgramIR(project);
    return ir.setup.length + ir.loop.length > 0;
  } catch {
    return false;
  }
}

export function buildWiringGuide(project: ProjectModel, netlist: Netlist): GuideStep[] {
  const ctx = buildCtx(project, netlist);
  const steps: Draft[] = [];
  const boardPart = ctx.board?.part;
  const boardOnBreadboard = !!boardPart && findPartDef(boardPart.type)!.pins.some((p) => ctx.holeOf.has(`${boardPart.id}.${p.id}`));

  if (ctx.board && !boardOnBreadboard) steps.push(boardStep(ctx, ctx.board.part, ctx.board.profile));
  for (const bb of ctx.occ.boards) steps.push(breadboardStep(bb.part));
  if (ctx.board && boardOnBreadboard) steps.push(boardStep(ctx, ctx.board.part, ctx.board.profile));

  const inserted: Array<{ part: PartInstance; def: PartDef; col: number; row: number }> = [];
  const offBoard: Array<{ part: PartInstance; def: PartDef }> = [];
  for (const part of project.parts) {
    const def = findPartDef(part.type);
    if (!def || isBreadboard(def) || isBoard(def)) continue;
    const holes = def.pins.map((p) => ctx.holeOf.get(`${part.id}.${p.id}`)).filter((h): h is HoleInfo => !!h);
    if (holes.length) inserted.push({ part, def, col: Math.min(...holes.map((h) => h.x)), row: Math.min(...holes.map((h) => h.y)) });
    else offBoard.push({ part, def });
  }
  inserted.sort((a, b) => a.col - b.col || a.row - b.row);
  for (const x of inserted) steps.push(partStep(ctx, x.part, x.def));
  for (const x of offBoard) steps.push(partStep(ctx, x.part, x.def));

  const wires = project.wires.map((w) => {
    const kind = netKindOf(project, netlist, [w.from, w.to]);
    const power = w.color === 'red' || w.color === 'black' || kind !== null;
    return wireStep(ctx, w, power);
  });
  const power = wires.filter((w) => w.kind === 'power').sort((a, b) => a.source - b.source || a.sortX - b.sortX);
  const signal = wires.filter((w) => w.kind === 'wire').sort((a, b) => a.sortX - b.sortX);
  for (const w of [...power, ...signal]) {
    const { sortX, source, ...step } = w;
    void sortX;
    void source;
    steps.push(step);
  }

  const components = [...inserted, ...offBoard];
  if (components.length > 0 || project.wires.length > 0) {
    const polar = components.filter((c) => ['led', 'led-rgb', 'diode', 'buzzer', 'npn', 'battery-9v', 'battery-aa4'].includes(c.def.type));
    const checks = [
      'que cada pata esté en la columna indicada',
      'que ningún cable una directamente el + con el −',
    ];
    if (components.some((c) => c.def.type === 'led' || c.def.type === 'led-rgb')) checks.unshift('que cada LED tenga su resistencia');
    steps.push({
      id: 'check',
      kind: 'check',
      title: 'Revisa antes de energizar',
      detail: `Comprueba ${joinList(checks)}.${polar.length ? ` Revisa la polaridad de: ${joinList(polar.map((c) => c.part.label))}.` : ''}`,
      highlight: components.map((c) => c.part.id),
      tip: 'El panel de revisiones te avisa de cortocircuitos, LEDs sin resistencia y tierras sin unir.',
    });
  }

  if (ctx.board && hasProgram(project)) {
    const real = ctx.board.profile.id === 'uno' ? 'tu Arduino' : 'tu ESP32-C6';
    steps.push({
      id: 'program',
      kind: 'program',
      title: 'Carga el programa',
      detail: `Abre la pestaña Programa y pulsa ▶ Ejecutar para simularlo. Para ${real} real: conéctalo por USB, compila y súbelo.`,
      highlight: [ctx.board.part.id],
      tip: 'Mientras se ejecuta, el bloque activo se ilumina: así ves qué parte del programa está corriendo.',
    });
  }

  // Say each tip once: identical tips on later steps are dropped.
  const seenTips = new Set<string>();
  return steps.map((s, i) => {
    const step: GuideStep = { ...s, index: i + 1 };
    if (step.tip) {
      if (seenTips.has(step.tip)) delete step.tip;
      else seenTips.add(step.tip);
    }
    return step;
  });
}
