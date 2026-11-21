/**
 * Defensive normalization for projects coming from outside the app
 * (localStorage, imported .json files, agent `project.load`). Never throws.
 */
import type { PartInstance, ProjectModel, Rotation, Wire } from '@/contracts';
import { createEmptyProject } from './newProject';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

export function normalizeProject(input: unknown): ProjectModel | null {
  if (!input || typeof input !== 'object') return null;
  const p = input as Partial<ProjectModel>;
  if (p.version !== 1 || !Array.isArray(p.parts)) return null;
  const base = createEmptyProject(typeof p.name === 'string' && p.name ? p.name : 'Mi circuito');
  const seen = new Set<string>();
  const parts: PartInstance[] = [];
  for (const raw of p.parts) {
    if (!raw || typeof raw !== 'object') continue;
    const part = raw as Partial<PartInstance>;
    if (typeof part.id !== 'string' || typeof part.type !== 'string' || seen.has(part.id)) continue;
    seen.add(part.id);
    const rot = Number(part.rotation);
    parts.push({
      id: part.id,
      type: part.type,
      label: typeof part.label === 'string' ? part.label : part.id,
      x: Number.isFinite(Number(part.x)) ? Math.round(Number(part.x)) : 0,
      y: Number.isFinite(Number(part.y)) ? Math.round(Number(part.y)) : 0,
      rotation: (ROTATIONS.includes(rot as Rotation) ? rot : 0) as Rotation,
      props: part.props && typeof part.props === 'object' ? { ...part.props } : {},
    });
  }
  const wireIds = new Set<string>();
  const wires: Wire[] = [];
  for (const raw of Array.isArray(p.wires) ? p.wires : []) {
    if (!raw || typeof raw !== 'object') continue;
    const w = raw as Partial<Wire>;
    if (typeof w.id !== 'string' || typeof w.from !== 'string' || typeof w.to !== 'string' || wireIds.has(w.id)) continue;
    wireIds.add(w.id);
    wires.push({
      id: w.id,
      from: w.from,
      to: w.to,
      color: (typeof w.color === 'string' ? w.color : 'yellow') as Wire['color'],
      ...(Array.isArray(w.waypoints) ? { waypoints: w.waypoints.filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) } : {}),
    });
  }
  return {
    version: 1,
    id: typeof p.id === 'string' && p.id ? p.id : base.id,
    name: base.name,
    parts,
    wires,
    program: { workspace: p.program && typeof p.program === 'object' ? (p.program.workspace ?? null) : null },
    meta: {
      ...base.meta,
      ...(p.meta && typeof p.meta === 'object' ? p.meta : {}),
    },
  };
}
