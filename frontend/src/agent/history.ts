/**
 * Pure helpers over the append-only API history (CLIENT RULES in contracts/agent.ts).
 */
import type { ApiContentBlock, ApiMessage, ToolResultPayload } from '@/contracts';

export const MAX_RESULT_CHARS = 12_000;
export const STOPPED_TEXT = 'El estudiante detuvo al asistente';
export const TRUNCATED_INPUT_TEXT = 'Entrada truncada, repite la llamada';

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export const isToolUse = (b: ApiContentBlock): b is ApiContentBlock & ToolUseBlock =>
  b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string';

export function toolUsesOf(content: ApiMessage['content']): ToolUseBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isToolUse).map((b) => ({ type: 'tool_use', id: b.id, name: b.name, input: b.input }));
}

/** tool_use blocks of the last message when it is an assistant message (nobody answered them yet). */
export function danglingToolUses(messages: ApiMessage[]): ToolUseBlock[] {
  const last = messages[messages.length - 1];
  return last && last.role === 'assistant' ? toolUsesOf(last.content) : [];
}

/**
 * JSON payload as tool_result content, ≤ 12 KB with a truncation note.
 * Objects are shrunk structurally (the longest arrays lose their last items,
 * long strings are cut) so the result stays VALID JSON and the small but
 * important fields (per_part, issues, ok, error…) survive; only non-objects
 * fall back to a plain cut.
 */
export function resultContent(payload: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(payload) ?? 'null';
  } catch {
    text = JSON.stringify({ error: 'Resultado no serializable' });
  }
  if (text.length <= MAX_RESULT_CHARS) return text;
  const fitted = fitObject(payload, text.length);
  if (fitted !== null) return fitted;
  const note = `… [resultado truncado: ${text.length} caracteres en total; pide menos datos]`;
  return `${text.slice(0, MAX_RESULT_CHARS - note.length)}${note}`;
}

const NOTE_KEY = 'recorte';

function fitObject(payload: unknown, fullLength: number): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const cuts = new Map<string, { kept: number; total: number } | 'texto' | 'omitido'>();
  const render = (): string => {
    const parts = [...cuts].map(([k, c]) =>
      c === 'texto' ? `«${k}» acortado` : c === 'omitido' ? `«${k}» omitido` : `«${k}»: ${c.kept} de ${c.total} elementos`,
    );
    const note = `Aviso: resultado truncado (${fullLength} caracteres en total): ${parts.join(', ')}. Pide menos datos (p. ej. una simulación más corta).`;
    return JSON.stringify(cuts.size ? { ...obj, ...('truncated' in obj ? { truncated: true } : {}), [NOTE_KEY]: note } : obj);
  };
  for (let guard = 0; guard < 400; guard++) {
    const text = render();
    if (text.length <= MAX_RESULT_CHARS) return text;
    const excess = text.length - MAX_RESULT_CHARS;
    // Largest shrinkable field: non-empty arrays / long strings first, whole objects last.
    let best: string | null = null;
    let bestLen = 0;
    let bestRank = -1;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'error' || k === NOTE_KEY) continue;
      const rank = (Array.isArray(v) && v.length > 0) || (typeof v === 'string' && v.length > 200) ? 1 : v && typeof v === 'object' && !Array.isArray(v) ? 0 : -1;
      if (rank < 0) continue;
      const len = JSON.stringify(v).length;
      if (rank > bestRank || (rank === bestRank && len > bestLen)) {
        best = k;
        bestLen = len;
        bestRank = rank;
      }
    }
    if (best === null) return null;
    const v = obj[best];
    if (Array.isArray(v)) {
      const prev = cuts.get(best);
      const total = prev && typeof prev === 'object' ? prev.total : v.length;
      const drop = Math.min(v.length, Math.max(1, Math.ceil((excess + 160) / Math.max(1, bestLen / v.length))));
      obj[best] = v.slice(0, v.length - drop);
      cuts.set(best, { kept: v.length - drop, total });
    } else if (typeof v === 'string') {
      obj[best] = `${v.slice(0, Math.max(0, v.length - excess - 200))}…`;
      cuts.set(best, 'texto');
    } else {
      obj[best] = null;
      cuts.set(best, 'omitido');
    }
  }
  return null;
}

const payloadIsError = (p: unknown) => !!p && typeof p === 'object' && !Array.isArray(p) && 'error' in (p as object);

export function toolResultBlock(toolUseId: string, payload: ToolResultPayload | unknown): ApiContentBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: resultContent(payload),
    ...(payloadIsError(payload) ? { is_error: true } : {}),
  };
}

export function errorResultBlock(toolUseId: string, message: string): ApiContentBlock {
  return toolResultBlock(toolUseId, { error: message });
}

/**
 * Results for dangling tool_use blocks before a new user message: results
 * computed before an abort are kept, an open ask_user can be answered with the
 * typed text, everything else gets "El estudiante detuvo al asistente".
 */
export function closeDangling(
  dangling: ToolUseBlock[],
  partials: Record<string, ApiContentBlock>,
  askAnswers: Record<string, { choiceId: string | null; text?: string }> = {},
): ApiContentBlock[] {
  return dangling.map((tu) => {
    if (partials[tu.id]) return partials[tu.id];
    const ans = askAnswers[tu.id];
    if (tu.name === 'ask_user' && ans) {
      return toolResultBlock(tu.id, { choice_id: ans.choiceId, ...(ans.text ? { text: ans.text } : {}) });
    }
    return errorResultBlock(tu.id, STOPPED_TEXT);
  });
}

/** The student-typed text of a user message (first text block), ignoring tool results and <contexto_app>. */
export function studentText(m: ApiMessage): string {
  if (typeof m.content === 'string') return m.content;
  const t = m.content.find((b) => b.type === 'text' && typeof b.text === 'string' && !String(b.text).startsWith('<contexto_app>'));
  return t ? String(t.text) : '';
}
