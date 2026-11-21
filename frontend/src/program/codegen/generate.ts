/** Block IR → Arduino C++ sketch (Uno / ESP32-C6 core 3.x). */
import type { Binding, CodegenResult, ProgramIR } from '@/contracts';
import { toCIdentifier } from '@/lib/ids';
import type { ProgramContext } from '../context';
import { Emitter } from './emitter';
import { numLit } from './expr';
import { clickedHelperSource, HELPER_ORDER, helperSource } from './helpers';
import { lowerCamel, NameRegistry, sanitizeIdentifier } from './names';
import { cleanText, collectVariables, partLabel, pinDisplay, planSetup, pwmPins, resolveBoard, resolvePart, type PinSetup } from './shared';
import { constKey, warn, type GenState } from './state';
import { emitBlock } from './stmt';
import { isEmptyProgram } from './walk';

const SECTION = (title: string) => `// ── ${title} ${'─'.repeat(Math.max(4, 60 - title.length))}`;

function createState(ir: ProgramIR, ctx: ProgramContext): GenState {
  const board = resolveBoard(ir, ctx);
  return {
    ir,
    ctx,
    board,
    plan: planSetup(ir, ctx, board),
    pwmPins: pwmPins(ir, ctx, board),
    names: new NameRegistry(),
    vars: new Map(),
    functions: new Map(),
    partConsts: new Map(),
    servoObjects: new Map(),
    clickedHelpers: new Map(),
    helpers: new Set(),
    warnings: [],
    warnKeys: new Set(),
    pending: [],
    loopDepth: 0,
    locals: new Set(),
    out: new Emitter(),
    blockId: undefined,
  };
}

/** Bound bindings of a part, one per channel, in a stable order. */
function boundBindings(ctx: ProgramContext, part: string): Binding[] {
  const seen = new Set<string>();
  const order = ['', 'r', 'g', 'b'];
  return ctx.bindings
    .filter((b) => b.part === part && b.boardPin && !seen.has(b.channel ?? '') && seen.add(b.channel ?? ''))
    .sort((a, b) => order.indexOf(a.channel ?? '') - order.indexOf(b.channel ?? ''));
}

function allocateNames(g: GenState): void {
  for (const u of g.plan.parts) {
    const label = findLabel(g, u.part);
    for (const b of boundBindings(g.ctx, u.part)) {
      const base = toCIdentifier(label) + (b.channel ? `_${b.channel.toUpperCase()}` : '');
      g.partConsts.set(constKey(u.part, b.channel), g.names.claim(base));
    }
  }
  for (const s of g.plan.servos) g.servoObjects.set(s.part, g.names.claim(lowerCamel(findLabel(g, s.part), 'servo')));
  for (const u of g.plan.parts) {
    const c = g.partConsts.get(constKey(u.part));
    if (u.kinds.has('buttonClicked') && c) g.clickedHelpers.set(u.part, g.names.claim(`clicked_${c}`));
  }
  for (const f of g.ir.functions ?? []) {
    if (f && typeof f.name === 'string' && !g.functions.has(f.name)) g.functions.set(f.name, g.names.claim(sanitizeIdentifier(f.name, 'funcion')));
  }
  for (const v of collectVariables(g.ir)) g.vars.set(v.name, { c: g.names.claim(sanitizeIdentifier(v.name, 'valor')), type: v.type });
}

const findLabel = (g: GenState, part: string) => partLabel(g.ctx, part);

function viaText(g: GenState, b: Binding): string {
  return b.via.length ? ` (a través de ${b.via.map((v) => partLabel(g.ctx, v)).join(', ')})` : '';
}

function emitHeader(g: GenState, out: Emitter): void {
  const name = cleanText(g.ctx.project.name || 'Mi proyecto');
  out.line(`// Circuito Vivo — ${name} — ${g.board?.name ?? 'sin placa'}`);
  if (!g.board) {
    out.line('// ⚠ No hay ninguna placa en el circuito: agrega un Arduino Uno o un ESP32-C6.');
    warn(g, 'No hay ninguna placa en el circuito: el código usa nombres de pin genéricos.');
  }
  const listed = new Set<string>();
  for (const part of g.ctx.project.parts) {
    const bs = boundBindings(g.ctx, part.id);
    if (bs.length === 0) continue;
    listed.add(part.id);
    const label = partLabel(g.ctx, part.id);
    const text =
      bs.length === 1 && !bs[0].channel
        ? `${pinDisplay(g.board, bs[0].boardPin!)}${viaText(g, bs[0])}`
        : bs.map((b) => `${(b.channel ?? '').toUpperCase()}: ${pinDisplay(g.board, b.boardPin!)}${viaText(g, b)}`).join(', ');
    out.line(`// ${label} → ${text}`);
  }
  for (const id of g.plan.unboundParts) {
    if (!listed.has(id)) out.line(`// ${partLabel(g.ctx, id)} → ⚠ sin conectar`);
  }
}

function emitDeclarations(g: GenState, out: Emitter): void {
  if (g.board && g.servoObjects.size > 0) {
    out.blank();
    out.line(`#include <${g.board.libraries.servoInclude}>`);
  }

  if (g.partConsts.size > 0) {
    out.blank();
    out.line(SECTION('Pines (según tus conexiones)'));
    for (const u of g.plan.parts) {
      for (const b of boundBindings(g.ctx, u.part)) {
        const c = g.partConsts.get(constKey(u.part, b.channel));
        const r = resolvePart(g.ctx, g.board, u.part, b.channel);
        if (!c || !r) continue;
        const label = findLabel(g, u.part) + (b.channel ? ` (${b.channel.toUpperCase()})` : '');
        out.line(`const int ${c} = ${r.codeName};`, undefined, label);
      }
    }
  }

  if (g.servoObjects.size > 0) {
    out.blank();
    out.line(SECTION('Servos'));
    for (const [part, obj] of g.servoObjects) out.line(`Servo ${obj};`, undefined, findLabel(g, part));
  }

  if (g.vars.size > 0) {
    out.blank();
    out.line(SECTION('Variables'));
    for (const v of collectVariables(g.ir)) {
      const c = g.vars.get(v.name)!;
      if (v.type === 'boolean') out.line(`bool ${c.c} = ${v.init ? 'true' : 'false'};`);
      else out.line(`double ${c.c} = ${numLit(Number(v.init)).code};`);
    }
  }
}

function emitHelpers(g: GenState, out: Emitter): void {
  const blocks: string[][] = [];
  for (const id of HELPER_ORDER) if (g.helpers.has(id)) blocks.push(helperSource(id, g.board));
  for (const [part, fn] of g.clickedHelpers) {
    const r = resolvePart(g.ctx, g.board, part);
    const c = g.partConsts.get(constKey(part));
    if (r && c) blocks.push(clickedHelperSource(fn, c, r.binding.activeLow, findLabel(g, part)));
  }
  if (blocks.length === 0) return;
  out.blank();
  out.line(SECTION('Funciones de ayuda (generadas automáticamente)'));
  blocks.forEach((b, i) => {
    if (i > 0) out.blank();
    for (const l of b) out.line(l);
  });
}

function setupComment(g: GenState, p: PinSetup): string {
  const where = p.part ? findLabel(g, p.part) + (p.channel ? ` (${p.channel.toUpperCase()})` : '') : p.reason === 'onboard' ? 'LED integrado' : pinDisplay(g.board, p.boardPin);
  if (p.reason === 'auto') return `${where}: salida (agregado automáticamente)`;
  if (p.mode === 'INPUT_PULLUP') return `${where}: entrada con resistencia pull-up interna`;
  return `${where}: ${p.mode === 'OUTPUT' ? 'salida' : 'entrada'}`;
}

/** Implicit setup lines (Serial.begin, pinMode, servo.attach) — see contracts/ir.ts. */
function emitImplicitSetup(g: GenState, out: Emitter): void {
  const rows: Array<{ code: string; comment: string; id?: string }> = [];
  if (g.plan.serial && g.board) {
    rows.push({ code: `Serial.begin(${g.board.serial.baud});`, comment: `abre el Monitor Serie a ${g.board.serial.baud} baudios` });
  }
  for (const p of g.plan.pinModes) {
    const pin = p.part ? (g.partConsts.get(constKey(p.part, p.channel)) ?? p.codeName) : p.codeName;
    rows.push({ code: `pinMode(${pin}, ${p.mode});`, comment: setupComment(g, p), id: p.blockId });
    if (p.reason === 'auto') {
      const name = pinDisplay(g.board, p.boardPin);
      warn(g, `El ${name} se usa como salida, pero ningún bloque «configurar pin» lo configura: se agregó pinMode(${p.codeName}, OUTPUT) automáticamente.`, { blockId: p.blockId });
    }
  }
  for (const s of g.plan.servos) {
    const obj = g.servoObjects.get(s.part);
    const c = g.partConsts.get(constKey(s.part)) ?? s.codeName;
    if (obj) rows.push({ code: `${obj}.attach(${c});`, comment: `conecta ${findLabel(g, s.part)} a su pin`, id: s.blockId });
  }
  if (rows.length === 0) return;
  out.line('// Configuración automática según tu circuito');
  for (const r of rows) out.line(r.code, r.id, r.comment);
}

function emitFunction(g: GenState, signature: string, id: string | undefined, body: () => void): Emitter {
  const out = new Emitter();
  g.out = out;
  g.loopDepth = 0;
  g.locals = new Set();
  out.line(`${signature} {`, id);
  out.indent();
  body();
  out.dedent();
  out.line('}', id);
  return out;
}

export function generateCode(ir: ProgramIR, ctx: ProgramContext): CodegenResult {
  const g = createState(ir, ctx);
  allocateNames(g);
  const empty = isEmptyProgram(ir);

  const setupFn = emitFunction(g, 'void setup()', undefined, () => {
    emitImplicitSetup(g, g.out);
    if ((ir.setup ?? []).length) {
      if (g.out.lines.length > 1) g.out.blank();
      emitBlock(g, ir.setup);
    } else if (empty) g.out.line('// Agrega bloques en «al iniciar»: se ejecutan una sola vez');
  });
  const loopFn = emitFunction(g, 'void loop()', undefined, () => {
    if ((ir.loop ?? []).length) emitBlock(g, ir.loop);
    else g.out.line('// Agrega bloques en «repetir para siempre»: se ejecutan una y otra vez');
  });
  const fnDefs: Emitter[] = [];
  const done = new Set<string>();
  for (const f of ir.functions ?? []) {
    if (!f || done.has(f.name)) continue;
    done.add(f.name);
    const name = g.functions.get(f.name)!;
    fnDefs.push(emitFunction(g, `void ${name}()`, f.id, () => emitBlock(g, f.body)));
  }

  const out = new Emitter();
  emitHeader(g, out);
  emitDeclarations(g, out);
  emitHelpers(g, out);
  if (g.functions.size > 0) {
    out.blank();
    out.line(SECTION('Tus funciones'));
    for (const name of g.functions.values()) out.line(`void ${name}();`);
  }
  out.blank();
  out.append(setupFn);
  out.blank();
  out.append(loopFn);
  for (const f of fnDefs) {
    out.blank();
    out.append(f);
  }
  return { code: out.toString(), lineMap: out.lineMap, warnings: g.warnings };
}
