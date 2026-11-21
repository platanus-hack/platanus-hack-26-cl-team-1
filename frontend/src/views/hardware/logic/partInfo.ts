/**
 * Safe, render-friendly lookups about parts and pins (never throw).
 */
import type { Id, PartDef, PartInstance, PinDef, PinRef, ProjectModel, PropValue, Point } from '@/contracts';
import { findPartDef } from '@/catalog';
import { parsePinRef } from '@/lib/pinref';
import { localToWorld } from '@/lib/geometry';

export const safeDef = (type: string): PartDef | undefined => findPartDef(type);

/** Z layer used to keep breadboards under boards and boards under components. */
export type PartLayer = 0 | 1 | 2;
export function partLayer(def: PartDef): PartLayer {
  if (def.electrical.model === 'bus') return 0;
  if (def.electrical.model === 'mcu') return 1;
  return 2;
}

export const isBoard = (def: PartDef | undefined): boolean => !!def && def.electrical.model === 'mcu';
export const isBreadboard = (def: PartDef | undefined): boolean => !!def && def.electrical.model === 'bus';

/** The runtime prop driven by direct manipulation of an interactive part. */
export function interactiveKey(def: PartDef): string | null {
  const e = def.electrical;
  if (e.model === 'switch') return e.stateProp;
  if (e.model === 'potentiometer') return e.positionProp;
  if (e.model === 'ldr') return e.lightProp;
  return def.props.find((p) => p.runtime)?.key ?? null;
}

/** Effective value: live runtime override → instance prop → PartDef default. */
export function effectiveProp(
  part: PartInstance,
  def: PartDef,
  runtime: Record<string, PropValue> | undefined,
  key: string,
): PropValue | undefined {
  if (runtime && key in runtime) return runtime[key];
  if (key in part.props) return part.props[key];
  return def.props.find((p) => p.key === key)?.default;
}

/** Bounds of a part in world coordinates (axis aligned), or null for unknown types. */
export function safeWorldBounds(part: PartInstance): { x: number; y: number; w: number; h: number } | null {
  const def = findPartDef(part.type);
  if (!def) return null;
  const b = def.bounds;
  const corners: Point[] = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ].map((c) => localToWorld(part, c));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Bounds of the whole project with padding (safe version of lib/geometry projectBounds). */
export function safeProjectBounds(project: ProjectModel, pad = 4): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const part of project.parts) {
    const b = safeWorldBounds(part);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) return { x: -pad, y: -pad, w: 60 + 2 * pad, h: 30 + 2 * pad };
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

export interface PinInfo {
  ref: PinRef;
  part?: PartInstance;
  def?: PartDef;
  pin?: PinDef;
  /** 'LED 1' */
  partLabel: string;
  /** 'Ánodo (+)' / 'e10' */
  pinLabel: string;
}

/** Human labels for a pin reference. */
export function describePin(project: ProjectModel, ref: PinRef): PinInfo {
  const { part: partId, pin: pinId } = parsePinRef(ref);
  const part = project.parts.find((p) => p.id === partId);
  const def = part ? findPartDef(part.type) : undefined;
  const pin = def?.pins.find((p) => p.id === pinId);
  let pinLabel = pin?.label ?? pinId;
  if (def && isBreadboard(def)) pinLabel = holeLabel(pinId);
  return { ref, part, def, pin, partLabel: part?.label ?? partId, pinLabel };
}

/** Compact hole label: 'e10', 'Riel + sup. 3'. */
export function holeLabel(id: string): string {
  const m = /^([TB])([+-])(\d{1,2})$/.exec(id);
  if (m) return `Riel ${m[2] === '+' ? '+' : '−'} ${m[1] === 'T' ? 'sup.' : 'inf.'} ${m[3]}`;
  return id;
}

/** Find a part by id. */
export const findPart = (project: ProjectModel, id: Id): PartInstance | undefined => project.parts.find((p) => p.id === id);
