/**
 * WORKSTREAM C — client-side execution of agent tools.
 *
 * executeTool validates the input against agent-tools.json (eager input
 * streaming means the API does not), runs the tool through the public module
 * APIs and returns a ToolResultPayload — never throws: failures come back as
 * {error: '…'} in Spanish so Claude can correct itself.
 * Project changes are dispatched with {source:'agent', group, label:'Asistente: …'}.
 */
import type {
  DecisionCard,
  Op,
  PartInstance,
  PinRef,
  ProgramIR,
  SimInputEvent,
  ToolInputs,
  ToolName,
  ToolOutputs,
  ToolResultPayload,
} from '@/contracts';
import { allPartDefs, findPartDef, projectBoard } from '@/catalog';
import { buildExample, EXAMPLES } from '@/examples';
import { compileProject } from '@/flash';
import { parsePinRef } from '@/lib/pinref';
import { planAddPart, planConnect, planDisconnect } from '@/placement';
import { generateCode } from '@/program/codegen';
import { getProgramIR, irToWorkspace, validateIR } from '@/program/blocks';
import { programContext } from '@/program/context';
import { runHeadless } from '@/sim/runtime';
import { getIssues } from '@/store/derived';
import { createStarterProject } from '@/store/newProject';
import { getProject, useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { getProjectSummary } from './appContext';
import { describeToolCall as describe, formatDuration, setDescribeProjectSource } from './describe';
import { normalizeProps } from './props';
import { isToolName, validateToolInput } from './schema';
import { summarizeTimeline } from './simSummary';
import { compactIssue } from './summary';

export interface ToolExecContext {
  /** The tool_use id (needed for decision cards). */
  toolUseId: string;
  /** History group of the current user turn (dispatch meta.group). */
  group: string;
  /** Show a decision card and resolve with the student's answer. */
  askUser: (card: DecisionCard) => Promise<{ choiceId: string | null; text?: string }>;
  /** Progress text for long tools (compile, simulate) → AgentStep.detail. */
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
}

setDescribeProjectSource(() => {
  try {
    return getProject();
  } catch {
    return null;
  }
});

type Payload<N extends ToolName> = ToolResultPayload<N>;
type Handler<N extends ToolName> = (input: ToolInputs[N], ctx: ToolExecContext) => Payload<N> | Promise<Payload<N>>;

const fail = (error: string): { error: string } => ({ error });

/** Dispatch agent ops as part of the turn's undo group; returns an error message or null. */
function apply(ops: Op[], ctx: ToolExecContext, label: string): string | null {
  if (ops.length === 0) return null;
  const r = useProject.getState().dispatch(ops, { source: 'agent', group: ctx.group, label: `Asistente: ${label}` });
  return r.ok ? null : r.error ?? 'La app rechazó el cambio.';
}

function partOrError(id: string): { part: PartInstance } | { error: string } {
  const part = getProject().parts.find((p) => p.id === id);
  if (part) return { part };
  const ids = getProject().parts.map((p) => p.id);
  return { error: `No existe el componente «${id}». Ids actuales: ${ids.length ? ids.join(', ') : '(ninguno)'}.` };
}

/** Check that a PinRef names an existing part pin; Spanish hint with valid pins otherwise. */
function checkPinRef(ref: PinRef): string | null {
  const { part: pid, pin } = parsePinRef(ref);
  if (!pin) return `«${ref}» no es una referencia de pin válida (usa «parte.pin», p. ej. «led1.anode»).`;
  const part = getProject().parts.find((p) => p.id === pid);
  if (!part) return `No existe el componente «${pid}» (en «${ref}»).`;
  const def = findPartDef(part.type);
  if (!def) return `Tipo desconocido para «${pid}».`;
  if (def.pins.some((p) => p.id === pin)) return null;
  if (def.electrical.model === 'bus') return `«${pin}» no es un agujero de la protoboard (usa a1..j30 o T+1, T-1, B+1, B-1…).`;
  const shown = def.pins.slice(0, 40).map((p) => p.id).join(', ');
  return `«${part.label}» (${pid}) no tiene el pin «${pin}». Pines: ${shown}${def.pins.length > 40 ? '…' : ''}.`;
}

const tail = (s: string, n: number) => (s.length > n ? `…${s.slice(-n)}` : s);

const COMPILE_STATUS_ES: Record<string, string> = {
  queued: 'En cola para compilar…',
  running: 'Compilando con arduino-cli…',
  success: 'Compilación lista',
  error: 'La compilación falló',
};

const HANDLERS: { [N in ToolName]: Handler<N> } = {
  get_project: () => getProjectSummary(),

  add_part: (input, ctx) => {
    const def = findPartDef(input.type);
    if (!def) {
      return fail(`No existe el tipo «${input.type}». Tipos válidos: ${allPartDefs().map((d) => d.type).join(', ')}.`);
    }
    const np = normalizeProps(def, input.props);
    if ('error' in np) return fail(np.error);
    const plan = planAddPart(getProject(), input.type, {
      label: input.label,
      props: np.props,
      placement: input.placement,
      near: input.near,
      rotation: input.rotation,
    });
    if (plan.error) return fail(plan.error);
    const err = apply(plan.ops, ctx, `agregar ${plan.label}`);
    if (err) return fail(err);
    const out: ToolOutputs['add_part'] = { id: plan.id, label: plan.label };
    if (plan.holes && Object.keys(plan.holes).length) out.holes = plan.holes;
    if (plan.note) out.note = plan.note;
    return out;
  },

  remove_part: (input, ctx) => {
    const r = partOrError(input.id);
    if ('error' in r) return fail(r.error);
    const prefix = `${input.id}.`;
    const removedWires = getProject()
      .wires.filter((w) => w.from.startsWith(prefix) || w.to.startsWith(prefix))
      .map((w) => w.id);
    const err = apply([{ op: 'part.remove', id: input.id }], ctx, `quitar ${r.part.label}`);
    return err ? fail(err) : { ok: true, removedWires };
  },

  update_part: (input, ctx) => {
    const r = partOrError(input.id);
    if ('error' in r) return fail(r.error);
    const def = findPartDef(r.part.type);
    if (!def) return fail(`Tipo desconocido para «${input.id}».`);
    const ops: Op[] = [];
    if (input.props && Object.keys(input.props).length) {
      const np = normalizeProps(def, input.props);
      if ('error' in np) return fail(np.error);
      ops.push({ op: 'part.setProps', id: input.id, props: np.props });
    }
    if (input.label !== undefined) {
      if (!input.label.trim()) return fail('La etiqueta no puede quedar vacía.');
      ops.push({ op: 'part.setLabel', id: input.id, label: input.label.trim() });
    }
    if (input.rotation !== undefined) ops.push({ op: 'part.rotate', id: input.id, rotation: input.rotation });
    if (ops.length === 0) return fail('No indicaste nada que cambiar (props, label o rotation).');
    const err = apply(ops, ctx, `ajustar ${r.part.label}`);
    return err ? fail(err) : { ok: true };
  },

  move_part: (input, ctx) => {
    const r = partOrError(input.id);
    if ('error' in r) return fail(r.error);
    const err = apply([{ op: 'part.move', id: input.id, x: input.x, y: input.y }], ctx, `mover ${r.part.label}`);
    return err ? fail(err) : { ok: true };
  },

  connect: (input, ctx) => {
    const bad = checkPinRef(input.from) ?? checkPinRef(input.to);
    if (bad) return fail(bad);
    if (input.from === input.to) return fail('Un cable necesita dos puntos distintos.');
    const plan = planConnect(getProject(), input.from, input.to, input.color);
    if (plan.error) return fail(plan.error);
    const err = apply(plan.ops, ctx, `conectar ${describe('connect', input).replace(/^Conectando /, '')}`);
    if (err) return fail(err);
    return { wire_id: plan.wireId, from: plan.from, to: plan.to, ...(plan.note ? { note: plan.note } : {}) };
  },

  disconnect: (input, ctx) => {
    if (!input.wire_id && !(input.from && input.to)) return fail('Indica «wire_id», o «from» y «to».');
    if (input.wire_id && !getProject().wires.some((w) => w.id === input.wire_id)) {
      return fail(`No existe el cable «${input.wire_id}».`);
    }
    const plan = planDisconnect(getProject(), { wireId: input.wire_id, from: input.from, to: input.to });
    if (plan.error) return fail(plan.error);
    if (plan.removed.length === 0) return fail('No encontré cables entre esos puntos. Usa get_project para ver los cables.');
    const err = apply(plan.ops, ctx, 'quitar cable');
    return err ? fail(err) : { ok: true, removed: plan.removed };
  },

  set_program: (input, ctx) => {
    const project = getProject();
    const pctx = programContext(project);
    const ir: ProgramIR = {
      version: 1,
      board: pctx.board?.id ?? null,
      variables: input.program.variables ?? [],
      setup: input.program.setup,
      loop: input.program.loop,
      functions: input.program.functions ?? [],
    };
    const v = validateIR(ir, pctx);
    if (v.errors.length) {
      return fail(`El programa tiene ${v.errors.length} error(es) y no lo apliqué:\n- ${v.errors.slice(0, 15).join('\n- ')}`);
    }
    const { workspace, errors } = irToWorkspace(ir, pctx);
    if (errors.length) return fail(`No pude convertir el programa en bloques:\n- ${errors.slice(0, 15).join('\n- ')}`);
    const err = apply([{ op: 'program.set', workspace }], ctx, 'escribir el programa');
    if (err) return fail(err);
    const after = getProject();
    const gen = generateCode(getProgramIR(after), programContext(after));
    const warnings = [...new Set([...v.warnings, ...gen.warnings.map((w) => w.message)])];
    return { ok: true, code: gen.code, warnings };
  },

  get_code: () => {
    const project = getProject();
    const pctx = programContext(project);
    const gen = generateCode(getProgramIR(project), pctx);
    return { board: pctx.board?.id ?? null, code: gen.code, warnings: gen.warnings.map((w) => w.message) };
  },

  run_checks: () => ({ issues: getIssues(getProject()).map(compactIssue) }),

  simulate: async (input, ctx) => {
    const project = getProject();
    const inputs: SimInputEvent[] = [];
    for (const ev of input.inputs ?? []) {
      const part = project.parts.find((p) => p.id === ev.part);
      if (!part) return fail(`inputs: no existe el componente «${ev.part}».`);
      if (ev.atMs < 0 || ev.atMs > input.duration_ms) return fail(`inputs: atMs ${ev.atMs} está fuera de la simulación (0..${input.duration_ms}).`);
      // The sim silently ignores unknown props: validate against the part's runtime props.
      const def = findPartDef(part.type);
      const runtime = def?.props.filter((p) => p.runtime) ?? [];
      const pd = runtime.find((p) => p.key === ev.prop);
      if (!def || !pd) {
        return fail(
          runtime.length
            ? `inputs: «${part.label}» (${part.id}) no tiene la propiedad interactiva «${ev.prop}». Usa: ${runtime.map((p) => p.key).join(', ')}.`
            : `inputs: «${part.label}» (${part.id}) no se puede accionar durante la simulación.`,
        );
      }
      const raw = pd.type === 'boolean' && (ev.value === 0 || ev.value === 1) ? ev.value === 1 : ev.value;
      const np = normalizeProps(def, { [ev.prop]: raw });
      if ('error' in np) return fail(`inputs: ${np.error}`);
      inputs.push({ atMs: ev.atMs, part: ev.part, prop: ev.prop, value: np.props[ev.prop] });
    }
    ctx.onProgress?.(`Simulando ${formatDuration(input.duration_ms)} de circuito y programa…`);
    const timeline = await runHeadless(project, input.duration_ms, inputs);
    const summary = summarizeTimeline(timeline);
    ctx.onProgress?.(`${summary.changes.length} cambios · ${summary.serial.length} líneas de serial`);
    return summary;
  },

  compile: async (_input, ctx) => {
    const project = getProject();
    if (!projectBoard(project)) return fail('No hay placa en el proyecto: agrega un Arduino Uno o un ESP32-C6 para compilar.');
    ctx.onProgress?.('Enviando el código al compilador…');
    // compileProject maps diagnostics to blocks (lineMap), handles codegen errors and
    // publishes to useCompile so the student can download / flash what the agent compiled.
    const r = await compileProject(project, {
      signal: ctx.signal,
      onStatus: (s) => ctx.onProgress?.(COMPILE_STATUS_ES[s.status] ?? s.status),
    });
    return {
      ok: r.status === 'success',
      diagnostics: r.diagnostics.slice(0, 20),
      ...(r.sizes ? { sizes: r.sizes } : {}),
      ...(r.artifactName ? { artifactName: r.artifactName } : {}),
      log_tail: tail(r.log ?? '', 1500),
    };
  },

  ask_user: async (input, ctx) => {
    const ids = input.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) return fail('Cada opción necesita un id distinto.');
    const answer = await ctx.askUser({
      toolUseId: ctx.toolUseId,
      question: input.question,
      options: input.options,
      allowFreeText: !!input.allow_free_text,
    });
    return { choice_id: answer.choiceId, ...(answer.text ? { text: answer.text } : {}) };
  },

  highlight: (input) => {
    const project = getProject();
    const known = input.targets.filter((t) => {
      if (project.parts.some((p) => p.id === t) || project.wires.some((w) => w.id === t)) return true;
      return t.includes('.') && checkPinRef(t) === null;
    });
    if (known.length === 0) return fail(`No encontré ninguno de estos elementos: ${input.targets.join(', ')}.`);
    useUI.getState().setHighlight(known, input.message);
    return { ok: true };
  },

  switch_view: (input) => {
    useUI.getState().showView(input.view);
    return { ok: true };
  },

  load_example: (input, ctx) => {
    const info = EXAMPLES.find((e) => e.id === input.example_id);
    if (!info) return fail(`No existe el ejemplo «${input.example_id}». Disponibles: ${EXAMPLES.map((e) => e.id).join(', ')}.`);
    const err = apply([{ op: 'project.load', project: buildExample(info.id) }], ctx, `cargar el ejemplo «${info.name}»`);
    return err ? fail(err) : { ok: true, name: info.name };
  },

  new_project: (input, ctx) => {
    const board = input.board === undefined ? 'uno' : input.board;
    const err = apply([{ op: 'project.load', project: createStarterProject(board) }], ctx, 'empezar un proyecto nuevo');
    return err ? fail(err) : { ok: true };
  },
};

/** Names of every implemented tool (tests compare them with agent-tools.json). */
export const IMPLEMENTED_TOOLS = Object.keys(HANDLERS) as ToolName[];

export async function executeTool(name: ToolName, input: unknown, ctx: ToolExecContext): Promise<ToolResultPayload> {
  if (!isToolName(name)) return fail(`Herramienta desconocida «${String(name)}».`);
  const invalid = validateToolInput(name, input ?? {});
  if (invalid) return fail(invalid);
  try {
    const handler = HANDLERS[name] as Handler<ToolName>;
    return await handler((input ?? {}) as ToolInputs[ToolName], ctx);
  } catch (e) {
    if (ctx.signal?.aborted) return fail('El estudiante detuvo al asistente.');
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[agent] ${name} falló`, e);
    return fail(`Error interno al ejecutar ${name}: ${msg}`);
  }
}

/** Spanish one-line title for a tool call step ("Agregando LED rojo…"). */
export function describeToolCall(name: ToolName, input: unknown): string {
  return describe(name, input);
}

export const isErrorPayload = (p: unknown): p is { error: string } =>
  !!p && typeof p === 'object' && !Array.isArray(p) && typeof (p as { error?: unknown }).error === 'string';
