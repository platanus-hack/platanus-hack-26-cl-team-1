/**
 * The agent loop ("server turn, client tools"): POST the history, stream one
 * assistant message, run its tools after `message_end`, append ONE user
 * message with every tool_result, repeat (max 25 iterations per student
 * message). Follows the CLIENT RULES in contracts/agent.ts.
 */
import { nanoid } from 'nanoid';
import type { AgentEvent, AgentStep, ApiContentBlock, ApiMessage, DecisionCard, ToolName } from '@/contracts';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { streamAgentTurn } from './api';
import { contextBlock, requestContext, snapshotAppContext } from './appContext';
import { closeDangling, danglingToolUses, errorResultBlock, toolResultBlock, TRUNCATED_INPUT_TEXT, type ToolUseBlock } from './history';
import { isToolName } from './schema';
import { getTurn, lastTurn, useAgent, type Turn, type TurnItem } from './store';
import { describeToolCall, executeTool, isErrorPayload } from './tools';

export const MAX_ITERATIONS = 25;

type Answer = { choiceId: string | null; text?: string };

let controller: AbortController | null = null;
const pendingAsks = new Map<string, (a: Answer) => void>();

const st = () => useAgent.getState();

/* ------------------------------------------------------------------ turn edits */

function patchItems(turnId: string, fn: (items: TurnItem[], t: Turn) => TurnItem[]) {
  st().patchTurn(turnId, (t) => ({ items: fn(t.items, t) }));
}

function patchStep(turnId: string, stepId: string, patch: Partial<AgentStep>) {
  patchItems(turnId, (items) => items.map((it) => (it.kind === 'step' && it.id === stepId ? { ...it, step: { ...it.step, ...patch } } : it)));
}

function addNotice(turnId: string, iter: number, tone: 'info' | 'warning', text: string) {
  patchItems(turnId, (items) => [...items, { kind: 'notice', id: nanoid(8), iter, tone, text }]);
}

/** Drop everything an iteration streamed (error / refusal / abort before message_end). */
function dropIteration(turnId: string, iter: number) {
  patchItems(turnId, (items) => items.filter((it) => it.iter !== iter));
}

/* --------------------------------------------------------------- event intake */

function makeEventHandler(turnId: string, iter: number) {
  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!buffer) return;
    const text = buffer;
    buffer = '';
    st().patchTurn(turnId, (t) => {
      const items = t.items.slice();
      const last = items[items.length - 1];
      if (last && last.kind === 'text' && last.iter === iter) items[items.length - 1] = { ...last, text: last.text + text };
      else items.push({ kind: 'text', id: nanoid(8), iter, text });
      return { items, thinking: '' };
    });
  };

  const onEvent = (e: AgentEvent) => {
    switch (e.type) {
      case 'text_delta':
        buffer += e.text;
        if (!timer) timer = setTimeout(flush, 40);
        break;
      case 'thinking_delta':
        st().patchTurn(turnId, (t) => ({ thinking: (t.thinking + e.text).slice(-600) }));
        break;
      case 'tool_use_start': {
        flush();
        const tool = (isToolName(e.name) ? e.name : 'get_project') as ToolName;
        const step: AgentStep = { id: e.id, tool, title: describeToolCall(tool, {}), status: 'pending' };
        patchItems(turnId, (items) => [...items, { kind: 'step', id: e.id, iter, step }]);
        break;
      }
      case 'tool_use':
        flush();
        if (isToolName(e.name)) patchStep(turnId, e.id, { title: describeToolCall(e.name, e.input) });
        break;
      default:
        flush();
    }
  };
  return { onEvent, flush };
}

/* ---------------------------------------------------------------- decisions */

function askUser(turnId: string, iter: number, card: DecisionCard, signal: AbortSignal): Promise<Answer> {
  patchItems(turnId, (items) => [...items, { kind: 'decision', id: `card-${card.toolUseId}`, iter, card }]);
  patchStep(turnId, card.toolUseId, { status: 'waiting-user' });
  st().patchTurn(turnId, { status: 'waiting-user' });
  return new Promise<Answer>((resolve) => {
    const done = (a: Answer) => {
      pendingAsks.delete(card.toolUseId);
      signal.removeEventListener('abort', onAbort);
      resolve(a);
    };
    const onAbort = () => done({ choiceId: null });
    pendingAsks.set(card.toolUseId, done);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function markAnswered(toolUseId: string, answer: Answer) {
  useAgent.setState((s) => ({
    turns: s.turns.map((t) => {
      const cardItem = t.items.find((it) => it.kind === 'decision' && it.card.toolUseId === toolUseId);
      if (!cardItem || cardItem.kind !== 'decision') return t;
      const chosen = cardItem.card.options.find((o) => o.id === answer.choiceId)?.label ?? answer.text ?? '';
      return {
        ...t,
        items: t.items.map((it) => {
          if (it.kind === 'decision' && it.card.toolUseId === toolUseId) return { ...it, card: { ...it.card, answered: answer } };
          if (it.kind === 'step' && it.id === toolUseId && chosen) {
            return { ...it, step: { ...it.step, title: `Respondiste: ${chosen.length > 60 ? `${chosen.slice(0, 59)}…` : chosen}` } };
          }
          return it;
        }),
      };
    }),
  }));
}

/** A card can still be answered: its promise is pending, or its tool_use is unanswered in the history. */
function answerable(card: DecisionCard): boolean {
  return pendingAsks.has(card.toolUseId) || danglingToolUses(st().messages).some((tu) => tu.id === card.toolUseId);
}

/** The open (unanswered and still answerable) decision card of the latest turn, if any. */
export function openDecision(): DecisionCard | null {
  const t = lastTurn();
  if (!t) return null;
  for (let i = t.items.length - 1; i >= 0; i--) {
    const it = t.items[i];
    if (it.kind === 'decision' && !it.card.answered) return answerable(it.card) ? it.card : null;
  }
  return null;
}

/* ----------------------------------------------------------------- the loop */

async function runTools(turnId: string, iter: number, toolUses: ToolUseBlock[], signal: AbortSignal): Promise<ApiContentBlock[] | null> {
  st().patchTurn(turnId, { status: 'tools' });
  const results: ApiContentBlock[] = [];
  for (const tu of toolUses) {
    if (signal.aborted) return null;
    const turn = getTurn(turnId);
    if (turn && !turn.items.some((it) => it.kind === 'step' && it.id === tu.id) && isToolName(tu.name)) {
      const step: AgentStep = { id: tu.id, tool: tu.name, title: describeToolCall(tu.name, tu.input), status: 'pending' };
      patchItems(turnId, (items) => [...items, { kind: 'step', id: tu.id, iter, step }]);
    }
    patchStep(turnId, tu.id, { status: 'running' });
    const before = useProject.getState().project;
    const payload = isToolName(tu.name)
      ? await executeTool(tu.name, tu.input, {
          toolUseId: tu.id,
          group: turnId,
          signal,
          askUser: (card) => askUser(turnId, iter, card, signal),
          onProgress: (detail) => patchStep(turnId, tu.id, { detail }),
        })
      : { error: `Herramienta desconocida «${tu.name}».` };
    if (useProject.getState().project !== before) st().patchTurn(turnId, { changed: true, undone: false });
    if (signal.aborted) {
      patchStep(turnId, tu.id, { status: 'error', detail: 'Detenido' });
      return null;
    }
    const failed = isErrorPayload(payload);
    patchStep(turnId, tu.id, { status: failed ? 'error' : 'done', detail: failed ? payload.error : getTurnStepDetail(turnId, tu.id) });
    if (getTurn(turnId)?.status === 'waiting-user') st().patchTurn(turnId, { status: 'tools' });
    const block = toolResultBlock(tu.id, payload);
    results.push(block);
    st().setPartial(tu.id, block);
  }
  return results;
}

function getTurnStepDetail(turnId: string, stepId: string): string | undefined {
  const it = getTurn(turnId)?.items.find((i) => i.kind === 'step' && i.id === stepId);
  return it && it.kind === 'step' ? it.step.detail : undefined;
}

async function runLoop(turnId: string): Promise<void> {
  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;
  const { signal } = ctrl;
  st().setBusy(true);
  try {
    for (let n = 0; n < MAX_ITERATIONS; n++) {
      const turn = getTurn(turnId);
      if (!turn) return;
      const iter = turn.iter + 1;
      st().patchTurn(turnId, { iter, status: 'streaming', thinking: '', error: undefined });
      const handler = makeEventHandler(turnId, iter);
      const outcome = await streamAgentTurn(
        { messages: st().messages, context: requestContext(snapshotAppContext()) },
        { signal, onEvent: handler.onEvent },
      );
      handler.flush();

      if (outcome.kind === 'aborted') {
        dropIteration(turnId, iter);
        st().patchTurn(turnId, { status: 'stopped', thinking: '' });
        return;
      }
      if (outcome.kind === 'error') {
        dropIteration(turnId, iter);
        st().patchTurn(turnId, { status: 'error', thinking: '', error: { ...outcome.error } });
        return;
      }
      const end = outcome.end;
      if (end.stop_reason === 'refusal') {
        dropIteration(turnId, iter);
        const why = end.stop_details?.explanation;
        addNotice(turnId, iter, 'warning', `No puedo ayudarte con eso. ${why ? `${why} ` : ''}Probemos con otra pregunta sobre tu circuito o tu programa.`);
        st().patchTurn(turnId, { status: 'done', thinking: '' });
        return;
      }
      if (end.stop_reason === 'pause_turn') {
        dropIteration(turnId, iter);
        st().patchTurn(turnId, { status: 'error', thinking: '', error: { message: 'El asistente se detuvo de forma inesperada.', retryable: true } });
        return;
      }

      if (!Array.isArray(end.content) || end.content.length === 0) {
        // An empty assistant message is invalid history (the API and the server reject it with
        // 4xx forever after): append nothing — consecutive user messages are fine.
        const said = getTurn(turnId)?.items.some((it) => it.kind === 'text' && it.text.trim());
        if (!said) addNotice(turnId, iter, 'info', 'No me llegó una respuesta. Vuelve a preguntarme o dime cómo seguimos.');
        st().patchTurn(turnId, { status: 'done', thinking: '' });
        return;
      }

      st().appendMessage({ role: 'assistant', content: end.content });
      st().patchTurn(turnId, { thinking: '' });
      const toolUses = end.content.filter((b) => b.type === 'tool_use') as unknown as ToolUseBlock[];
      // Steps streamed for tool_use blocks that are not in the final content (a declined
      // model's call before a mid-output fallback) will never run: drop them.
      const ids = new Set(toolUses.map((tu) => tu.id));
      patchItems(turnId, (items) => items.filter((it) => !(it.kind === 'step' && it.iter === iter && !ids.has(it.id))));

      if (end.stop_reason === 'max_tokens') {
        if (toolUses.length === 0) {
          addNotice(turnId, iter, 'info', 'La respuesta era muy larga y se cortó. Pídeme que continúe si quieres el resto.');
          st().patchTurn(turnId, { status: 'done' });
          return;
        }
        for (const tu of toolUses) patchStep(turnId, tu.id, { status: 'error', detail: 'Entrada incompleta: se repetirá' });
        st().appendMessage({ role: 'user', content: toolUses.map((tu) => errorResultBlock(tu.id, TRUNCATED_INPUT_TEXT)) });
        continue;
      }
      if (end.stop_reason !== 'tool_use' || toolUses.length === 0) {
        st().patchTurn(turnId, { status: 'done' });
        return;
      }

      const results = await runTools(turnId, iter, toolUses, signal);
      if (!results) {
        st().patchTurn(turnId, { status: 'stopped', thinking: '' });
        return;
      }
      st().appendMessage({ role: 'user', content: results });
      st().clearPartials();
    }
    addNotice(turnId, getTurn(turnId)?.iter ?? 0, 'info', 'Hice muchos pasos seguidos y me detuve para no alargarme. Dime si sigo.');
    st().patchTurn(turnId, { status: 'done' });
  } catch (e) {
    console.error('[agent] loop failed', e);
    st().patchTurn(turnId, { status: 'error', error: { message: 'Ocurrió un error inesperado en el asistente.', retryable: true } });
  } finally {
    if (controller === ctrl) {
      controller = null;
      st().setBusy(false);
    }
  }
}

/* ---------------------------------------------------------------- public API */

function newTurn(userText: string): Turn {
  return { id: `agent-${nanoid(10)}`, userText, createdAt: Date.now(), items: [], thinking: '', iter: 0, status: 'streaming', changed: false, undone: false };
}

/** Send a student message (or answer the open decision card with free text). */
export async function sendMessage(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text) return;
  const card = openDecision();
  if (card) {
    answerDecision(card.toolUseId, { choiceId: null, text });
    return;
  }
  if (st().busy) return;
  const prefix = closeDangling(danglingToolUses(st().messages), st().partialResults);
  const content: ApiContentBlock[] = [...prefix, { type: 'text', text }, contextBlock()];
  const msg: ApiMessage = { role: 'user', content };
  const turn = newTurn(text);
  st().clearPartials();
  st().appendMessage(msg);
  st().addTurn(turn);
  await runLoop(turn.id);
}

/** Answer a decision card (button or free text). Works after a reload too. */
export function answerDecision(toolUseId: string, answer: Answer): void {
  const live = pendingAsks.get(toolUseId);
  if (live) {
    markAnswered(toolUseId, answer);
    live(answer);
    return;
  }
  // No pending promise (page reloaded / agent stopped): answer through the history.
  if (st().busy) return;
  const dangling = danglingToolUses(st().messages);
  if (!dangling.some((tu) => tu.id === toolUseId)) return;
  markAnswered(toolUseId, answer);
  const turn = st().turns.find((t) => t.items.some((it) => it.kind === 'decision' && it.card.toolUseId === toolUseId)) ?? lastTurn();
  if (!turn) return;
  const results = closeDangling(dangling, st().partialResults, { [toolUseId]: answer });
  st().clearPartials();
  st().appendMessage({ role: 'user', content: results });
  patchStep(turn.id, toolUseId, { status: 'done' });
  void runLoop(turn.id);
}

/** Stop button: abort the stream / pending tools. */
export function stopAgent(): void {
  controller?.abort();
}

/** Re-POST the same history after a retryable error. */
export function retryTurn(turnId: string): void {
  if (st().busy) return;
  const turn = getTurn(turnId);
  if (!turn || lastTurn()?.id !== turnId) return;
  void runLoop(turnId);
}

export function newConversation(): void {
  stopAgent();
  for (const resolve of [...pendingAsks.values()]) resolve({ choiceId: null });
  pendingAsks.clear();
  st().reset();
}

/** The turn's changes are still in the undo history (lost after a reload or once 200 newer steps exist). */
export const turnInHistory = (turnId: string, past = useProject.getState().past): boolean => past.some((e) => e.group === turnId);

/** "Deshacer cambios del asistente": undo the turn's history group. */
export function undoTurn(turnId: string): boolean {
  const ok = useProject.getState().undoGroup(turnId);
  if (ok) {
    // The student may have edited the circuit mid-turn (e.g. while a question card was open):
    // then the turn's earlier changes are a separate history entry behind that edit.
    const rest = turnInHistory(turnId);
    st().patchTurn(turnId, { undone: !rest });
    if (rest) useUI.getState().toast('Deshice la última parte de los cambios del asistente; el resto quedó antes de cambios tuyos. Usa Ctrl+Z para seguir retrocediendo.', 'warning');
  } else if (!turnInHistory(turnId)) {
    useUI.getState().toast('Ya no puedo deshacer esos cambios: el historial se borró (por ejemplo, al recargar la página).', 'warning');
  } else useUI.getState().toast('No pude deshacerlo: hubo otros cambios después. Usa Ctrl+Z para retroceder paso a paso.', 'warning');
  return ok;
}
