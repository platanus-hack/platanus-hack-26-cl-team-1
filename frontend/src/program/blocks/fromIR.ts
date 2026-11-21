/**
 * irToWorkspace: Block IR → Blockly JSON serialization (inverse of
 * workspaceToIR). Accepts loose input (agent tool calls): missing
 * variables/functions default to [], referenced-but-undeclared variables are
 * auto-declared, invalid nodes are skipped and reported in `errors`.
 *
 * Stable ids: every block gets node.id, or a deterministic id derived from the
 * node path ("p:loop.0.body.1"), so workspaceToIR(irToWorkspace(ir)) returns
 * the same ids.
 */
import type { BinOp, MathFn, ProgramIR } from '@/contracts';
import type { ProgramContext } from '../context';
import type { BlockState, InputState, VarMetaEntry, VariableState, WorkspaceState } from './types';
import { B, BI, BINOP_BLOCK, MATHFN_OP, PART_EXPR_BLOCK, noteForHz, presetForRgb } from './kinds';

type Obj = Record<string, unknown>;

const HAT_X = 40;
const HAT_Y = 40;
const FN_X = 720;
const HAT_GAP = 56;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

class Builder {
  readonly errors: string[] = [];
  private readonly used = new Set<string>(['cv_setup_hat', 'cv_loop_hat']);
  /** var name → Blockly variable id (insertion order = declaration order). */
  readonly vars = new Map<string, string>();
  readonly meta: Record<string, VarMetaEntry> = {};

  /* --------------------------------- ids -------------------------------- */

  private id(node: Obj | null, path: string): string {
    const wanted = node && nonEmpty(node.id) ? node.id : null;
    if (wanted && !this.used.has(wanted)) {
      this.used.add(wanted);
      return wanted;
    }
    let id = `p:${path}`;
    for (let i = 2; this.used.has(id); i++) id = `p:${path}~${i}`;
    this.used.add(id);
    return id;
  }

  varId(name: string): string {
    let id = this.vars.get(name);
    if (!id) {
      id = `v:${name}`;
      for (let i = 2; [...this.vars.values()].includes(id); i++) id = `v:${name}~${i}`;
      this.vars.set(name, id);
    }
    return id;
  }

  declare(decl: unknown, path: string): void {
    if (!isObj(decl) || !nonEmpty(decl.name)) {
      this.errors.push(`${path}: variable sin nombre (se ignora).`);
      return;
    }
    if (this.vars.has(decl.name)) {
      this.errors.push(`${path}: la variable «${decl.name}» está declarada dos veces.`);
      return;
    }
    const id = this.varId(decl.name);
    const type = decl.type === 'boolean' ? 'boolean' : 'number';
    if (decl.type !== undefined && decl.type !== 'number' && decl.type !== 'boolean') {
      this.errors.push(`${path}: tipo «${String(decl.type)}» desconocido para «${decl.name}» (se usa número).`);
    }
    const entry: VarMetaEntry = { type };
    if (typeof decl.init === (type === 'boolean' ? 'boolean' : 'number') && (type === 'boolean' || isFiniteNum(decl.init))) {
      entry.init = decl.init as number | boolean;
    }
    this.meta[id] = entry;
  }

  private varField(name: unknown, path: string): { id: string } {
    if (!nonEmpty(name)) {
      this.errors.push(`${path}: falta el nombre de la variable (se usa «x»).`);
      return { id: this.varId('x') };
    }
    return { id: this.varId(name) };
  }

  private str(node: Obj, key: string, path: string, what: string): string {
    const v = node[key];
    if (typeof v === 'string') return v;
    this.errors.push(`${path}: falta ${what}.`);
    return '';
  }

  /* ------------------------------- inputs ------------------------------- */

  /** Number slot: literals become the shadow itself, other expressions sit on a default shadow. */
  private numInput(e: unknown, path: string, def: { type: string; fields: Record<string, string | number> } = { type: BI.number, fields: { NUM: 0 } }): InputState {
    if (isObj(e) && e.k === 'num' && isFiniteNum(e.v)) {
      return { shadow: { type: BI.number, id: this.id(e, path), fields: { NUM: e.v } } };
    }
    const shadow: BlockState = { type: def.type, id: this.id(null, `${path}#s`), fields: def.fields };
    if (e === undefined) {
      this.errors.push(`${path}: falta un valor (se usa el valor por defecto).`);
      return { shadow };
    }
    const block = this.expr(e, path);
    return block ? { shadow, block } : { shadow };
  }

  /** Boolean slot (conditions): no shadow, like Blockly's own "si". */
  private condInput(e: unknown, path: string): InputState | null {
    if (e === undefined) {
      this.errors.push(`${path}: falta la condición.`);
      return null;
    }
    const block = this.expr(e, path);
    return block ? { block } : null;
  }

  /** "on" slot of LEDs: literal booleans become the encender/apagar shadow. */
  private onInput(e: unknown, path: string): InputState {
    if (isObj(e) && e.k === 'bool' && typeof e.v === 'boolean') {
      return { shadow: { type: B.onOff, id: this.id(e, path), fields: { STATE: e.v ? 'TRUE' : 'FALSE' } } };
    }
    const shadow: BlockState = { type: B.onOff, id: this.id(null, `${path}#s`), fields: { STATE: 'TRUE' } };
    if (e === undefined) {
      this.errors.push(`${path}: falta el valor encender/apagar.`);
      return { shadow };
    }
    const block = this.expr(e, path);
    return block ? { shadow, block } : { shadow };
  }

  private freqInput(e: unknown, path: string, preferNote: boolean): InputState {
    if (preferNote && isObj(e) && e.k === 'num' && isFiniteNum(e.v) && noteForHz(e.v)) {
      return { shadow: { type: B.note, id: this.id(e, path), fields: { NOTE: String(e.v) } } };
    }
    return this.numInput(e, path, preferNote ? { type: B.note, fields: { NOTE: '440' } } : undefined);
  }

  private levelInput(e: unknown, path: string): InputState {
    if (isObj(e) && e.k === 'num' && (e.v === 0 || e.v === 1)) {
      return { shadow: { type: B.pinLevel, id: this.id(e, path), fields: { LEVEL: String(e.v) } } };
    }
    return this.numInput(e, path, { type: B.pinLevel, fields: { LEVEL: '1' } });
  }

  private printInput(e: unknown, path: string): InputState {
    if (isObj(e) && e.k === 'str' && typeof e.v === 'string') {
      return { shadow: { type: BI.text, id: this.id(e, path), fields: { TEXT: e.v } } };
    }
    const shadow: BlockState = { type: BI.text, id: this.id(null, `${path}#s`), fields: { TEXT: '' } };
    if (e === undefined) {
      this.errors.push(`${path}: falta el valor a imprimir.`);
      return { shadow };
    }
    const block = this.expr(e, path, true);
    return block ? { shadow, block } : { shadow };
  }

  private rgbFields(node: Obj): Obj {
    const vals = [node.r, node.g, node.b].map((v) => (isObj(v) && v.k === 'num' && isFiniteNum(v.v) ? v.v : null));
    const preset = vals.every((v) => v !== null) ? presetForRgb(vals[0]!, vals[1]!, vals[2]!) : undefined;
    return { PRESET: preset?.id ?? 'custom' };
  }

  /* ----------------------------- statements ----------------------------- */

  chain(list: unknown, path: string): BlockState | undefined {
    if (list === undefined) return undefined;
    if (!Array.isArray(list)) {
      this.errors.push(`${path}: se esperaba una lista de instrucciones.`);
      return undefined;
    }
    const blocks: BlockState[] = [];
    list.forEach((s, i) => {
      const b = this.stmt(s, `${path}.${i}`);
      if (b) blocks.push(b);
    });
    for (let i = blocks.length - 2; i >= 0; i--) blocks[i].next = { block: blocks[i + 1] };
    return blocks[0];
  }

  private stmtInput(list: unknown, path: string): InputState | null {
    const first = this.chain(list ?? [], path);
    return first ? { block: first } : null;
  }

  private stmt(s: unknown, path: string): BlockState | null {
    if (!isObj(s) || typeof s.k !== 'string') {
      this.errors.push(`${path}: instrucción inválida (falta «k»).`);
      return null;
    }
    const id = this.id(s, path);
    const inputs: Record<string, InputState> = {};
    const put = (name: string, input: InputState | null) => {
      if (input) inputs[name] = input;
    };
    const make = (type: string, fields?: Obj, extraState?: unknown): BlockState => {
      const b: BlockState = { type, id };
      if (extraState !== undefined) b.extraState = extraState;
      if (fields && Object.keys(fields).length) b.fields = fields as BlockState['fields'];
      if (Object.keys(inputs).length) b.inputs = inputs;
      return b;
    };
    const part = () => ({ PART: this.str(s, 'part', path, 'el id del componente («part»)') });
    const pin = () => ({ PIN: this.str(s, 'pin', path, 'el pin («pin»)') });

    switch (s.k) {
      case 'delay':
        put('MS', this.numInput(s.ms, `${path}.ms`));
        return make(B.delay);
      case 'waitUntil':
        put('COND', this.condInput(s.cond, `${path}.cond`));
        return make(B.waitUntil);
      case 'if': {
        const branches = Array.isArray(s.branches) ? s.branches.filter(isObj) : [];
        if (branches.length === 0) {
          this.errors.push(`${path}: «si» sin condiciones (se ignora).`);
          return null;
        }
        branches.forEach((br, i) => {
          put(`IF${i}`, this.condInput(br.cond, `${path}.branches.${i}.cond`));
          put(`DO${i}`, this.stmtInput(br.body, `${path}.branches.${i}.body`));
        });
        const hasElse = Array.isArray(s.else);
        if (hasElse) put('ELSE', this.stmtInput(s.else, `${path}.else`));
        const extra: Obj = {};
        if (branches.length > 1) extra.elseIfCount = branches.length - 1;
        if (hasElse) extra.hasElse = true;
        return make(BI.if, undefined, Object.keys(extra).length ? extra : undefined);
      }
      case 'repeat':
        put('TIMES', this.numInput(s.times, `${path}.times`));
        put('DO', this.stmtInput(s.body, `${path}.body`));
        return make(BI.repeat);
      case 'while':
        put('BOOL', this.condInput(s.cond, `${path}.cond`));
        put('DO', this.stmtInput(s.body, `${path}.body`));
        return make(BI.whileUntil, { MODE: s.until === true ? 'UNTIL' : 'WHILE' });
      case 'for': {
        const VAR = this.varField(s.var, `${path}.var`);
        put('FROM', this.numInput(s.from, `${path}.from`));
        put('TO', this.numInput(s.to, `${path}.to`));
        put('BY', this.numInput(s.by ?? { k: 'num', v: 1 }, `${path}.by`));
        put('DO', this.stmtInput(s.body, `${path}.body`));
        return make(BI.for, { VAR });
      }
      case 'break':
        return make(BI.flow, { FLOW: 'BREAK' });
      case 'continue':
        return make(BI.flow, { FLOW: 'CONTINUE' });
      case 'call': {
        const name = this.str(s, 'name', path, 'el nombre de la función');
        return make(BI.procCall, undefined, { name });
      }
      case 'set': {
        const VAR = this.varField(s.var, `${path}.var`);
        if (isObj(s.value) && s.value.k === 'num') put('VALUE', this.numInput(s.value, `${path}.value`));
        else put('VALUE', this.condInput(s.value, `${path}.value`));
        return make(BI.varSet, { VAR });
      }
      case 'change': {
        const VAR = this.varField(s.var, `${path}.var`);
        put('DELTA', this.numInput(s.delta, `${path}.delta`));
        return make(BI.change, { VAR });
      }
      case 'serialPrint':
        put('VALUE', this.printInput(s.value, `${path}.value`));
        return make(B.serialPrint, { NEWLINE: s.newline === false ? 'FALSE' : 'TRUE' });
      case 'pinMode': {
        const mode = s.mode === 'INPUT' || s.mode === 'INPUT_PULLUP' ? s.mode : 'OUTPUT';
        if (s.mode !== mode) this.errors.push(`${path}: modo «${String(s.mode)}» desconocido (se usa salida).`);
        return make(B.pinMode, { ...pin(), MODE: mode });
      }
      case 'digitalWrite':
        put('VALUE', this.levelInput(s.value, `${path}.value`));
        return make(B.digitalWrite, pin());
      case 'analogWrite':
        put('VALUE', this.numInput(s.value, `${path}.value`));
        return make(B.analogWrite, pin());
      case 'tone': {
        put('FREQ', this.freqInput(s.freq, `${path}.freq`, false));
        if (s.ms !== undefined) put('MS', this.numInput(s.ms, `${path}.ms`));
        return make(s.ms !== undefined ? B.toneMs : B.tone, pin());
      }
      case 'noTone':
        return make(B.noTone, pin());
      case 'led':
        put('ON', this.onInput(s.on, `${path}.on`));
        return make(B.led, part());
      case 'ledBrightness':
        put('PERCENT', this.numInput(s.percent, `${path}.percent`));
        return make(B.ledBrightness, part());
      case 'rgb':
        put('R', this.numInput(s.r, `${path}.r`));
        put('G', this.numInput(s.g, `${path}.g`));
        put('B', this.numInput(s.b, `${path}.b`));
        return make(B.rgb, { ...part(), ...this.rgbFields(s) });
      case 'buzzerTone':
        put('FREQ', this.freqInput(s.freq, `${path}.freq`, true));
        if (s.ms !== undefined) put('MS', this.numInput(s.ms, `${path}.ms`));
        return make(s.ms !== undefined ? B.buzzerToneMs : B.buzzerTone, part());
      case 'buzzerOff':
        return make(B.buzzerOff, part());
      case 'servo':
        put('ANGLE', this.numInput(s.angle, `${path}.angle`));
        return make(B.servo, part());
      case 'motor':
        put('SPEED', this.numInput(s.speed, `${path}.speed`));
        return make(B.motor, part());
      case 'onboardLed':
        put('ON', this.onInput(s.on, `${path}.on`));
        return make(B.onboardLed);
      case 'onboardRgb':
        put('R', this.numInput(s.r, `${path}.r`));
        put('G', this.numInput(s.g, `${path}.g`));
        put('B', this.numInput(s.b, `${path}.b`));
        return make(B.onboardRgb, this.rgbFields(s));
      default:
        this.errors.push(`${path}: tipo de instrucción desconocido «${s.k}» (se ignora).`);
        return null;
    }
  }

  /* ----------------------------- expressions ---------------------------- */

  private expr(e: unknown, path: string, allowStr = false): BlockState | null {
    if (!isObj(e) || typeof e.k !== 'string') {
      this.errors.push(`${path}: valor inválido (falta «k»).`);
      return null;
    }
    const id = this.id(e, path);
    const make = (type: string, fields?: Obj, inputs?: Record<string, InputState | null>): BlockState => {
      const b: BlockState = { type, id };
      if (fields && Object.keys(fields).length) b.fields = fields as BlockState['fields'];
      const ins = Object.entries(inputs ?? {}).filter((kv): kv is [string, InputState] => kv[1] !== null);
      if (ins.length) b.inputs = Object.fromEntries(ins);
      return b;
    };
    switch (e.k) {
      case 'num':
        if (!isFiniteNum(e.v)) this.errors.push(`${path}: número inválido (se usa 0).`);
        return make(BI.number, { NUM: isFiniteNum(e.v) ? e.v : 0 });
      case 'bool':
        return make(BI.boolean, { BOOL: e.v === true ? 'TRUE' : 'FALSE' });
      case 'str':
        if (!allowStr) {
          this.errors.push(`${path}: el texto solo se puede usar en «imprimir» (se ignora).`);
          return null;
        }
        return make(BI.text, { TEXT: typeof e.v === 'string' ? e.v : String(e.v ?? '') });
      case 'var':
        return make(BI.varGet, { VAR: this.varField(e.name, `${path}.name`) });
      case 'bin': {
        const op = e.op as BinOp;
        const spec = BINOP_BLOCK[op];
        if (!spec) {
          this.errors.push(`${path}: operador «${String(e.op)}» desconocido.`);
          return null;
        }
        if (spec.type === BI.modulo) {
          return make(BI.modulo, undefined, { DIVIDEND: this.numInput(e.a, `${path}.a`), DIVISOR: this.numInput(e.b, `${path}.b`) });
        }
        if (spec.type === BI.operation) {
          return make(BI.operation, { OP: spec.op }, { A: this.condInput(e.a, `${path}.a`), B: this.condInput(e.b, `${path}.b`) });
        }
        return make(spec.type, { OP: spec.op }, { A: this.numInput(e.a, `${path}.a`), B: this.numInput(e.b, `${path}.b`) });
      }
      case 'not':
        return make(BI.negate, undefined, { BOOL: this.condInput(e.a, `${path}.a`) });
      case 'neg':
        return make(BI.single, { OP: 'NEG' }, { NUM: this.numInput(e.a, `${path}.a`) });
      case 'math': {
        const op = MATHFN_OP[e.fn as MathFn];
        if (!op) {
          this.errors.push(`${path}: función matemática «${String(e.fn)}» desconocida.`);
          return null;
        }
        return make(BI.single, { OP: op }, { NUM: this.numInput(e.a, `${path}.a`) });
      }
      case 'random':
        return make(BI.randomInt, undefined, { FROM: this.numInput(e.min, `${path}.min`), TO: this.numInput(e.max, `${path}.max`) });
      case 'map':
        return make(B.map, undefined, {
          VALUE: this.numInput(e.value, `${path}.value`),
          FROM_LOW: this.numInput(e.fromLow, `${path}.fromLow`),
          FROM_HIGH: this.numInput(e.fromHigh, `${path}.fromHigh`),
          TO_LOW: this.numInput(e.toLow, `${path}.toLow`),
          TO_HIGH: this.numInput(e.toHigh, `${path}.toHigh`),
        });
      case 'constrain':
        return make(B.constrain, undefined, {
          VALUE: this.numInput(e.value, `${path}.value`),
          LOW: this.numInput(e.low, `${path}.low`),
          HIGH: this.numInput(e.high, `${path}.high`),
        });
      case 'millis':
        return make(B.millis);
      case 'digitalRead':
        return make(B.digitalRead, { PIN: this.str(e, 'pin', path, 'el pin («pin»)') });
      case 'analogRead':
        return make(B.analogRead, { PIN: this.str(e, 'pin', path, 'el pin («pin»)') });
      default: {
        const type = (PART_EXPR_BLOCK as Record<string, string>)[e.k];
        if (type) return make(type, { PART: this.str(e, 'part', path, 'el id del componente («part»)') });
        this.errors.push(`${path}: tipo de valor desconocido «${e.k}».`);
        return null;
      }
    }
  }

  /* ------------------------------- layout ------------------------------- */

  functionBlock(f: unknown, index: number): BlockState | null {
    const path = `functions.${index}`;
    if (!isObj(f) || !nonEmpty(f.name)) {
      this.errors.push(`${path}: función sin nombre (se ignora).`);
      return null;
    }
    const block: BlockState = { type: BI.procDef, id: this.id(f, `fn.${index}`), fields: { NAME: f.name } };
    const first = this.chain(f.body ?? [], `${path}.body`);
    if (first) block.inputs = { STACK: { block: first } };
    return block;
  }
}

/** Rough rendered height (px, zelos at scale 1) of a statement chain, for non-overlapping layout. */
function chainHeight(first: BlockState | undefined): number {
  let h = 0;
  for (let b = first; b; b = b.next?.block) {
    h += 56;
    for (const [name, input] of Object.entries(b.inputs ?? {})) {
      if (/^(DO\d*|ELSE|STACK)$/.test(name)) h += 40 + chainHeight(input.block);
    }
  }
  return h;
}

export function irToWorkspace(ir: Partial<ProgramIR>, ctx?: ProgramContext): { workspace: WorkspaceState; errors: string[] } {
  void ctx;
  const src: Obj = isObj(ir) ? (ir as Obj) : {};
  const b = new Builder();
  if (!isObj(ir)) b.errors.push('El programa debe ser un objeto con «setup» y «loop».');

  if (src.variables !== undefined && !Array.isArray(src.variables)) b.errors.push('variables: se esperaba una lista.');
  (Array.isArray(src.variables) ? src.variables : []).forEach((v, i) => b.declare(v, `variables.${i}`));

  const setupFirst = b.chain(src.setup ?? [], 'setup');
  const loopFirst = b.chain(src.loop ?? [], 'loop');

  if (src.functions !== undefined && !Array.isArray(src.functions)) b.errors.push('functions: se esperaba una lista.');
  const fnBlocks = (Array.isArray(src.functions) ? src.functions : [])
    .map((f, i) => b.functionBlock(f, i))
    .filter((x): x is BlockState => x !== null);

  const setupHat: BlockState = { type: B.setup, id: 'cv_setup_hat', x: HAT_X, y: HAT_Y };
  if (setupFirst) setupHat.inputs = { DO: { block: setupFirst } };
  const loopY = HAT_Y + 72 + Math.max(chainHeight(setupFirst), 40) + HAT_GAP;
  const loopHat: BlockState = { type: B.loop, id: 'cv_loop_hat', x: HAT_X, y: loopY };
  if (loopFirst) loopHat.inputs = { DO: { block: loopFirst } };

  let fnY = HAT_Y;
  for (const fb of fnBlocks) {
    fb.x = FN_X;
    fb.y = fnY;
    fnY += 72 + Math.max(chainHeight(fb.inputs?.STACK?.block), 40) + HAT_GAP;
  }

  const workspace: WorkspaceState = { blocks: { languageVersion: 0, blocks: [setupHat, loopHat, ...fnBlocks] } };
  const variables: VariableState[] = [...b.vars.entries()].map(([name, id]) => ({ name, id }));
  if (variables.length) workspace.variables = variables;
  if (Object.keys(b.meta).length) workspace.cvVariables = b.meta;
  return { workspace, errors: b.errors };
}
