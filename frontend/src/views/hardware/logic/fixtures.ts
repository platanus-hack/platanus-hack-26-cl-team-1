/** Test fixtures (not imported by the app). */
import type { PartInstance, ProjectModel, Wire } from '@/contracts';

export function project(parts: PartInstance[], wires: Wire[] = []): ProjectModel {
  return {
    version: 1,
    id: 'p1',
    name: 'Prueba',
    parts,
    wires,
    program: { workspace: null },
    meta: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  };
}

export const part = (id: string, type: string, x = 0, y = 0, extra: Partial<PartInstance> = {}): PartInstance => ({
  id,
  type,
  label: id.toUpperCase(),
  x,
  y,
  rotation: 0,
  props: {},
  ...extra,
});

/** Uno at the origin, half breadboard to its right (as createStarterProject('uno')). */
export const unoAndBreadboard = () => [part('uno1', 'arduino-uno', 0, 0), part('bb1', 'breadboard-half', 34, 0)];
