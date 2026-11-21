/**
 * Option lists of the dynamic dropdowns (pure functions — tested without
 * Blockly). Rules: the current value is ALWAYS part of the list (shown as
 * "(falta) led2" when it no longer exists) so loading a program never rewrites
 * its references; lists are never empty.
 */
import type { BoardPin, BoardProfile, PartInstance } from '@/contracts';
import { findPartDef } from '@/catalog';
import type { ProgramContext } from '../context';
import type { PartKind, PinFilter } from './kinds';

export type Option = [string, string];

export const missingLabel = (value: string) => `(falta) ${value}`;

/** Parts of the project whose PartDef enables the IR node `kind`. */
export function partsForKind(parts: readonly PartInstance[], kind: PartKind): PartInstance[] {
  return parts.filter((p) => findPartDef(p.type)?.blocks?.includes(kind));
}

export function partOptions(ctx: ProgramContext | null, kind: PartKind, current: string | null): Option[] {
  const parts = ctx ? partsForKind(ctx.project.parts, kind) : [];
  const labelCount = new Map<string, number>();
  for (const p of parts) labelCount.set(p.label, (labelCount.get(p.label) ?? 0) + 1);
  const opts: Option[] = parts.map((p) => [(labelCount.get(p.label) ?? 0) > 1 ? `${p.label} (${p.id})` : p.label || p.id, p.id]);
  if (current && !opts.some((o) => o[1] === current)) opts.unshift([missingLabel(current), current]);
  if (opts.length === 0) opts.push(['(sin componentes)', '']);
  return opts;
}

/** Canonical GPIO pins of a board that match a capability filter (aliases and USB pins skipped). */
export function pinsForFilter(board: BoardProfile, filter: PinFilter): BoardPin[] {
  return board.pins.filter((p) => {
    if (p.kind !== 'gpio' || p.aliasOf) return false;
    const caps = p.caps ?? [];
    if (caps.includes('usb')) return false;
    return caps.includes(filter);
  });
}

const EXTRA_CAP_LABELS: Array<[string, string]> = [
  ['uart-tx', 'TX'],
  ['uart-rx', 'RX'],
  ['i2c-sda', 'SDA'],
  ['i2c-scl', 'SCL'],
  ['onboard-led', 'LED'],
];

/** Friendly dropdown text of a board pin: "~9", "A0", "13 (LED)", "GPIO16 (TX)". */
export function pinText(board: BoardProfile, pin: BoardPin): string {
  const caps = pin.caps ?? [];
  const isUno = board.id === 'uno';
  const base = isUno ? (pin.codeName ?? pin.label ?? pin.id) : pin.gpio !== undefined ? `GPIO${pin.gpio}` : pin.id;
  const tilde = isUno && caps.includes('pwm') ? '~' : '';
  const extras = EXTRA_CAP_LABELS.filter(([cap]) => caps.includes(cap as never)).map(([, l]) => l);
  return `${tilde}${base}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

export function pinOptions(board: BoardProfile | null, filter: PinFilter, current: string | null): Option[] {
  const opts: Option[] = board ? pinsForFilter(board, filter).map((p) => [pinText(board, p), p.id]) : [];
  if (current && !opts.some((o) => o[1] === current)) {
    const known = board?.pins.find((p) => p.id === current);
    // An alias (SDA) or a pin of another capability still shows its friendly name.
    let text = missingLabel(current);
    if (board && known?.aliasOf) text = `${known.id} (= ${known.aliasOf})`;
    else if (board && known?.kind === 'gpio') text = `${pinText(board, known)} (no compatible)`;
    opts.unshift([text, current]);
  }
  if (opts.length === 0) opts.push([board ? '(sin pines)' : '(sin placa)', '']);
  return opts;
}

/** First valid value of a list (used as toolbox default), or null. */
export const firstValue = (opts: Option[]): string | null => opts.find((o) => o[1] !== '')?.[1] ?? null;
