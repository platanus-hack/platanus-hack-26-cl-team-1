/**
 * POST /api/agent/turn → SSE stream of AgentEvent (see contracts/agent.ts).
 * Returns how the stream ended; never throws.
 */
import type { AgentErrorCode, AgentEvent, AgentTurnRequest } from '@/contracts';
import { SSEParser } from './sse';

export const AGENT_ENDPOINT = '/api/agent/turn';

export type MessageEndEvent = Extract<AgentEvent, { type: 'message_end' }>;

export interface StreamError {
  code: AgentErrorCode | 'network' | 'incomplete';
  message: string;
  retryable: boolean;
}

export type StreamOutcome =
  | { kind: 'ended'; end: MessageEndEvent }
  | { kind: 'error'; error: StreamError }
  | { kind: 'aborted' };

export interface StreamOptions {
  onEvent: (e: AgentEvent) => void;
  signal?: AbortSignal;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const EVENT_TYPES = new Set(['message_start', 'thinking_delta', 'text_delta', 'tool_use_start', 'tool_use', 'message_end', 'error']);

/** Parse one SSE data payload into an AgentEvent (null when malformed or unknown). */
export function parseAgentEvent(data: string): AgentEvent | null {
  try {
    const v: unknown = JSON.parse(data);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const type = (v as { type?: unknown }).type;
    if (typeof type !== 'string' || !EVENT_TYPES.has(type)) return null;
    return v as AgentEvent;
  } catch {
    return null;
  }
}

function httpError(status: number): StreamError {
  if (status === 422 || status === 400) {
    return { code: 'invalid_request', message: 'La conversación quedó en un estado inválido. Empieza una conversación nueva.', retryable: false };
  }
  return {
    code: 'network',
    message: 'No pude conectar con el servidor del asistente. Revisa que el backend esté corriendo y reintenta.',
    retryable: true,
  };
}

const isAbort = (e: unknown) => e instanceof DOMException ? e.name === 'AbortError' : (e as { name?: string })?.name === 'AbortError';

export async function streamAgentTurn(req: AgentTurnRequest, opts: StreamOptions): Promise<StreamOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.endpoint ?? AGENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(req),
      signal: opts.signal,
    });
  } catch (e) {
    if (isAbort(e) || opts.signal?.aborted) return { kind: 'aborted' };
    return { kind: 'error', error: httpError(0) };
  }
  if (!res.ok || !res.body) return { kind: 'error', error: httpError(res.status) };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser();
  // Holder object: closures assign it (TS would narrow plain `let`s to null).
  const st: { end: MessageEndEvent | null; error: StreamError | null } = { end: null, error: null };

  const handle = (data: string) => {
    const ev = parseAgentEvent(data);
    if (!ev) return;
    if (ev.type === 'message_end') st.end = ev;
    else if (ev.type === 'error') st.error = { code: ev.code, message: ev.message, retryable: ev.retryable };
    opts.onEvent(ev);
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const m of parser.push(decoder.decode(value, { stream: true }))) handle(m.data);
    }
    for (const m of parser.push(decoder.decode() + '\n\n')) handle(m.data);
  } catch (e) {
    if (isAbort(e) || opts.signal?.aborted) return { kind: 'aborted' };
    if (!st.end && !st.error) st.error = { code: 'incomplete', message: 'Se cortó la conexión con el asistente antes de terminar.', retryable: true };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  if (opts.signal?.aborted) return { kind: 'aborted' };
  if (st.error) return { kind: 'error', error: st.error };
  if (st.end) return { kind: 'ended', end: st.end };
  return { kind: 'error', error: { code: 'incomplete', message: 'La respuesta del asistente llegó incompleta.', retryable: true } };
}
