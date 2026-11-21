/**
 * validateIR: structural + hardware validation of a Block IR (agent programs,
 * program errors panel). Spanish messages prefixed with the node path, e.g.
 *   "loop[1].body[0] (led): no existe el componente «led9»."
 * errors = the program cannot work as written; warnings = it runs but
 * something is off (unbound part, PWM on a non-PWM pin…).
 */
import type { BoardProfile, ProgramIR } from '@/contracts';
import { findPartDef } from '@/catalog';
import type { ProgramContext } from '../context';
import { ALL_BINOPS, ALL_MATHFNS, PART_KINDS, type PartKind } from './kinds';

type Obj = Record<string, unknown>;
type FieldSpec = 'expr' | 'expr?' | 'body' | 'body?' | 'name' | 'bool?' | 'pin' | 'part' | 'mode' | 'num' | 'boolv' | 'strv' | 'op' | 'fn';

const STMT_SPECS: Record<string, Record<string, FieldSpec>> = {
  pinMode: { pin: 'pin', mode: 'mode' },
  digitalWrite: { pin: 'pin', value: 'expr' },
  analogWrite: { pin: 'pin', value: 'expr' },
  tone: { pin: 'pin', freq: 'expr', ms: 'expr?' },
  noTone: { pin: 'pin' },
  delay: { ms: 'expr' },
  waitUntil: { cond: 'expr' },
  if: {},
  repeat: { times: 'expr', body: 'body' },
  while: { cond: 'expr', body: 'body', until: 'bool?' },
  for: { var: 'name', from: 'expr', to: 'expr', by: 'expr', body: 'body' },
  break: {},
  continue: {},
  call: { name: 'name' },
  set: { var: 'name', value: 'expr' },
  change: { var: 'name', delta: 'expr' },
  serialPrint: { value: 'expr', newline: 'bool?' },
  led: { part: 'part', on: 'expr' },
  ledBrightness: { part: 'part', percent: 'expr' },
  rgb: { part: 'part', r: 'expr', g: 'expr', b: 'expr' },
  buzzerTone: { part: 'part', freq: 'expr', ms: 'expr?' },
  buzzerOff: { part: 'part' },
  servo: { part: 'part', angle: 'expr' },
  motor: { part: 'part', speed: 'expr' },
  onboardLed: { on: 'expr' },
  onboardRgb: { r: 'expr', g: 'expr', b: 'expr' },
};

const EXPR_SPECS: Record<string, Record<string, FieldSpec>> = {
  num: { v: 'num' },
  bool: { v: 'boolv' },
  str: { v: 'strv' },
  var: { name: 'name' },
  bin: { op: 'op', a: 'expr', b: 'expr' },
  not: { a: 'expr' },
  neg: { a: 'expr' },
  math: { fn: 'fn', a: 'expr' },
  random: { min: 'expr', max: 'expr' },
  map: { value: 'expr', fromLow: 'expr', fromHigh: 'expr', toLow: 'expr', toHigh: 'expr' },
  constrain: { value: 'expr', low: 'expr', high: 'expr' },
  millis: {},
  digitalRead: { pin: 'pin' },
  analogRead: { pin: 'pin' },
  buttonPressed: { part: 'part' },
  buttonClicked: { part: 'part' },
  switchOn: { part: 'part' },
  potPercent: { part: 'part' },
  lightPercent: { part: 'part' },
  analogRaw: { part: 'part' },
};

const LOOP_KINDS = new Set(['repeat', 'while', 'for']);

/** What a non-GPIO board pin is, for "«RESET» no es un pin de señal (es …)". */
const PIN_KIND_TEXT: Record<string, string> = {
  ground: 'tierra',
  power: 'de alimentación',
  reset: 'el pin de reinicio',
  aref: 'la referencia analógica',
  nc: 'un pin sin conexión',
};
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

class Validator {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  private readonly declared = new Set<string>();
  private readonly autoDeclared = new Set<string>();
  private readonly functions = new Set<string>();
  private readonly warnedParts = new Set<string>();

  constructor(private readonly ctx: ProgramContext) {}

  private err(path: string, k: string | null, msg: string) {
    this.errors.push(`${path}${k ? ` (${k})` : ''}: ${msg}`);
  }

  private warn(path: string, k: string | null, msg: string) {
    this.warnings.push(`${path}${k ? ` (${k})` : ''}: ${msg}`);
  }

  run(ir: Obj): void {
    if (ir.version !== undefined && ir.version !== 1) this.warn('programa', null, `versión ${String(ir.version)} desconocida (se esperaba 1).`);
    const vars = ir.variables ?? [];
    if (!Array.isArray(vars)) this.err('variables', null, 'se esperaba una lista.');
    else
      vars.forEach((v, i) => {
        const path = `variables[${i}]`;
        if (!isObj(v) || typeof v.name !== 'string' || !v.name) return this.err(path, null, 'variable sin nombre.');
        if (this.declared.has(v.name)) this.err(path, null, `la variable «${v.name}» está declarada dos veces.`);
        if (v.type !== 'number' && v.type !== 'boolean') this.err(path, null, `tipo «${String(v.type)}» inválido (usa "number" o "boolean").`);
        if (v.init !== undefined && typeof v.init !== (v.type === 'boolean' ? 'boolean' : 'number')) {
          this.warn(path, null, `el valor inicial de «${v.name}» no coincide con su tipo.`);
        }
        this.declared.add(v.name);
      });

    const fns = ir.functions ?? [];
    if (!Array.isArray(fns)) this.err('functions', null, 'se esperaba una lista.');
    else {
      // Blockly compares procedure names ignoring case: «Parpadear» and «parpadear» would be renamed on load.
      const lower = new Map<string, string>();
      fns.forEach((f, i) => {
        if (!isObj(f) || typeof f.name !== 'string' || !f.name) return this.err(`functions[${i}]`, null, 'función sin nombre.');
        const first = lower.get(f.name.toLowerCase());
        if (this.functions.has(f.name)) this.err(`functions[${i}]`, null, `hay dos funciones llamadas «${f.name}».`);
        else if (first !== undefined) this.err(`functions[${i}]`, null, `hay dos funciones llamadas «${first}» y «${f.name}»: usa nombres distintos (mayúsculas y minúsculas cuentan como iguales).`);
        this.functions.add(f.name);
        if (first === undefined) lower.set(f.name.toLowerCase(), f.name);
      });
    }

    this.body(ir.setup, 'setup', 0, true);
    this.body(ir.loop, 'loop', 0, true);
    if (Array.isArray(fns)) fns.forEach((f, i) => isObj(f) && this.body(f.body, `functions[${i}].body`, 0, true));

    for (const name of this.autoDeclared) {
      this.warnings.push(`variables: «${name}» no está declarada; se declara automáticamente como número.`);
    }
  }

  private body(list: unknown, path: string, loopDepth: number, required: boolean): void {
    if (list === undefined && !required) return;
    if (!Array.isArray(list)) {
      this.err(path, null, 'se esperaba una lista de instrucciones.');
      return;
    }
    list.forEach((s, i) => this.stmt(s, `${path}[${i}]`, loopDepth));
  }

  private stmt(s: unknown, path: string, loopDepth: number): void {
    if (!isObj(s) || typeof s.k !== 'string') return this.err(path, null, 'instrucción inválida: falta «k».');
    const k = s.k;
    const spec = STMT_SPECS[k];
    if (!spec) {
      if (EXPR_SPECS[k]) return this.err(path, k, `«${k}» es un valor, no una instrucción.`);
      return this.err(path, k, `tipo de instrucción desconocido «${k}».`);
    }
    const inLoop = loopDepth + (LOOP_KINDS.has(k) ? 1 : 0);
    if ((k === 'break' || k === 'continue') && loopDepth === 0) this.err(path, k, 'solo se puede usar dentro de un bucle.');
    if (k === 'if') {
      if (!Array.isArray(s.branches) || s.branches.length === 0) this.err(path, k, 'falta «branches» (al menos una condición).');
      else
        s.branches.forEach((br, i) => {
          const bp = `${path}.branches[${i}]`;
          if (!isObj(br)) return this.err(bp, null, 'rama inválida.');
          this.exprField(br.cond, `${bp}.cond`, false);
          this.body(br.body, `${bp}.body`, loopDepth, true);
        });
      if (s.else !== undefined) this.body(s.else, `${path}.else`, loopDepth, true);
      return;
    }
    if (k === 'call' && typeof s.name === 'string' && !this.functions.has(s.name)) {
      this.err(path, k, `la función «${s.name}» no existe.`);
    }
    if ((k === 'for' || k === 'set' || k === 'change') && typeof s.var === 'string') this.useVar(s.var);
    if (k === 'onboardRgb' && this.ctx.board && !this.ctx.board.onboard.some((o) => o.kind === 'rgb-ws2812')) {
      this.warn(path, k, `${this.ctx.board.name} no tiene LED RGB integrado (se ignora).`);
    }
    if (k === 'onboardLed' && this.ctx.board && !this.ctx.board.onboard.some((o) => o.kind === 'led' || o.kind === 'rgb-ws2812')) {
      this.warn(path, k, `${this.ctx.board.name} no tiene LED integrado.`);
    }
    this.fields(s, spec, path, k, inLoop);
  }

  private fields(node: Obj, spec: Record<string, FieldSpec>, path: string, k: string, loopDepth: number): void {
    for (const [key, f] of Object.entries(spec)) {
      const v = node[key];
      const fp = `${path}.${key}`;
      switch (f) {
        case 'expr':
          if (v === undefined) this.err(path, k, `falta «${key}».`);
          else this.exprField(v, fp, k === 'serialPrint' && key === 'value');
          break;
        case 'expr?':
          if (v !== undefined) this.exprField(v, fp, false);
          break;
        case 'body':
          this.body(v, fp, loopDepth, true);
          break;
        case 'body?':
          this.body(v, fp, loopDepth, false);
          break;
        case 'name':
          if (typeof v !== 'string' || !v) this.err(path, k, `falta «${key}» (texto).`);
          break;
        case 'bool?':
          if (v !== undefined && typeof v !== 'boolean') this.err(path, k, `«${key}» debe ser true o false.`);
          break;
        case 'num':
          if (typeof v !== 'number' || !Number.isFinite(v)) this.err(path, k, `«${key}» debe ser un número.`);
          break;
        case 'boolv':
          if (typeof v !== 'boolean') this.err(path, k, `«${key}» debe ser true o false.`);
          break;
        case 'strv':
          if (typeof v !== 'string') this.err(path, k, `«${key}» debe ser texto.`);
          break;
        case 'op':
          if (!ALL_BINOPS.includes(v as never)) this.err(path, k, `operador «${String(v)}» desconocido.`);
          break;
        case 'fn':
          if (!ALL_MATHFNS.includes(v as never)) this.err(path, k, `función «${String(v)}» desconocida.`);
          break;
        case 'mode':
          if (v !== 'OUTPUT' && v !== 'INPUT' && v !== 'INPUT_PULLUP') this.err(path, k, `modo «${String(v)}» inválido (OUTPUT, INPUT o INPUT_PULLUP).`);
          break;
        case 'pin':
          this.pin(v, path, k);
          break;
        case 'part':
          this.part(v, path, k);
          break;
      }
    }
  }

  private exprField(e: unknown, path: string, allowStr: boolean): void {
    if (!isObj(e) || typeof e.k !== 'string') return this.err(path, null, 'valor inválido: falta «k».');
    const k = e.k;
    const spec = EXPR_SPECS[k];
    if (!spec) {
      if (STMT_SPECS[k]) return this.err(path, k, `«${k}» es una instrucción, no un valor.`);
      return this.err(path, k, `tipo de valor desconocido «${k}».`);
    }
    if (k === 'str' && !allowStr) this.err(path, k, 'el texto solo se puede usar en «imprimir».');
    if (k === 'var' && typeof e.name === 'string') this.useVar(e.name);
    for (const [key, f] of Object.entries(spec)) {
      const v = e[key];
      if (f === 'expr') {
        if (v === undefined) this.err(path, k, `falta «${key}».`);
        else this.exprField(v, `${path}.${key}`, false);
      } else {
        this.fields(e, { [key]: f }, path, k, 0);
      }
    }
  }

  private useVar(name: string): void {
    if (!this.declared.has(name)) this.autoDeclared.add(name);
  }

  private pin(v: unknown, path: string, k: string): void {
    if (typeof v !== 'string' || !v) return this.err(path, k, 'falta «pin».');
    const board: BoardProfile | null = this.ctx.board;
    if (!board) return this.err(path, k, `no hay placa: agrega una en la vista Hardware para usar el pin «${v}».`);
    const pin = board.pins.find((p) => p.id === v);
    if (!pin) return this.err(path, k, `el pin «${v}» no existe en ${board.name}.`);
    if (pin.kind !== 'gpio') return this.err(path, k, `«${v}» no es un pin de señal (es ${PIN_KIND_TEXT[pin.kind] ?? 'de alimentación'}).`);
    const canonical = pin.aliasOf ? board.pins.find((p) => p.id === pin.aliasOf) ?? pin : pin;
    if (pin.aliasOf) this.warn(path, k, `«${v}» es otro nombre de «${pin.aliasOf}»; usa «${pin.aliasOf}».`);
    const caps = canonical.caps ?? [];
    if (k === 'analogWrite' && !caps.includes('pwm')) this.warn(path, k, `el pin «${canonical.id}» no tiene PWM: solo quedará apagado (< 128) o encendido.`);
    if (k === 'analogRead' && !caps.includes('analog')) this.err(path, k, `el pin «${canonical.id}» no puede leer valores analógicos.`);
    if (caps.includes('usb')) this.warn(path, k, `el pin «${canonical.id}» se usa para el USB; evita usarlo.`);
  }

  private part(v: unknown, path: string, k: string): void {
    if (typeof v !== 'string' || !v) return this.err(path, k, 'falta «part» (id del componente).');
    const part = this.ctx.project.parts.find((p) => p.id === v);
    if (!part) return this.err(path, k, `no existe el componente «${v}».`);
    const def = findPartDef(part.type);
    if ((PART_KINDS as readonly string[]).includes(k) && !def?.blocks?.includes(k as PartKind)) {
      return this.err(path, k, `«${part.label}» (${def?.name ?? part.type}) no admite «${k}».`);
    }
    const bindings = this.ctx.bindings.filter((b) => b.part === v);
    if (this.ctx.board && !this.warnedParts.has(v) && (bindings.length === 0 || bindings.every((b) => b.boardPin === null))) {
      this.warnedParts.add(v);
      this.warn(path, k, `«${part.label}» no está conectado a ningún pin de la placa.`);
    }
  }
}

export function validateIR(ir: ProgramIR, ctx: ProgramContext): { errors: string[]; warnings: string[] } {
  const v = new Validator(ctx);
  if (!isObj(ir)) return { errors: ['programa: debe ser un objeto con «setup» y «loop».'], warnings: [] };
  try {
    v.run(ir as unknown as Obj);
  } catch (e) {
    v.errors.push(`programa: no se pudo validar (${e instanceof Error ? e.message : String(e)}).`);
  }
  return { errors: v.errors, warnings: v.warnings };
}
