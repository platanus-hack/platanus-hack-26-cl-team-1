import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentTurnRequest, ApiContentBlock } from '@/contracts';
import type { StreamOptions, StreamOutcome } from './api';

/* Scripted transport: each POST pops one script (events + outcome). */
type Script = { events: AgentEvent[]; outcome?: StreamOutcome };
const scripts: Script[] = [];
const requests: AgentTurnRequest[] = [];

vi.mock('./api', () => ({
  streamAgentTurn: vi.fn(async (req: AgentTurnRequest, opts: StreamOptions): Promise<StreamOutcome> => {
    requests.push(structuredClone(req));
    const s = scripts.shift();
    if (!s) return { kind: 'error', error: { code: 'internal', message: 'sin guion', retryable: false } };
    for (const e of s.events) opts.onEvent(e);
    if (s.outcome) return s.outcome;
    const end = s.events.find((e) => e.type === 'message_end');
    return end && end.type === 'message_end' ? { kind: 'ended', end } : { kind: 'error', error: { code: 'incomplete', message: 'x', retryable: true } };
  }),
}));

vi.mock('./appContext', () => ({
  snapshotAppContext: () => ({ view: 'hardware', board: 'uno', parts: 2, wires: 0, issues: 0, errors: 0, simRunning: false }),
  requestContext: () => ({ view: 'hardware', board: 'uno', partCount: 2, issueCount: 0, simRunning: false }),
  contextBlock: () => ({ type: 'text', text: '<contexto_app>{"view":"hardware"}</contexto_app>' }),
}));

const executeTool = vi.fn();
vi.mock('./tools', () => ({
  executeTool: (...args: unknown[]) => executeTool(...args),
  describeToolCall: (name: string) => `paso ${name}`,
  isErrorPayload: (p: unknown) => !!p && typeof p === 'object' && 'error' in (p as object),
}));

const { sendMessage, answerDecision, stopAgent, retryTurn, openDecision } = await import('./loop');
const { useAgent } = await import('./store');

const toolUse = (id: string, name: string, input: object): ApiContentBlock => ({ type: 'tool_use', id, name, input });
const end = (stop_reason: string, content: ApiContentBlock[], stop_details?: { category: string | null; explanation?: string }): AgentEvent => ({
  type: 'message_end',
  stop_reason,
  content,
  ...(stop_details ? { stop_details } : {}),
});

const turn = () => useAgent.getState().turns[useAgent.getState().turns.length - 1];
const messages = () => useAgent.getState().messages;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  scripts.length = 0;
  requests.length = 0;
  executeTool.mockReset();
  useAgent.getState().reset();
});

describe('agent loop', () => {
  it('runs tools after message_end and appends one tool_result message', async () => {
    const c1 = [{ type: 'thinking', thinking: 'plan', signature: 'sig' }, { type: 'text', text: 'Agrego un LED.' }, toolUse('t1', 'add_part', { type: 'led' }), toolUse('t2', 'run_checks', {})];
    scripts.push({
      events: [
        { type: 'message_start', id: 'm1' },
        { type: 'thinking_delta', text: 'plan' },
        { type: 'text_delta', text: 'Agrego ' },
        { type: 'text_delta', text: 'un LED.' },
        { type: 'tool_use_start', id: 't1', name: 'add_part' },
        { type: 'tool_use', id: 't1', name: 'add_part', input: { type: 'led' } },
        { type: 'tool_use_start', id: 't2', name: 'run_checks' },
        { type: 'tool_use', id: 't2', name: 'run_checks', input: {} },
        end('tool_use', c1),
      ],
    });
    const c2 = [{ type: 'text', text: '¡Listo!' }];
    scripts.push({ events: [{ type: 'text_delta', text: '¡Listo!' }, end('end_turn', c2)] });
    executeTool.mockImplementation(async (name: string) => (name === 'add_part' ? { id: 'led1', label: 'LED 1' } : { error: 'falló' }));

    await sendMessage('Quiero un LED');

    expect(executeTool.mock.calls.map((c) => c[0])).toEqual(['add_part', 'run_checks']);
    expect(executeTool.mock.calls[0][2]).toMatchObject({ toolUseId: 't1', group: turn().id });
    const m = messages();
    expect(m).toHaveLength(4);
    expect(m[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Quiero un LED' },
        { type: 'text', text: '<contexto_app>{"view":"hardware"}</contexto_app>' },
      ],
    });
    expect(m[1]).toEqual({ role: 'assistant', content: c1 }); // verbatim, thinking included
    expect(m[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: '{"id":"led1","label":"LED 1"}' },
        { type: 'tool_result', tool_use_id: 't2', content: '{"error":"falló"}', is_error: true },
      ],
    });
    expect(m[3]).toEqual({ role: 'assistant', content: c2 });
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toHaveLength(3);
    const t = turn();
    expect(t.status).toBe('done');
    const steps = t.items.filter((i) => i.kind === 'step');
    expect(steps.map((s) => s.kind === 'step' && s.step.status)).toEqual(['done', 'error']);
    expect(t.items.filter((i) => i.kind === 'text').map((i) => i.kind === 'text' && i.text)).toEqual(['Agrego un LED.', '¡Listo!']);
    expect(useAgent.getState().busy).toBe(false);
  });

  it('refusal: appends nothing, drops streamed text and shows a notice', async () => {
    scripts.push({ events: [{ type: 'text_delta', text: 'Claro…' }, end('refusal', [], { category: null, explanation: 'Motivo.' })] });
    await sendMessage('algo');
    expect(messages()).toHaveLength(1);
    const t = turn();
    expect(t.items.some((i) => i.kind === 'text')).toBe(false);
    expect(t.items.find((i) => i.kind === 'notice')).toMatchObject({ tone: 'warning', text: expect.stringContaining('Motivo.') });
    expect(t.status).toBe('done');
  });

  it('max_tokens with tool_use: answers each with "Entrada truncada" and continues', async () => {
    const c1 = [toolUse('t1', 'set_program', { program: {} })];
    scripts.push({ events: [{ type: 'tool_use_start', id: 't1', name: 'set_program' }, end('max_tokens', c1)] });
    scripts.push({ events: [end('end_turn', [{ type: 'text', text: 'ok' }])] });
    await sendMessage('programa');
    expect(executeTool).not.toHaveBeenCalled();
    expect(messages()[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"error":"Entrada truncada, repite la llamada"}', is_error: true }],
    });
    expect(messages()).toHaveLength(4);
  });

  it('error event: appends nothing and retry re-POSTs the same messages', async () => {
    scripts.push({ events: [{ type: 'text_delta', text: 'parcial' }], outcome: { kind: 'error', error: { code: 'overloaded', message: 'Mucha demanda', retryable: true } } });
    await sendMessage('hola');
    expect(messages()).toHaveLength(1);
    expect(turn()).toMatchObject({ status: 'error', error: { retryable: true, message: 'Mucha demanda' } });
    expect(turn().items).toEqual([]);
    scripts.push({ events: [end('end_turn', [{ type: 'text', text: 'hola!' }])] });
    retryTurn(turn().id);
    await flush();
    expect(requests[1].messages).toEqual(requests[0].messages);
    expect(messages()).toHaveLength(2);
    expect(turn().status).toBe('done');
  });

  it('ask_user: shows a decision card, a typed reply answers it', async () => {
    const c1 = [toolUse('t1', 'ask_user', { question: '¿Qué color?', options: [{ id: 'r', label: 'Rojo' }, { id: 'v', label: 'Verde' }] })];
    scripts.push({ events: [end('tool_use', c1)] });
    scripts.push({ events: [end('end_turn', [{ type: 'text', text: 'Verde será' }])] });
    executeTool.mockImplementation(async (_n: string, input: { question: string; options: [] }, ctx: { askUser: (c: object) => Promise<{ choiceId: string | null; text?: string }>; toolUseId: string }) => {
      const a = await ctx.askUser({ toolUseId: ctx.toolUseId, question: input.question, options: input.options, allowFreeText: true });
      return { choice_id: a.choiceId, ...(a.text ? { text: a.text } : {}) };
    });
    const done = sendMessage('Un LED');
    await flush();
    expect(turn().status).toBe('waiting-user');
    expect(openDecision()?.question).toBe('¿Qué color?');
    await sendMessage('mejor verde'); // typed reply → card answer
    await done;
    expect(messages()[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"choice_id":null,"text":"mejor verde"}' }] });
    const card = turn().items.find((i) => i.kind === 'decision');
    expect(card?.kind === 'decision' && card.card.answered).toEqual({ choiceId: null, text: 'mejor verde' });
  });

  it('stop while a card is open: next message starts with stop results + kept partials', async () => {
    const c1 = [toolUse('t1', 'add_part', { type: 'led' }), toolUse('t2', 'ask_user', { question: '?', options: [] }), toolUse('t3', 'run_checks', {})];
    scripts.push({ events: [end('tool_use', c1)] });
    executeTool.mockImplementation(async (name: string, _i: unknown, ctx: { askUser: (c: object) => Promise<unknown>; toolUseId: string }) => {
      if (name === 'ask_user') {
        await ctx.askUser({ toolUseId: ctx.toolUseId, question: '?', options: [], allowFreeText: false });
        return { choice_id: null };
      }
      return { id: 'led1', label: 'LED 1' };
    });
    const done = sendMessage('hola');
    await flush();
    stopAgent();
    await done;
    expect(turn().status).toBe('stopped');
    expect(messages()).toHaveLength(2);
    expect(executeTool).toHaveBeenCalledTimes(2);

    // The card is still answerable, so a typed message answers it and closes the rest.
    scripts.push({ events: [end('end_turn', [{ type: 'text', text: 'ok' }])] });
    answerDecision('t2', { choiceId: 'x' });
    await flush();
    expect(messages()[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: '{"id":"led1","label":"LED 1"}' },
        { type: 'tool_result', tool_use_id: 't2', content: '{"choice_id":"x"}' },
        { type: 'tool_result', tool_use_id: 't3', content: '{"error":"El estudiante detuvo al asistente"}', is_error: true },
      ],
    });
  });
});

describe('agent loop — robustness', () => {
  it('an empty end_turn message is not appended (the API and the server reject empty content)', async () => {
    scripts.push({ events: [end('end_turn', [])] });
    await sendMessage('hola');
    expect(messages()).toHaveLength(1);
    expect(turn().status).toBe('done');
    expect(turn().items.some((i) => i.kind === 'notice')).toBe(true);
    // The next student message produces a request the server accepts (no empty content anywhere).
    scripts.push({ events: [end('end_turn', [{ type: 'text', text: 'ok' }])] });
    await sendMessage('¿sigues?');
    const sent = requests[requests.length - 1].messages;
    expect(sent.every((m) => (Array.isArray(m.content) ? m.content.length > 0 : m.content.trim().length > 0))).toBe(true);
  });

  it('a streamed tool_use that is not in the final content (mid-output fallback) leaves no stuck step', async () => {
    const fb = { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } };
    const c1 = [{ type: 'text', text: 'Agrego un LED.' }, fb, toolUse('t1', 'add_part', { type: 'led' })];
    scripts.push({
      events: [
        { type: 'tool_use_start', id: 't0', name: 'add_part' },
        { type: 'tool_use', id: 't0', name: 'add_part', input: { type: 'led' } },
        { type: 'tool_use_start', id: 't1', name: 'add_part' },
        { type: 'tool_use', id: 't1', name: 'add_part', input: { type: 'led' } },
        end('tool_use', c1),
      ],
    });
    scripts.push({ events: [end('end_turn', [{ type: 'text', text: 'listo' }])] });
    executeTool.mockResolvedValue({ id: 'led1', label: 'LED 1' });
    await sendMessage('un LED');
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(messages()[1]).toEqual({ role: 'assistant', content: c1 });
    const steps = turn().items.filter((i) => i.kind === 'step');
    expect(steps.map((s) => s.id)).toEqual(['t1']);
  });

  it('undo after a reload (history lost) does not claim "there were other changes"', async () => {
    const { useProject } = await import('@/store/project');
    const { useUI } = await import('@/store/ui');
    const { undoTurn } = await import('./loop');
    scripts.push({ events: [end('end_turn', [{ type: 'text', text: 'listo' }])] });
    await sendMessage('arma algo');
    useAgent.getState().patchTurn(turn().id, { changed: true });
    useProject.setState({ past: [], future: [] }); // what a page reload leaves behind
    const toasts: string[] = [];
    const orig = useUI.getState().toast;
    useUI.setState({ toast: ((msg: string) => toasts.push(msg)) as typeof orig });
    try {
      expect(undoTurn(turn().id)).toBe(false);
    } finally {
      useUI.setState({ toast: orig });
    }
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).not.toMatch(/otros cambios después/);
  });
});

describe('agent loop — iteration cap', () => {
  it('stops after 25 API calls with every tool_use answered exactly once', async () => {
    const { MAX_ITERATIONS } = await import('./loop');
    for (let i = 0; i < MAX_ITERATIONS + 3; i++) scripts.push({ events: [end('tool_use', [toolUse(`t${i}`, 'run_checks', {})])] });
    executeTool.mockResolvedValue({ issues: [] });
    await sendMessage('revisa todo');
    expect(requests).toHaveLength(MAX_ITERATIONS);
    const m = messages();
    expect(m[m.length - 1].role).toBe('user');
    for (let i = 1; i < m.length; i += 2) {
      const ids = (m[i].content as ApiContentBlock[]).filter((b) => b.type === 'tool_use').map((b) => b.id);
      const answered = (m[i + 1].content as ApiContentBlock[]).filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
      expect(answered).toEqual(ids);
    }
    expect(turn().status).toBe('done');
    expect(turn().items.at(-1)).toMatchObject({ kind: 'notice' });
    expect(useAgent.getState().busy).toBe(false);
  });
});

describe('agent loop — undo of a turn interleaved with student edits', () => {
  it('does not claim the whole turn was undone when only its last part could be', async () => {
    const { useProject } = await import('@/store/project');
    const { createStarterProject } = await import('@/store/newProject');
    const { useUI } = await import('@/store/ui');
    const { undoTurn } = await import('./loop');
    useProject.getState().replaceProject(createStarterProject('uno'));
    scripts.push({ events: [end('end_turn', [{ type: 'text', text: 'listo' }])] });
    await sendMessage('arma algo');
    const id = turn().id;
    const d = useProject.getState().dispatch;
    d({ op: 'part.setLabel', id: 'uno1', label: 'Placa A' }, { source: 'agent', group: id, label: 'Asistente: a' }); // agent, before the card
    d({ op: 'part.move', id: 'bb1', x: 40, y: 2 }, { source: 'user' }); // the student while the card is open
    d({ op: 'part.setLabel', id: 'bb1', label: 'Proto B' }, { source: 'agent', group: id, label: 'Asistente: b' }); // agent, after
    useAgent.getState().patchTurn(id, { changed: true });
    const toasts: string[] = [];
    const orig = useUI.getState().toast;
    useUI.setState({ toast: ((msg: string) => toasts.push(msg)) as typeof orig });
    try {
      undoTurn(id);
    } finally {
      useUI.setState({ toast: orig });
    }
    expect(useProject.getState().project.parts.find((p) => p.id === 'uno1')?.label).toBe('Placa A'); // still there
    expect(turn().undone).toBe(false);
    expect(toasts).toHaveLength(1);
  });
});

describe('agent loop — reload mid-turn (sessionStorage)', () => {
  async function reloadWith(state: object) {
    const storage = useAgent.persist.getOptions().storage!;
    await storage.setItem(useAgent.persist.getOptions().name!, { state, version: 1 });
    await useAgent.persist.rehydrate();
  }

  const askTu = toolUse('t2', 'ask_user', { question: '¿Color?', options: [{ id: 'r', label: 'Rojo' }, { id: 'v', label: 'Verde' }] });
  const assistant = { role: 'assistant' as const, content: [{ type: 'thinking', thinking: '', signature: 's' }, toolUse('t1', 'add_part', { type: 'led' }), askTu, toolUse('t3', 'run_checks', {})] };
  const partial = { type: 'tool_result', tool_use_id: 't1', content: '{"id":"led1","label":"LED 1"}' };
  const turnSnap = (status: string) => ({
    id: 'agent-reload', userText: 'Un LED', createdAt: 1, thinking: 'x', iter: 1, status, changed: true, undone: false,
    items: [
      { kind: 'step', id: 't1', iter: 1, step: { id: 't1', tool: 'add_part', title: 'a', status: 'done' } },
      { kind: 'step', id: 't2', iter: 1, step: { id: 't2', tool: 'ask_user', title: 'b', status: 'waiting-user' } },
      { kind: 'decision', id: 'card-t2', iter: 1, card: { toolUseId: 't2', question: '¿Color?', options: [{ id: 'r', label: 'Rojo' }, { id: 'v', label: 'Verde' }], allowFreeText: true } },
      { kind: 'step', id: 't3', iter: 1, step: { id: 't3', tool: 'run_checks', title: 'c', status: 'pending' } },
    ],
  });
  const base = () => ({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Un LED' }] }, assistant],
    turns: [turnSnap('waiting-user')],
    partialResults: { t1: partial },
  });

  it('marks the interrupted turn and a typed reply answers the open card, closing every tool_use once', async () => {
    await reloadWith(base());
    const t = turn();
    expect(t.status).toBe('done');
    expect(useAgent.getState().busy).toBe(false);
    expect(t.items.find((i) => i.kind === 'step' && i.id === 't3')).toMatchObject({ step: { status: 'error' } });
    expect(openDecision()?.toolUseId).toBe('t2');

    scripts.push({ events: [end('end_turn', [{ type: 'text', text: 'Verde entonces' }])] });
    await sendMessage('verde por favor');
    await flush();
    const sent = requests[0].messages;
    expect(sent).toHaveLength(3);
    expect(sent[1]).toEqual(assistant); // verbatim, thinking block included
    expect(sent[2]).toEqual({
      role: 'user',
      content: [
        partial,
        { type: 'tool_result', tool_use_id: 't2', content: '{"choice_id":null,"text":"verde por favor"}' },
        { type: 'tool_result', tool_use_id: 't3', content: '{"error":"El estudiante detuvo al asistente"}', is_error: true },
      ],
    });
    expect(useAgent.getState().partialResults).toEqual({});
  });

  it('a new message after a reload with no open card starts with the stop results', async () => {
    const snap = base();
    snap.turns = [{ ...turnSnap('tools'), items: turnSnap('tools').items.filter((i) => i.kind !== 'decision') }];
    await reloadWith(snap);
    expect(openDecision()).toBeNull();
    scripts.push({ events: [end('end_turn', [{ type: 'text', text: 'ok' }])] });
    await sendMessage('sigue');
    const last = requests[0].messages[2];
    expect(last.role).toBe('user');
    const blocks = last.content as ApiContentBlock[];
    expect(blocks.map((b) => b.type)).toEqual(['tool_result', 'tool_result', 'tool_result', 'text', 'text']);
    expect(blocks.slice(0, 3).map((b) => b.tool_use_id)).toEqual(['t1', 't2', 't3']);
    expect(blocks[1]).toMatchObject({ is_error: true });
  });
});
