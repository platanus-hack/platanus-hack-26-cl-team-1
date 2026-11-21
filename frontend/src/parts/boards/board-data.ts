/**
 * Board pin data for the renderers: positions come from the resolved PartDef
 * (def.pins, generated from the board profile), silkscreen labels and
 * capabilities (PWM "~") from the BoardProfile itself.
 */
import type { BoardPin, BoardProfile, PartDef } from '@/contracts';
import { allBoards } from '@/catalog';

export interface BoardPinView {
  id: string;
  x: number;
  y: number;
  /** Silkscreen text exactly as in the board profile ('' = unlabeled, e.g. the Uno NC pin). */
  label: string;
  header: string;
  kind: BoardPin['kind'] | 'unknown';
  pwm: boolean;
}

export function findBoardProfile(def: PartDef): BoardProfile | undefined {
  if (!def.board) return undefined;
  return allBoards().find((b) => b.id === def.board);
}

const cache = new WeakMap<PartDef, BoardPinView[]>();

/** Merged pin views for a board PartDef (memoized per def object). Never throws. */
export function boardPinViews(def: PartDef): BoardPinView[] {
  const hit = cache.get(def);
  if (hit) return hit;
  const profile = findBoardProfile(def);
  const byId = new Map<string, BoardPin>((profile?.pins ?? []).map((p) => [p.id, p]));
  const out: BoardPinView[] = def.pins.map((p) => {
    const bp = byId.get(p.id);
    return {
      id: p.id,
      x: p.x,
      y: p.y,
      label: bp ? bp.label : p.label,
      header: bp?.header ?? '',
      kind: bp?.kind ?? 'unknown',
      pwm: bp?.caps?.includes('pwm') ?? false,
    };
  });
  cache.set(def, out);
  return out;
}

/** Uno-style silkscreen: PWM pins get a "~" prefix. */
export function unoSilkLabel(p: BoardPinView): string {
  if (!p.label) return '';
  return p.pwm ? `~${p.label}` : p.label;
}
