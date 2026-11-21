/** Issue collection with stable ids, de-duplication and severity ordering. */
import type { CheckIssue, CircuitResult, Id, Netlist } from '@/contracts';
import type { Binding } from '@/contracts';
import { describeHole, parseHole } from '@/catalog';
import type { Analysis } from '../analysis';
import { netIdOf } from '../netlist';
import type { PartRec, Topology } from '../topology';

const RANK: Record<CheckIssue['severity'], number> = { error: 0, warning: 1, info: 2 };

export type IssueInput = Omit<CheckIssue, 'id'> & { idSuffix?: string };

export class IssueList {
  private readonly map = new Map<string, CheckIssue>();

  /** Adds an issue (id = `${code}:${parts}`); an existing id keeps the more severe version. */
  add(input: IssueInput): void {
    const { idSuffix, ...issue } = input;
    const id = `${issue.code}:${issue.parts.join(',')}${idSuffix ? `:${idSuffix}` : ''}`;
    const prev = this.map.get(id);
    const keep: CheckIssue = prev && RANK[prev.severity] <= RANK[issue.severity] ? prev : { id, ...issue };
    // Same problem found twice (static + live): keep one text, union the highlights.
    const wires = [...new Set([...(prev?.wires ?? []), ...(issue.wires ?? [])])];
    const nets = [...new Set([...(prev?.nets ?? []), ...(issue.nets ?? [])])];
    const out: CheckIssue = { ...keep, wires, nets };
    if (!out.wires?.length) delete out.wires;
    if (!out.nets?.length) delete out.nets;
    if (!out.fix) delete out.fix;
    this.map.set(id, out);
  }

  has(code: CheckIssue['code'], parts: Id[]): boolean {
    return this.map.has(`${code}:${parts.join(',')}`);
  }

  list(): CheckIssue[] {
    return [...this.map.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  }
}

export interface CheckContext {
  an: Analysis;
  topo: Topology;
  netlist: Netlist;
  bindings: Binding[];
  result: CircuitResult | null;
  issues: IssueList;
}

/** NetId (of the given netlist) for a topology net index. */
export function netIdFor(ctx: CheckContext, net: number): string {
  const first = ctx.topo.netPins[net]?.[0];
  if (first === undefined) return netIdOf(net);
  return ctx.netlist.pinNet[ctx.topo.pins[first].ref] ?? netIdOf(net);
}

export const label = (rec: PartRec) => rec.part.label || rec.def.name;

export function pinLabel(rec: PartRec, pinId: string): string {
  return rec.def.pins.find((p) => p.id === pinId)?.label ?? pinId;
}

/** Breadboard hole a part pin is inserted into, if any. */
export function holeOf(topo: Topology, rec: PartRec, pinId: string): string | null {
  const idx = rec.pins.get(pinId);
  if (idx === undefined) return null;
  for (const [m, f] of topo.insertions) {
    if (m === idx && topo.pins[f].hole) return topo.pins[f].def.id;
  }
  return null;
}

/** "la columna 10 (filas a–e)" style description of the strip a hole belongs to. */
export function stripOf(holeId: string): string {
  const h = parseHole(holeId);
  if (!h) return holeId;
  if (h.kind === 'rail') return describeHole(holeId).replace(/ \(columna \d+\)$/, '');
  const top = 'abcde'.includes(h.row);
  return `la columna ${h.col} (filas ${top ? 'a–e' : 'f–j'})`;
}

export const fmtV = (v: number) => `${v.toLocaleString('es-CL', { maximumFractionDigits: 2 })} V`;
export const fmtmA = (a: number) => `${(a * 1000).toLocaleString('es-CL', { maximumFractionDigits: 0 })} mA`;
