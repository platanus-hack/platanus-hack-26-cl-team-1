/**
 * Active-board helpers: the FIRST mcu part of the project is the powered board
 * (catalog projectBoard semantics); any other board is unpowered.
 */
import type { BoardPin, BoardProfile, PartInstance } from '@/contracts';
import { getBoardProfile } from '@/catalog';
import type { PartRec, Topology } from './topology';

export interface ActiveBoard {
  rec: PartRec;
  part: PartInstance;
  profile: BoardProfile;
  /** pin id → BoardPin (aliases included). */
  pins: Map<string, BoardPin>;
  /** First ground pin id (the solver reference), null if the profile has none. */
  gndPin: string | null;
  /** Canonical rail pin ids (supply.rails). */
  rails: Set<string>;
  /** Canonical pin id (aliasOf resolved). Unknown ids are returned unchanged. */
  canonical: (id: string) => string;
}

export function boardProfileOf(rec: PartRec): BoardProfile | null {
  const el = rec.def.electrical;
  if (el.model !== 'mcu') return null;
  try {
    return getBoardProfile(el.board);
  } catch {
    return null;
  }
}

export function boardRecs(topo: Topology): PartRec[] {
  return topo.parts.filter((p) => p.board);
}

const cache = new WeakMap<Topology, ActiveBoard | null>();

export function activeBoard(topo: Topology): ActiveBoard | null {
  if (cache.has(topo)) return cache.get(topo) ?? null;
  let result: ActiveBoard | null = null;
  for (const rec of topo.parts) {
    if (!rec.board) continue;
    const profile = boardProfileOf(rec);
    if (!profile) continue;
    const pins = new Map(profile.pins.map((p) => [p.id, p] as const));
    const canonical = (id: string) => pins.get(id)?.aliasOf ?? id;
    result = {
      rec,
      part: rec.part,
      profile,
      pins,
      gndPin: profile.pins.find((p) => p.kind === 'ground')?.id ?? null,
      rails: new Set(profile.supply.rails.map((r) => canonical(r.pin))),
      canonical,
    };
    break;
  }
  cache.set(topo, result);
  return result;
}

/** Canonical GPIO pins of a profile (aliases skipped), in profile order. */
export function canonicalGpios(profile: BoardProfile): BoardPin[] {
  return profile.pins.filter((p) => p.kind === 'gpio' && !p.aliasOf);
}
