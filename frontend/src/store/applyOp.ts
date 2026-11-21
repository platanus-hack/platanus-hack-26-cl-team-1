/**
 * Pure op reducer — see contracts/ops.ts for the semantics of each op.
 * Returns the new model plus the inverse ops, or an error (Spanish).
 */
import type { ApplyResult, Op, PartInstance, ProjectModel, PropValue, Wire } from '@/contracts';
import { findPartDef } from '@/catalog';
import { parsePinRef } from '@/lib/pinref';
import { normalizeProject } from './normalize';

export type ApplyOutcome = ApplyResult | { error: string };

const touch = (m: ProjectModel): ProjectModel => ({ ...m, meta: { ...m.meta, updatedAt: new Date().toISOString() } });

function pinExists(model: ProjectModel, ref: string): boolean {
  const { part, pin } = parsePinRef(ref);
  const inst = model.parts.find((p) => p.id === part);
  if (!inst) return false;
  const def = findPartDef(inst.type);
  return !!def?.pins.some((p) => p.id === pin);
}

function insertAt<T>(arr: T[], item: T, index?: number): T[] {
  const out = arr.slice();
  if (index === undefined || index < 0 || index > out.length) out.push(item);
  else out.splice(index, 0, item);
  return out;
}

export function applyOp(model: ProjectModel, op: Op): ApplyOutcome {
  switch (op.op) {
    case 'part.add': {
      if (model.parts.some((p) => p.id === op.part.id)) return { error: `Ya existe un componente con id ${op.part.id}` };
      if (!findPartDef(op.part.type)) return { error: `Tipo de componente desconocido: ${op.part.type}` };
      const part: PartInstance = {
        ...op.part,
        x: Math.round(op.part.x),
        y: Math.round(op.part.y),
        rotation: op.part.rotation ?? 0,
        props: { ...(op.part.props ?? {}) },
      };
      return { model: touch({ ...model, parts: insertAt(model.parts, part, op.index) }), inverse: [{ op: 'part.remove', id: part.id }] };
    }
    case 'part.remove': {
      const index = model.parts.findIndex((p) => p.id === op.id);
      if (index < 0) return { error: `No existe el componente ${op.id}` };
      const part = model.parts[index];
      const prefix = `${op.id}.`;
      const removed: Array<{ wire: Wire; index: number }> = [];
      const wires = model.wires.filter((w, i) => {
        const hit = w.from.startsWith(prefix) || w.to.startsWith(prefix);
        if (hit) removed.push({ wire: w, index: i });
        return !hit;
      });
      const parts = model.parts.filter((p) => p.id !== op.id);
      // inverse: re-add part first, then wires in ascending original index
      const inverse: Op[] = [{ op: 'part.add', part, index }, ...removed.map((r) => ({ op: 'wire.add' as const, wire: r.wire, index: r.index }))];
      return { model: touch({ ...model, parts, wires }), inverse };
    }
    case 'part.move': {
      const part = model.parts.find((p) => p.id === op.id);
      if (!part) return { error: `No existe el componente ${op.id}` };
      const x = Math.round(op.x), y = Math.round(op.y);
      return {
        model: touch({ ...model, parts: model.parts.map((p) => (p.id === op.id ? { ...p, x, y } : p)) }),
        inverse: [{ op: 'part.move', id: op.id, x: part.x, y: part.y }],
      };
    }
    case 'part.rotate': {
      const part = model.parts.find((p) => p.id === op.id);
      if (!part) return { error: `No existe el componente ${op.id}` };
      return {
        model: touch({ ...model, parts: model.parts.map((p) => (p.id === op.id ? { ...p, rotation: op.rotation } : p)) }),
        inverse: [{ op: 'part.rotate', id: op.id, rotation: part.rotation }],
      };
    }
    case 'part.setProps': {
      const part = model.parts.find((p) => p.id === op.id);
      if (!part) return { error: `No existe el componente ${op.id}` };
      const def = findPartDef(part.type);
      const prev: Record<string, PropValue> = {};
      for (const key of Object.keys(op.props)) {
        prev[key] = key in part.props ? part.props[key] : (def?.props.find((p) => p.key === key)?.default ?? '');
      }
      return {
        model: touch({ ...model, parts: model.parts.map((p) => (p.id === op.id ? { ...p, props: { ...p.props, ...op.props } } : p)) }),
        inverse: [{ op: 'part.setProps', id: op.id, props: prev }],
      };
    }
    case 'part.setLabel': {
      const part = model.parts.find((p) => p.id === op.id);
      if (!part) return { error: `No existe el componente ${op.id}` };
      return {
        model: touch({ ...model, parts: model.parts.map((p) => (p.id === op.id ? { ...p, label: op.label } : p)) }),
        inverse: [{ op: 'part.setLabel', id: op.id, label: part.label }],
      };
    }
    case 'wire.add': {
      if (model.wires.some((w) => w.id === op.wire.id)) return { error: `Ya existe un cable con id ${op.wire.id}` };
      if (!pinExists(model, op.wire.from)) return { error: `Pin inexistente: ${op.wire.from}` };
      if (!pinExists(model, op.wire.to)) return { error: `Pin inexistente: ${op.wire.to}` };
      if (op.wire.from === op.wire.to) return { error: 'Un cable no puede empezar y terminar en el mismo pin' };
      return { model: touch({ ...model, wires: insertAt(model.wires, { ...op.wire }, op.index) }), inverse: [{ op: 'wire.remove', id: op.wire.id }] };
    }
    case 'wire.remove': {
      const index = model.wires.findIndex((w) => w.id === op.id);
      if (index < 0) return { model, inverse: [] }; // already gone (e.g. cascaded) → no-op
      const wire = model.wires[index];
      return { model: touch({ ...model, wires: model.wires.filter((w) => w.id !== op.id) }), inverse: [{ op: 'wire.add', wire, index }] };
    }
    case 'wire.update': {
      const wire = model.wires.find((w) => w.id === op.id);
      if (!wire) return { error: `No existe el cable ${op.id}` };
      if (op.patch.from && !pinExists(model, op.patch.from)) return { error: `Pin inexistente: ${op.patch.from}` };
      if (op.patch.to && !pinExists(model, op.patch.to)) return { error: `Pin inexistente: ${op.patch.to}` };
      const prev: typeof op.patch = {};
      for (const k of Object.keys(op.patch) as Array<keyof typeof op.patch>) (prev as Record<string, unknown>)[k] = wire[k];
      const next = { ...wire, ...op.patch };
      if (next.waypoints === undefined) delete next.waypoints;
      return {
        model: touch({ ...model, wires: model.wires.map((w) => (w.id === op.id ? next : w)) }),
        inverse: [{ op: 'wire.update', id: op.id, patch: prev }],
      };
    }
    case 'program.set': {
      return {
        model: touch({ ...model, program: { ...model.program, workspace: op.workspace } }),
        inverse: [{ op: 'program.set', workspace: model.program.workspace }],
      };
    }
    case 'project.rename': {
      return { model: touch({ ...model, name: op.name }), inverse: [{ op: 'project.rename', name: model.name }] };
    }
    case 'project.load': {
      const next = normalizeProject(op.project);
      if (!next) return { error: 'El archivo no es un proyecto válido' };
      return { model: next, inverse: [{ op: 'project.load', project: model }] };
    }
    default: {
      const never: never = op;
      return { error: `Operación desconocida: ${JSON.stringify(never)}` };
    }
  }
}

/** Apply a list of ops atomically. Inverse is returned in apply order. */
export function applyOps(model: ProjectModel, ops: Op[]): ApplyOutcome {
  let m = model;
  const inverses: Op[][] = [];
  for (const op of ops) {
    const r = applyOp(m, op);
    if ('error' in r) return r;
    m = r.model;
    inverses.push(r.inverse);
  }
  return { model: m, inverse: inverses.reverse().flat() };
}
