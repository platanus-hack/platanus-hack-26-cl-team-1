/**
 * ProjectSummary builder for the agent's get_project tool (pure: the caller
 * passes the derived data). Token rules from contracts/agent.ts:
 *  - breadboard holes are never listed as pins;
 *  - every other part lists its pins with the net name (or 'nodo <pinref>'),
 *    the hole it is inserted into, and `connectedTo` (no holes, no own pins);
 *  - board pins only when connected to something.
 */
import type { Binding, CheckIssue, Netlist, PartDef, PinRef, ProgramIR, ProjectModel, ProjectSummary } from '@/contracts';
import { defaultProps, findPartDef } from '@/catalog';
import { parsePinRef } from '@/lib/pinref';

export interface SummaryInputs {
  project: ProjectModel;
  netlist: Netlist;
  bindings: Binding[];
  issues: CheckIssue[];
  program: ProgramIR | null;
  programErrors: string[];
  view: ProjectSummary['view'];
}

/** Drop NetIds (unstable between builds, meaningless to the model). */
export function compactIssue(issue: CheckIssue): CheckIssue {
  const { nets, ...rest } = issue;
  void nets;
  return rest;
}

/** Recursively remove Blockly `id` fields from IR nodes (token budget). */
export function stripIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripIds) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'id') continue;
      out[k] = stripIds(v);
    }
    return out as T;
  }
  return value;
}

export const isEmptyIR = (ir: ProgramIR | null | undefined): boolean =>
  !ir || ((ir.setup?.length ?? 0) === 0 && (ir.loop?.length ?? 0) === 0 && (ir.functions?.length ?? 0) === 0 && (ir.variables?.length ?? 0) === 0);

export function buildProjectSummary(inp: SummaryInputs): ProjectSummary {
  const { project, netlist } = inp;
  const defs = new Map<string, PartDef | undefined>(project.parts.map((p) => [p.id, findPartDef(p.type)]));
  const isHole = (ref: PinRef) => defs.get(parsePinRef(ref).part)?.electrical.model === 'bus';
  const netById = new Map(netlist.nets.map((n) => [n.id, n]));
  const inserted = new Map<PinRef, PinRef>();
  for (const ins of netlist.insertions) inserted.set(ins.pin, ins.into);

  const board = project.parts.find((p) => defs.get(p.id)?.electrical.model === 'mcu');
  const boardDef = board ? defs.get(board.id) : undefined;
  const boardId = boardDef && boardDef.electrical.model === 'mcu' ? boardDef.electrical.board : null;

  const parts: ProjectSummary['parts'] = project.parts.map((part) => {
    const def = defs.get(part.id);
    const model = def?.electrical.model;
    const props = def ? { ...defaultProps(def), ...part.props } : { ...part.props };
    const pins: ProjectSummary['parts'][number]['pins'] = [];
    if (def && model !== 'bus') {
      const own = `${part.id}.`;
      for (const pd of def.pins) {
        const ref = `${part.id}.${pd.id}`;
        const net = netById.get(netlist.pinNet[ref]);
        const others = net ? net.pins.filter((p) => p !== ref && !isHole(p)) : [];
        const connectedTo = others.filter((p) => !p.startsWith(own)).sort();
        const into = inserted.get(ref);
        if (model === 'mcu' && connectedTo.length === 0) continue;
        let netName: string | null = null;
        if (net && (net.name || others.length > 0 || net.wires.length > 0)) {
          netName = net.name ?? `nodo ${[ref, ...others].sort()[0]}`;
        }
        pins.push({ id: pd.id, label: pd.label, net: netName, connectedTo, ...(into ? { inserted: into } : {}) });
      }
    }
    return {
      id: part.id,
      type: part.type,
      label: part.label,
      props,
      position: { x: part.x, y: part.y, rotation: part.rotation },
      pins,
    };
  });

  return {
    name: project.name,
    board: boardId,
    parts,
    wires: project.wires.map((w) => ({ id: w.id, from: w.from, to: w.to, color: w.color })),
    bindings: inp.bindings.map((b) => ({
      part: b.part,
      pin: b.pin,
      boardPin: b.boardPin,
      codeName: b.codeName,
      mode: b.mode,
      activeLow: b.activeLow,
      ...(b.channel ? { channel: b.channel } : {}),
      via: b.via,
    })),
    issues: inp.issues.map(compactIssue),
    program: isEmptyIR(inp.program) ? null : stripIds(inp.program),
    programErrors: inp.programErrors,
    view: inp.view,
  };
}
