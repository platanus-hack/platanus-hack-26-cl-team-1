/**
 * Per-block warnings shown on the editor's blocks (Blockly warning icon):
 * part not wired to the board, part removed, pin missing on this board.
 */
import type { PartDef } from '@/contracts';
import { findPartDef } from '@/catalog';
import type { ProgramContext } from '../context';
import { BLOCK_PART_KIND, BLOCK_PIN_FILTER, B } from './kinds';

const CHANNEL_NAMES: Record<string, string> = { r: 'rojo', g: 'verde', b: 'azul' };

/** "LED" stays, "Botón" → "botón". */
function lowerName(def: PartDef | undefined, fallback: string): string {
  const name = def?.name ?? fallback;
  return /^[A-ZÁÉÍÓÚÑ0-9 ]+$/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
}

/** Part types whose Spanish name is feminine ("la fotorresistencia", "la resistencia", "la batería"). */
const FEMININE_TYPES = new Set(['ldr', 'resistor', 'battery-9v', 'breadboard-half']);

/** "Este LED … conectado" / "Esta fotorresistencia … conectada". */
const gender = (type: string) => (FEMININE_TYPES.has(type) ? { este: 'Esta', esteLow: 'esta', o: 'a' } : { este: 'Este', esteLow: 'este', o: 'o' });

/** Warning for a block referencing part `partId`, or null. */
export function partWarning(ctx: ProgramContext, partId: string): string | null {
  if (!partId) return 'Elige un componente en la lista.';
  const part = ctx.project.parts.find((p) => p.id === partId);
  if (!part) return `El componente «${partId}» ya no está en el circuito. Elige otro o agrégalo en la vista Hardware.`;
  if (!ctx.board) return 'Agrega una placa en la vista Hardware para controlar este componente.';
  const def = findPartDef(part.type);
  const name = lowerName(def, part.type);
  const gn = gender(part.type);
  const bindings = ctx.bindings.filter((b) => b.part === partId);
  if (bindings.length === 0 || bindings.every((b) => b.boardPin === null)) {
    return `${gn.este} ${name} no está conectad${gn.o} a ningún pin de la placa`;
  }
  const missing = bindings.filter((b) => b.boardPin === null && b.channel).map((b) => CHANNEL_NAMES[b.channel!] ?? b.channel!);
  if (missing.length) return `El canal ${missing.join(', ')} de ${gn.esteLow} ${name} no está conectado a la placa`;
  return null;
}

export function pinWarning(ctx: ProgramContext, pinId: string): string | null {
  if (!ctx.board) return 'Agrega una placa en la vista Hardware para usar los pines.';
  if (!pinId) return 'Elige un pin en la lista.';
  const pin = ctx.board.pins.find((p) => p.id === pinId);
  if (!pin) return `El pin «${pinId}» no existe en ${ctx.board.name}. Elige otro pin.`;
  return null;
}

export interface WarnableBlock {
  id: string;
  type: string;
  getFieldValue(name: string): unknown;
}

/** Warning text for every block that needs one (others map to null). */
export function computeBlockWarnings(blocks: Iterable<WarnableBlock>, ctx: ProgramContext): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const b of blocks) {
    if (BLOCK_PART_KIND[b.type]) {
      out.set(b.id, partWarning(ctx, String(b.getFieldValue('PART') ?? '')));
    } else if (BLOCK_PIN_FILTER[b.type] || b.type === B.digitalRead || b.type === B.analogRead) {
      out.set(b.id, pinWarning(ctx, String(b.getFieldValue('PIN') ?? '')));
    } else if (b.type === B.onboardRgb && ctx.board && !ctx.board.onboard.some((o) => o.kind === 'rgb-ws2812')) {
      out.set(b.id, `${ctx.board.name} no tiene LED RGB integrado: este bloque no hace nada.`);
    } else if ((b.type === B.onboardLed || b.type === B.onboardRgb) && !ctx.board) {
      out.set(b.id, 'Agrega una placa en la vista Hardware.');
    } else {
      out.set(b.id, null);
    }
  }
  return out;
}
