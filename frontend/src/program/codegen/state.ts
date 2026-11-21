/** Mutable state of one generateCode run. */
import type { BoardProfile, CodegenResult, Id, ProgramIR } from '@/contracts';
import type { ProgramContext } from '../context';
import { Emitter } from './emitter';
import type { HelperId } from './helpers';
import { NameRegistry } from './names';
import { partLabel, type SetupPlan } from './shared';

export interface GenState {
  ir: ProgramIR;
  ctx: ProgramContext;
  board: BoardProfile | null;
  plan: SetupPlan;
  /** Canonical pins written with PWM somewhere in the program. */
  pwmPins: Set<string>;
  names: NameRegistry;
  /** IR variable name → C identifier + type. */
  vars: Map<string, { c: string; type: 'number' | 'boolean' }>;
  /** IR function name → C identifier. */
  functions: Map<string, string>;
  /** `${part}|${channel}` → pin constant name. */
  partConsts: Map<string, string>;
  servoObjects: Map<Id, string>;
  clickedHelpers: Map<Id, string>;
  helpers: Set<HelperId>;
  warnings: CodegenResult['warnings'];
  warnKeys: Set<string>;
  /** Comment lines produced while emitting expressions, flushed before the statement. */
  pending: string[];
  loopDepth: number;
  /** Block-local names currently in scope (loop counters, for bounds). */
  locals: Set<string>;
  out: Emitter;
  /** Nearest block id of the statement being emitted. */
  blockId: string | undefined;
}

export const constKey = (part: Id, channel?: string) => `${part}|${channel ?? ''}`;

export function warn(g: GenState, message: string, opts: { blockId?: string; part?: Id } = {}): void {
  const key = `${message}|${opts.blockId ?? ''}`;
  if (g.warnKeys.has(key)) return;
  g.warnKeys.add(key);
  const w: CodegenResult['warnings'][number] = { message };
  if (opts.blockId) w.blockId = opts.blockId;
  if (opts.part) w.part = opts.part;
  g.warnings.push(w);
}

/** Standard warning + comment text for a part with no board pin. */
export function unboundPart(g: GenState, part: Id, blockId: string | undefined, channel?: string): string {
  const label = partLabel(g.ctx, part);
  const exists = g.ctx.project.parts.some((p) => p.id === part);
  const what = channel ? `El canal ${channel.toUpperCase()} de «${label}»` : `«${label}»`;
  if (!exists) {
    warn(g, `El programa usa «${part}», pero ese componente ya no está en el circuito.`, { blockId, part });
    return `// ⚠ ${label} no está en el circuito`;
  }
  warn(g, `${what} no está conectado a ningún pin de la placa: ese bloque no hará nada hasta que lo conectes.`, { blockId, part });
  return channel ? `// ⚠ ${label} (canal ${channel.toUpperCase()}) no está conectado a un pin` : `// ⚠ ${label} no está conectado a un pin`;
}

export function flushPending(g: GenState, id: string | undefined): void {
  for (const c of g.pending) g.out.line(c, id);
  g.pending = [];
}
