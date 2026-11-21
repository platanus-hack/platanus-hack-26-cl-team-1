/**
 * Small imperative helper to build example projects through the same
 * placement planner the agent uses (so coordinates are always valid).
 * Every op is applied with applyOps; any error throws.
 */
import type { BoardId, Op, PinRef, Point, ProgramIR, ProjectModel, Rotation, WireColor } from '@/contracts';
import { findPartDef } from '@/catalog';
import { localToWorld, rotatePoint } from '@/lib/geometry';
import { parsePinRef } from '@/lib/pinref';
import { applyOps } from '@/store/applyOp';
import { createStarterProject } from '@/store/newProject';
import { type PlanAddPartOptions, buildOccupancy, isHoleFree, planAddPart, planConnect } from '@/placement';

export class ExampleBuilder {
  project: ProjectModel;
  readonly bb: string | null;

  constructor(board: BoardId | null, name: string) {
    this.project = createStarterProject(board, name);
    this.bb = this.project.parts.find((p) => findPartDef(p.type)?.electrical.model === 'bus')?.id ?? null;
  }

  private apply(ops: Op[], what: string): void {
    const r = applyOps(this.project, ops);
    if ('error' in r) throw new Error(`${what}: ${r.error}`);
    this.project = r.model;
  }

  /** Add a part (planAddPart) and return its id. */
  add(type: string, opts: PlanAddPartOptions = {}): string {
    const r = planAddPart(this.project, type, opts);
    if (r.error) throw new Error(`${type}: ${r.error}`);
    this.apply(r.ops, `Agregar ${type}`);
    return r.id;
  }

  /** Jumper wire (planConnect). Returns the wire id ('' when already connected). */
  connect(from: PinRef, to: PinRef, color?: WireColor): string {
    const r = planConnect(this.project, from, to, color);
    if (r.error) throw new Error(`${from} → ${to}: ${r.error}`);
    this.apply(r.ops, `Conectar ${from} → ${to}`);
    return r.wireId;
  }

  /** World position of a pin of the current project. */
  pinPos(ref: PinRef): Point {
    const { part: id, pin } = parsePinRef(ref);
    const part = this.project.parts.find((p) => p.id === id);
    const def = part && findPartDef(part.type);
    const pd = def?.pins.find((p) => p.id === pin);
    if (!part || !pd) throw new Error(`Pin inexistente: ${ref}`);
    return localToWorld(part, pd);
  }

  /** Free hole of a rail ('T+', 'T-', 'B+', 'B-') closest to `near` (a pin ref or a point). */
  rail(rail: 'T+' | 'T-' | 'B+' | 'B-', near: PinRef | Point): PinRef {
    const target = typeof near === 'string' ? this.pinPos(near) : near;
    const occ = buildOccupancy(this.project);
    let best: PinRef | null = null;
    let bestD = Infinity;
    for (const bb of occ.boards) {
      for (const h of bb.holes) {
        if (h.rail !== rail || !isHoleFree(occ, h)) continue;
        const d = Math.abs(h.x - target.x) + Math.abs(h.y - target.y) * 0.01;
        if (d < bestD) {
          bestD = d;
          best = h.ref;
        }
      }
    }
    if (!best) throw new Error(`No hay agujeros libres en el riel ${rail}`);
    return best;
  }

  /** Origin that puts `pinId` of a `type` part (with `rotation`) exactly on breadboard hole `holeId`. */
  originAt(type: string, pinId: string, holeId: string, rotation: Rotation = 0): Point {
    const def = findPartDef(type);
    const pin = def?.pins.find((p) => p.id === pinId);
    if (!pin || !this.bb) throw new Error(`originAt: ${type}.${pinId}`);
    const hole = this.pinPos(`${this.bb}.${holeId}`);
    const o = rotatePoint(pin, rotation);
    return { x: hole.x - o.x, y: hole.y - o.y };
  }

  /** Breadboard hole ref helper ('e12' → 'bb1.e12'). */
  hole(id: string): PinRef {
    if (!this.bb) throw new Error('El proyecto no tiene protoboard');
    return `${this.bb}.${id}`;
  }

  setProgramIR(ir: ProgramIR, toWorkspace: (ir: ProgramIR, project: ProjectModel) => unknown | null): void {
    const workspace = toWorkspace(ir, this.project);
    this.project = { ...this.project, program: { ...this.project.program, workspace: workspace ?? null } };
  }
}
