import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@/contracts';
import { parseAgentEvent, streamAgentTurn } from './api';
import { SSEParser } from './sse';

const frame = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const BODY =
  frame('message_start', { id: 'msg_1' }) +
  ': ping\n\n' +
  frame('text_delta', { text: '¡Hola! ⚡ Voy a armar tu LED.' }) +
  frame('tool_use_start', { id: 'toolu_1', name: 'add_part' }) +
  frame('tool_use', { id: 'toolu_1', name: 'add_part', input: { type: 'led' } }) +
  frame('message_end', { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'add_part', input: { type: 'led' } }] });

function parseAll(chunks: string[]) {
  const p = new SSEParser();
  return chunks.flatMap((c) => p.push(c));
}

describe('SSEParser', () => {
  it('parses a whole body', () => {
    const msgs = parseAll([BODY]);
    expect(msgs.map((m) => m.event)).toEqual(['message_start', 'text_delta', 'tool_use_start', 'tool_use', 'message_end']);
    expect(JSON.parse(msgs[1].data).text).toBe('¡Hola! ⚡ Voy a armar tu LED.');
  });

  it('gives identical results for every chunk boundary', () => {
    const whole = parseAll([BODY]);
    for (let cut = 1; cut < BODY.length; cut += 7) {
      expect(parseAll([BODY.slice(0, cut), BODY.slice(cut)])).toEqual(whole);
    }
    expect(parseAll(BODY.split(''))).toEqual(whole);
  });

  it('handles CRLF split between chunks, comments and multi-line data', () => {
    const msgs = parseAll(['event: a\r', '\ndata: uno\r\ndata: dos\r', '\n\r\n: comentario\n', 'data: x\n\n']);
    expect(msgs).toEqual([
      { event: 'a', data: 'uno\ndos' },
      { event: 'message', data: 'x' },
    ]);
  });

  it('ignores frames without data', () => {
    expect(parseAll(['event: vacio\n\n', ': ping\n\n'])).toEqual([]);
  });
});

describe('parseAgentEvent', () => {
  it('rejects malformed or unknown payloads', () => {
    expect(parseAgentEvent('{oops')).toBeNull();
    expect(parseAgentEvent('{"type":"otra"}')).toBeNull();
    expect(parseAgentEvent('[1]')).toBeNull();
    expect(parseAgentEvent('{"type":"text_delta","text":"a"}')).toEqual({ type: 'text_delta', text: 'a' });
  });
});

/** fetch stub streaming `body` as UTF-8 bytes cut into `size`-byte chunks (splits multi-byte chars). */
function fakeFetch(body: string, size: number, status = 200): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (let i = 0; i < bytes.length; i += size) ctrl.enqueue(bytes.slice(i, i + size));
        ctrl.close();
      },
    });
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
}

describe('streamAgentTurn', () => {
  const req = { messages: [{ role: 'user' as const, content: 'hola' }] };

  it('relays events across byte-level chunk boundaries and ends with message_end', async () => {
    for (const size of [1, 3, 17, 4096]) {
      const events: AgentEvent[] = [];
      const out = await streamAgentTurn(req, { onEvent: (e) => events.push(e), fetchImpl: fakeFetch(BODY, size) });
      expect(out.kind).toBe('ended');
      expect(events.map((e) => e.type)).toEqual(['message_start', 'text_delta', 'tool_use_start', 'tool_use', 'message_end']);
      expect(events[1]).toEqual({ type: 'text_delta', text: '¡Hola! ⚡ Voy a armar tu LED.' });
    }
  });

  it('returns the server error event', async () => {
    const body = frame('error', { code: 'overloaded', retryable: true, message: 'Mucha demanda' });
    const out = await streamAgentTurn(req, { onEvent: () => {}, fetchImpl: fakeFetch(body, 5) });
    expect(out).toEqual({ kind: 'error', error: { code: 'overloaded', retryable: true, message: 'Mucha demanda' } });
  });

  it('treats a stream without message_end as incomplete (retryable)', async () => {
    const out = await streamAgentTurn(req, { onEvent: () => {}, fetchImpl: fakeFetch(frame('text_delta', { text: 'a' }), 4) });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.error).toMatchObject({ code: 'incomplete', retryable: true });
  });

  it('maps HTTP errors and aborts', async () => {
    const bad = await streamAgentTurn(req, { onEvent: () => {}, fetchImpl: fakeFetch('', 1, 422) });
    expect(bad.kind === 'error' && bad.error.retryable).toBe(false);
    const down = await streamAgentTurn(req, { onEvent: () => {}, fetchImpl: fakeFetch('', 1, 502) });
    expect(down.kind === 'error' && down.error.retryable).toBe(true);
    const ctrl = new AbortController();
    ctrl.abort();
    const aborted = await streamAgentTurn(req, { onEvent: () => {}, signal: ctrl.signal, fetchImpl: fakeFetch(BODY, 8) });
    expect(aborted.kind).toBe('aborted');
  });
});
