/**
 * CONTRACT 4 — Agent tool definitions + streaming protocol
 * ---------------------------------------------------------------------------
 * Tool JSON schemas (names, descriptions, input_schema) live in
 * /shared/agent-tools.json — the Python server passes them to Claude verbatim
 * (adding eager_input_streaming), the frontend uses the types below. A vitest
 * keeps ToolInputs keys == tool names and the load_example enum == examples.
 *
 * Architecture ("server turn, client tools"):
 *   1. Browser POSTs /api/agent/turn { messages, context } → SSE response.
 *   2. Server calls Claude (streaming) with a BYTE-STABLE system prompt and
 *      tools built ONCE at startup from /shared (parts with board pins merged,
 *      board profiles, shared/ir-reference.md, shared/examples.json) — no
 *      per-request data in system/tools (prompt cache).
 *   3. Server relays events; at the end emits `message_end` with the
 *      ECHO-READY assistant content: identical to the API output (thinking
 *      blocks, unknown types such as `fallback` untouched) except that, after a
 *      mid-output refusal fallback, the thinking/redacted_thinking/tool_use
 *      blocks BEFORE the final `fallback` block are dropped, as the API requires.
 *   4. The SERVER NEVER MODIFIES `messages`. History is append-only; the
 *      browser is the source of truth.
 *
 * CLIENT RULES
 *  - Each student-typed user message = [{type:'text', text}, {type:'text',
 *    text:'<contexto_app>{compact JSON}</contexto_app>'}] and is stored as sent.
 *  - Tools run ONLY after `message_end` with stop_reason 'tool_use'. The
 *    `tool_use` event just renders a pending AgentStep.
 *  - After executing all tool_use blocks (in order) append ONE user message
 *    with one tool_result per tool_use: {type:'tool_result', tool_use_id,
 *    content: JSON.stringify(payload) (≤ 12 KB, truncated with a note),
 *    is_error: 'error' in payload}. Then POST again. Max 25 iterations.
 *  - stop_reason 'max_tokens': append the content and answer every tool_use in
 *    it with is_error "Entrada truncada, repite la llamada"; if there was no
 *    tool_use, stop and show what arrived.
 *  - stop_reason 'refusal': append NOTHING, discard streamed text, show a
 *    friendly Spanish notice (stop_details may explain).
 *  - 'pause_turn' cannot happen (no server tools) → treat as error.
 *  - `error` event or a stream that closes without `message_end`: append
 *    nothing, drop partial text; if retryable offer "Reintentar" (re-POST the
 *    same messages).
 *  - Abort (Stop button / new message while tools are pending): abort the
 *    fetch; if the last assistant message has unanswered tool_use blocks, the
 *    next user message STARTS with their tool_results — results of tools that
 *    already completed are kept, the rest get is_error ("El estudiante detuvo
 *    al asistente") — followed by the student's text. An assistant message with
 *    empty content is never appended. A typed
 *    reply while an ask_user card is open becomes that card's tool_result
 *    {choice_id: null, text}.
 *  - executeTool validates `input` against the tool's input_schema (eager input
 *    streaming means the API does not) and returns {error} on mismatch.
 *  - Agent ops are dispatched with {source:'agent', group: <user-turn id>,
 *    label: 'Asistente: …'} so one Ctrl+Z / "Deshacer cambios del asistente"
 *    reverts a whole turn.
 *
 * SERVER RULES
 *  - Model/effort from settings; adaptive thinking with display 'summarized'
 *    (relayed as thinking_delta); auto tool_choice; refusal fallbacks enabled.
 *  - SSE comment ping (": ping\n\n") every ~15 s; stop the upstream stream when
 *    the client disconnects.
 */
import type { BoardId, Id, PinRef, PropValue, Rotation, WireColor } from './model';
import type { ProgramIR } from './ir';
import type { CheckIssue, CompileDiagnostic, CompileResult, PartSimState, SimInputEvent } from './sim';

/* ------------------------------ tool inputs ------------------------------ */

export interface ToolInputs {
  get_project: Record<string, never>;
  add_part: {
    type: string;
    label?: string;
    props?: Record<string, PropValue>;
    /** 'auto' (default): insertable parts go on the breadboard (an ESP32 devkit straddles the channel), others in free space. */
    placement?: 'auto' | 'breadboard' | 'free';
    near?: Id;
    rotation?: Rotation;
  };
  remove_part: { id: Id };
  update_part: { id: Id; props?: Record<string, PropValue>; label?: string; rotation?: Rotation };
  move_part: { id: Id; x: number; y: number };
  connect: { from: PinRef; to: PinRef; color?: WireColor };
  /** from/to match a wire end that is that pin OR a hole of the strip that pin is inserted into. */
  disconnect: { wire_id?: Id; from?: PinRef; to?: PinRef };
  set_program: { program: Pick<ProgramIR, 'setup' | 'loop'> & Partial<Pick<ProgramIR, 'variables' | 'functions'>> };
  get_code: Record<string, never>;
  run_checks: Record<string, never>;
  simulate: { duration_ms: number; inputs?: SimInputEvent[] };
  compile: Record<string, never>;
  ask_user: {
    question: string;
    options: Array<{ id: string; label: string; description?: string }>;
    allow_free_text?: boolean;
  };
  highlight: { targets: string[]; message?: string };
  switch_view: { view: 'hardware' | 'schematic' | 'software' };
  load_example: { example_id: string };
  /** board omitted → 'uno' starter; null → breadboard only. */
  new_project: { board?: BoardId | null };
}

export type ToolName = keyof ToolInputs;

/* ------------------------------ tool outputs ----------------------------- */

/**
 * Compact project summary (token budget!). Rules: never list breadboard holes
 * as pins; for other parts list each pin with its net name (or 'nodo <pinref>'),
 * `inserted` hole if any, and `connectedTo` excluding breadboard holes and the
 * part's own pins; board pins only when connected.
 */
export interface ProjectSummary {
  name: string;
  board: BoardId | null;
  parts: Array<{
    id: Id;
    type: string;
    label: string;
    props: Record<string, PropValue>;
    position: { x: number; y: number; rotation: Rotation };
    pins: Array<{ id: string; label: string; net: string | null; connectedTo: PinRef[]; inserted?: PinRef }>;
  }>;
  wires: Array<{ id: Id; from: PinRef; to: PinRef; color: WireColor }>;
  bindings: Array<{ part: Id; pin: string; boardPin: string | null; codeName: string | null; mode: string; activeLow: boolean; channel?: string; via: Id[] }>;
  issues: CheckIssue[];
  program: ProgramIR | null;
  programErrors: string[];
  view: 'hardware' | 'schematic' | 'software';
}

/**
 * Headless simulation summary for the agent: quantized (brightness/speed 0.05,
 * angle 1°), ≥ 50 ms between samples per part, ≤ 200 changes, ≤ 100 serial lines.
 */
export interface AgentSimSummary {
  duration_ms: number;
  changes: Array<{ t: number; part: Id; state: Partial<PartSimState> }>;
  serial: Array<{ t: number; text: string }>;
  per_part: Record<Id, { min?: number; max?: number; last: Partial<PartSimState> }>;
  issues: CheckIssue[];
  truncated: boolean;
  error?: string;
}

export interface ToolOutputs {
  get_project: ProjectSummary;
  add_part: { id: Id; label: string; holes?: Record<string, PinRef>; note?: string };
  remove_part: { ok: true; removedWires: Id[] };
  update_part: { ok: true };
  move_part: { ok: true };
  connect: { wire_id: Id; from: PinRef; to: PinRef; note?: string };
  disconnect: { ok: true; removed: Id[] };
  set_program: { ok: true; code: string; warnings: string[] };
  get_code: { board: BoardId | null; code: string; warnings: string[] };
  run_checks: { issues: CheckIssue[] };
  simulate: AgentSimSummary;
  compile: { ok: boolean; diagnostics: CompileDiagnostic[]; sizes?: CompileResult['sizes']; artifactName?: string; log_tail: string };
  ask_user: { choice_id: string | null; text?: string };
  highlight: { ok: true; note?: string };
  switch_view: { ok: true };
  load_example: { ok: true; name: string };
  new_project: { ok: true };
}

export type ToolResultPayload<N extends ToolName = ToolName> = ToolOutputs[N] | { error: string };

/* ---------------------------- HTTP / SSE protocol ------------------------ */

/** Anthropic Messages content blocks are passed through as opaque JSON. */
export type ApiContentBlock = { type: string; [k: string]: unknown };
export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | ApiContentBlock[];
}

export interface AgentTurnRequest {
  /** Full append-only conversation (the browser is the source of truth). */
  messages: ApiMessage[];
  /** For server logs only — NOT added to the model input (see CLIENT RULES). */
  context?: {
    view: 'hardware' | 'schematic' | 'software';
    board: BoardId | null;
    partCount: number;
    issueCount: number;
    simRunning: boolean;
  };
}

export type AgentErrorCode = 'overloaded' | 'rate_limited' | 'invalid_request' | 'auth' | 'no_api_key' | 'upstream' | 'internal';

/** Server-Sent Events emitted by POST /api/agent/turn (SSE `event:` = `type`). */
export type AgentEvent =
  | { type: 'message_start'; id: string }
  | { type: 'thinking_delta'; text: string } // summarized thinking, display only
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: ToolName }
  | { type: 'tool_use'; id: string; name: ToolName; input: unknown }
  | {
      type: 'message_end';
      stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn' | string;
      stop_details?: { category: string | null; explanation?: string } | null;
      /** Full assistant content to append verbatim to `messages`. */
      content: ApiContentBlock[];
      usage?: Record<string, unknown>;
    }
  | { type: 'error'; code: AgentErrorCode; retryable: boolean; message: string };

/** UI-side representation of agent progress ("streaming steps"). */
export interface AgentStep {
  id: string; // tool_use id
  tool: ToolName;
  title: string; // Spanish, e.g. 'Agregando LED rojo'
  status: 'pending' | 'running' | 'done' | 'error' | 'waiting-user';
  detail?: string;
}

export interface DecisionCard {
  toolUseId: string;
  question: string;
  options: Array<{ id: string; label: string; description?: string }>;
  allowFreeText: boolean;
  answered?: { choiceId: string | null; text?: string };
}
