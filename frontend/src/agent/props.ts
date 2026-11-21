/**
 * Validate / coerce part props coming from the model against the PartDef
 * ("220" → 220 for numeric enums, "rojo" → "red" by Spanish label).
 */
import type { PartDef, PropValue } from '@/contracts';

export type PropsResult = { props: Record<string, PropValue> } | { error: string };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export function normalizeProps(def: PartDef, raw: Record<string, unknown> | undefined): PropsResult {
  const props: Record<string, PropValue> = {};
  if (!raw) return { props };
  for (const [key, value] of Object.entries(raw)) {
    const pd = def.props.find((p) => p.key === key);
    if (!pd) {
      const valid = def.props.map((p) => p.key);
      return {
        error: valid.length
          ? `«${def.name}» no tiene la propiedad «${key}». Propiedades válidas: ${valid.join(', ')}.`
          : `«${def.name}» no tiene propiedades configurables.`,
      };
    }
    if (pd.type === 'enum') {
      const opts = pd.options ?? [];
      const hit =
        opts.find((o) => o.value === value) ??
        opts.find((o) => String(o.value) === String(value)) ??
        (typeof value === 'string' ? opts.find((o) => norm(o.label) === norm(value)) : undefined);
      if (!hit) {
        return { error: `Valor inválido para «${key}» de ${def.name}: ${JSON.stringify(value)}. Opciones: ${opts.map((o) => String(o.value)).join(', ')}.` };
      }
      props[key] = hit.value;
    } else if (pd.type === 'number') {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
      if (!Number.isFinite(n)) return { error: `«${key}» de ${def.name} debe ser un número.` };
      if ((pd.min !== undefined && n < pd.min) || (pd.max !== undefined && n > pd.max)) {
        return { error: `«${key}» de ${def.name} debe estar entre ${pd.min ?? '−∞'} y ${pd.max ?? '∞'}.` };
      }
      props[key] = n;
    } else {
      if (typeof value === 'boolean') props[key] = value;
      else if (value === 'true' || value === 'false') props[key] = value === 'true';
      else return { error: `«${key}» de ${def.name} debe ser true o false.` };
    }
  }
  return { props };
}
