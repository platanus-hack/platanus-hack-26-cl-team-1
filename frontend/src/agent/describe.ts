/**
 * Spanish one-line titles for agent steps ("Agregando LED rojo",
 * "Conectando D13 → R1", "Simulando 3 s", "Compilando para Arduino Uno").
 * Works with partial / missing input (the step appears before the input is complete).
 */
import type { PartDef, ProjectModel, ToolName } from '@/contracts';
import { describeHole, findPartDef, projectBoard } from '@/catalog';
import { parsePinRef } from '@/lib/pinref';
import examplesJson from '../../../shared/examples.json';

const EXAMPLE_NAMES = new Map((examplesJson as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]));

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const SYMMETRIC_PARTS = new Set(['resistor', 'ldr']);
const VIEW_ES: Record<string, string> = { hardware: 'la protoboard', schematic: 'el esquema', software: 'los bloques' };
const BOARD_ES: Record<string, string> = { uno: 'Arduino Uno', esp32c6: 'ESP32-C6' };

/** "Resistencia" → "resistencia", but acronyms stay ("LED", "LDR"). */
function lowerFirst(s: string): string {
  if (!s || /^\p{Lu}{2}/u.test(s)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

function formatOhms(v: number): string {
  if (v >= 1e6) return `${String(+(v / 1e6).toFixed(2)).replace('.', ',')} MΩ`;
  if (v >= 1e3) return `${String(+(v / 1e3).toFixed(2)).replace('.', ',')} kΩ`;
  return `${v} Ω`;
}

/** "3 s", "1,5 s", "500 ms". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 100) / 10;
  return `${String(s).replace('.', ',')} s`;
}

function enumLabel(def: PartDef | undefined, key: string, value: unknown): string | undefined {
  const opt = def?.props.find((p) => p.key === key)?.options?.find((o) => String(o.value) === String(value));
  return opt?.label;
}

/** "LED rojo", "resistencia de 220 Ω", "pulsador". */
function newPartName(input: Obj): string {
  const label = str(input.label);
  if (label) return label;
  const type = str(input.type);
  const def = type ? findPartDef(type) : undefined;
  if (!def) return 'un componente';
  const props = asObj(input.props);
  const base = def.electrical.model === 'mcu' ? def.name : lowerFirst(def.name);
  if (props.color !== undefined) {
    const c = enumLabel(def, 'color', props.color);
    if (c) return `${base} ${c.toLowerCase()}`;
  }
  if (typeof props.resistance === 'number' || typeof props.resistance === 'string') {
    const n = Number(props.resistance);
    if (Number.isFinite(n)) return `${base} de ${formatOhms(n)}`;
  }
  return base;
}

function partLabel(project: ProjectModel | null, id: unknown): string {
  const pid = str(id);
  if (!pid) return 'componente';
  return project?.parts.find((p) => p.id === pid)?.label ?? pid;
}

/** Short human name of a pin ref: "D13", "R1", "LED rojo (ánodo)", "e10", "riel − superior (columna 3)". */
export function describePinRef(project: ProjectModel | null, ref: unknown): string {
  const r = str(ref);
  if (!r) return '?';
  const { part: pid, pin } = parsePinRef(r);
  const part = project?.parts.find((p) => p.id === pid);
  if (!part) return r;
  const def = findPartDef(part.type);
  if (!def) return r;
  if (def.electrical.model === 'bus') return describeHole(pin);
  if (def.electrical.model === 'mcu') return pin;
  if (SYMMETRIC_PARTS.has(def.type)) return part.label;
  const pd = def.pins.find((p) => p.id === pin);
  const short = pd ? lowerFirst(pd.label.split(/[ (]/)[0]) : pin;
  return `${part.label} (${short})`;
}

function currentProject(): ProjectModel | null {
  return null;
}

let projectGetter: () => ProjectModel | null = currentProject;

/** The app wires the live project in (tools.ts); tests may pass one explicitly. */
export function setDescribeProjectSource(get: () => ProjectModel | null): void {
  projectGetter = get;
}

export function describeToolCall(name: ToolName, input: unknown, project: ProjectModel | null = projectGetter()): string {
  const i = asObj(input);
  switch (name) {
    case 'get_project':
      return 'Revisando tu proyecto';
    case 'add_part':
      return `Agregando ${newPartName(i)}`;
    case 'remove_part':
      return `Quitando ${partLabel(project, i.id)}`;
    case 'update_part': {
      const target = partLabel(project, i.id);
      const props = asObj(i.props);
      if (typeof props.resistance === 'number' || typeof props.resistance === 'string') {
        const n = Number(props.resistance);
        if (Number.isFinite(n)) return `Cambiando ${target} a ${formatOhms(n)}`;
      }
      if (props.color !== undefined) {
        const part = project?.parts.find((p) => p.id === i.id);
        const c = enumLabel(part ? findPartDef(part.type) : undefined, 'color', props.color);
        if (c) return `Cambiando ${target} a ${c.toLowerCase()}`;
      }
      if (str(i.label)) return `Renombrando ${target} a «${str(i.label)}»`;
      if (i.rotation !== undefined) return `Girando ${target}`;
      return `Ajustando ${target}`;
    }
    case 'move_part':
      return `Moviendo ${partLabel(project, i.id)}`;
    case 'connect':
      if (!str(i.from) || !str(i.to)) return 'Conectando un cable';
      return `Conectando ${describePinRef(project, i.from)} → ${describePinRef(project, i.to)}`;
    case 'disconnect':
      if (str(i.from) && str(i.to)) return `Desconectando ${describePinRef(project, i.from)} ↔ ${describePinRef(project, i.to)}`;
      return str(i.wire_id) ? `Quitando el cable ${str(i.wire_id)}` : 'Quitando un cable';
    case 'set_program': {
      const prog = asObj(i.program);
      const count = (Array.isArray(prog.setup) ? prog.setup.length : 0) + (Array.isArray(prog.loop) ? prog.loop.length : 0);
      return count > 0 ? `Escribiendo el programa (${count} ${count === 1 ? 'bloque' : 'bloques'})` : 'Escribiendo el programa';
    }
    case 'get_code':
      return 'Leyendo el código Arduino';
    case 'run_checks':
      return 'Revisando el circuito';
    case 'simulate': {
      const ms = typeof i.duration_ms === 'number' ? i.duration_ms : NaN;
      const n = Array.isArray(i.inputs) ? i.inputs.length : 0;
      const base = Number.isFinite(ms) ? `Simulando ${formatDuration(ms)}` : 'Simulando';
      return n > 0 ? `${base} con ${n} ${n === 1 ? 'acción' : 'acciones'}` : base;
    }
    case 'compile': {
      const board = project ? projectBoard(project)?.profile : undefined;
      return board ? `Compilando para ${board.id === 'uno' ? 'Arduino Uno' : board.name}` : 'Compilando el programa';
    }
    case 'ask_user':
      return 'Esperando tu respuesta';
    case 'highlight': {
      const msg = str(i.message);
      if (msg) return `Señalando: ${msg.length > 48 ? `${msg.slice(0, 47)}…` : msg}`;
      const n = Array.isArray(i.targets) ? i.targets.length : 0;
      return n === 1 ? 'Señalando un elemento' : `Señalando ${n || 'algunos'} elementos`;
    }
    case 'switch_view':
      return str(i.view) && VIEW_ES[str(i.view)!] ? `Mostrándote ${VIEW_ES[str(i.view)!]}` : 'Cambiando de vista';
    case 'load_example': {
      const id = str(i.example_id);
      return id ? `Cargando el ejemplo «${EXAMPLE_NAMES.get(id) ?? id}»` : 'Cargando un ejemplo';
    }
    case 'new_project':
      if (i.board === null) return 'Empezando un proyecto nuevo solo con protoboard';
      return `Empezando un proyecto nuevo con ${BOARD_ES[str(i.board) ?? 'uno'] ?? 'Arduino Uno'}`;
    default:
      return String(name);
  }
}
