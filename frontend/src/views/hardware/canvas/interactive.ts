/**
 * Direct manipulation of interactive parts (buttons, switches, knobs, LDRs).
 * Values live in the sim store's runtime overrides, never in the project.
 */
import type { Id, PropValue } from '@/contracts';
import { findPartDef } from '@/catalog';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { effectiveProp, interactiveKey } from '../logic/partInfo';

export type InteractMode = 'press' | 'toggle' | 'knob' | 'light';

export function runtimeValue(partId: Id, key: string): PropValue | undefined {
  const part = useProject.getState().project.parts.find((p) => p.id === partId);
  const def = part && findPartDef(part.type);
  if (!part || !def) return undefined;
  return effectiveProp(part, def, useSim.getState().runtime[partId], key);
}

export function setRuntime(partId: Id, key: string, value: PropValue): void {
  useSim.getState().setRuntime(partId, key, value);
}

/** Flip a toggle prop: boolean → !v, 'a' ↔ 'b'. */
export function flipToggle(partId: Id, key: string): void {
  const cur = runtimeValue(partId, key);
  const next: PropValue = typeof cur === 'boolean' ? !cur : cur === 'b' ? 'a' : 'b';
  setRuntime(partId, key, next);
}

export function numericRuntime(partId: Id, key: string, fallback = 50): number {
  const v = runtimeValue(partId, key);
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export const clamp01 = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

/** Adjust a 0..100 knob/light value by `delta`. */
export function bumpRuntime(partId: Id, key: string, delta: number): void {
  setRuntime(partId, key, clamp01(numericRuntime(partId, key) + delta));
}

/** Interaction mode + prop key of a part's body (null if not interactive). */
export function bodyInteraction(partId: Id): { mode: InteractMode; key: string } | null {
  const part = useProject.getState().project.parts.find((p) => p.id === partId);
  const def = part && findPartDef(part.type);
  if (!def?.interactive) return null;
  const key = interactiveKey(def);
  return key ? { mode: def.interactive, key } : null;
}

/** Mode for a tagged actuator element: the part's interactive kind, or inferred from the prop type. */
export function actuatorInteraction(partId: Id, key: string): InteractMode | null {
  const part = useProject.getState().project.parts.find((p) => p.id === partId);
  const def = part && findPartDef(part.type);
  if (!def) return null;
  if (def.interactive) return def.interactive;
  const prop = def.props.find((p) => p.key === key);
  if (!prop) return null;
  if (prop.type === 'boolean') return 'press';
  if (prop.type === 'enum') return 'toggle';
  return 'knob';
}
