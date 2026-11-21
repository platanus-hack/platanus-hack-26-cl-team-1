import type { ProjectModel } from '@/contracts';

/** Next free id with the given prefix: 'led' → 'led1', 'led2'… */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  let n = 1;
  while (set.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export const nextPartId = (project: ProjectModel, prefix: string) =>
  nextId(prefix, project.parts.map((p) => p.id));

export const nextWireId = (project: ProjectModel) => nextId('w', project.wires.map((w) => w.id));

/** 'LED' → 'LED 1', 'LED 2'… (unique among current labels). */
export function nextLabel(project: ProjectModel, base: string): string {
  const labels = new Set(project.parts.map((p) => p.label));
  let n = 1;
  while (labels.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Valid C identifier from a Spanish label: 'LED rojo 1' → 'LED_ROJO_1'. */
export function toCIdentifier(label: string): string {
  const s = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return /^[0-9]/.test(s) ? `P_${s}` : s || 'PIN';
}
