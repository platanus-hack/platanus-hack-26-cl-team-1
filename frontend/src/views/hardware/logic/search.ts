import { CATEGORY_LABELS, type PartDef } from '@/contracts';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Palette search: every term must appear in name, description, type or category (accent-insensitive). */
export function filterDefs(defs: PartDef[], query: string): PartDef[] {
  const q = normalize(query.trim());
  if (!q) return defs;
  const terms = q.split(/\s+/);
  return defs.filter((d) => {
    const hay = normalize(`${d.name} ${d.description} ${d.type} ${CATEGORY_LABELS[d.category]}`);
    return terms.every((t) => hay.includes(t));
  });
}
