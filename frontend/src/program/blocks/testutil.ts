/** Test helpers: a project with parts and a hand-written ProgramContext (no circuit solver). */
import type { Binding, BoardId, PartInstance, ProjectModel } from '@/contracts';
import { getBoardProfile } from '@/catalog';
import { createStarterProject } from '@/store/newProject';
import type { ProgramContext } from '../context';

export function part(id: string, type: string, label: string): PartInstance {
  return { id, type, label, x: 0, y: 0, rotation: 0, props: {} };
}

export function binding(partId: string, pin: string, boardPin: string | null, extra: Partial<Binding> = {}): Binding {
  return { part: partId, pin, boardPin, codeName: boardPin ? boardPin.replace(/^D/, '') : null, activeLow: false, mode: 'OUTPUT', via: [], ...extra };
}

export function makeCtx(opts: { board?: BoardId | null; parts?: PartInstance[]; bindings?: Binding[] } = {}): ProgramContext {
  const board = opts.board === undefined ? 'uno' : opts.board;
  const project: ProjectModel = createStarterProject(board);
  project.parts.push(...(opts.parts ?? []));
  const boardPart = project.parts.find((p) => p.type === 'arduino-uno' || p.type === 'esp32c6-devkit') ?? null;
  return {
    project,
    board: board ? getBoardProfile(board) : null,
    boardPartId: boardPart?.id ?? null,
    bindings: opts.bindings ?? [],
  };
}

/** Deep copy without `id` keys (compare IRs modulo ids). */
export function stripIds<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripIds) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (k !== 'id') out[k] = stripIds(val);
    return out as T;
  }
  return v;
}

/** Every `id` found in a nested structure. */
export function collectIds(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => collectIds(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      if (k === 'id' && typeof val === 'string') out.push(val);
      else collectIds(val, out);
    }
  }
  return out;
}
