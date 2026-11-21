/**
 * Workspace serializer "cvVariables": keeps IR VarDecl metadata (declared type
 * and initial value) that Blockly variables cannot express, keyed by Blockly
 * variable id so it survives renames and editor save/load cycles.
 */
import * as Blockly from 'blockly';
import type { VarMetaEntry } from './types';

export const VAR_META_KEY = 'cvVariables';

type Meta = Record<string, VarMetaEntry>;
const metaByWorkspace = new WeakMap<Blockly.Workspace, Meta>();

function sanitize(state: unknown): Meta {
  const out: Meta = {};
  if (!state || typeof state !== 'object') return out;
  for (const [id, raw] of Object.entries(state as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const entry: VarMetaEntry = {};
    if (r.type === 'number' || r.type === 'boolean') entry.type = r.type;
    if (typeof r.init === 'number' || typeof r.init === 'boolean') entry.init = r.init;
    if (entry.type !== undefined || entry.init !== undefined) out[id] = entry;
  }
  return out;
}

export function getVarMeta(ws: Blockly.Workspace): Meta {
  return metaByWorkspace.get(ws) ?? {};
}

const serializer: Blockly.serialization.ISerializer = {
  priority: Blockly.serialization.priorities.VARIABLES - 1,
  save(ws) {
    const meta = metaByWorkspace.get(ws);
    if (!meta) return null;
    const live: Meta = {};
    for (const [id, entry] of Object.entries(meta)) {
      if (ws.getVariableMap().getVariableById(id)) live[id] = entry;
    }
    return Object.keys(live).length ? live : null;
  },
  load(state, ws) {
    metaByWorkspace.set(ws, sanitize(state));
  },
  clear(ws) {
    metaByWorkspace.delete(ws);
  },
};

export function registerVarMetaSerializer(): void {
  try {
    Blockly.serialization.registry.register(VAR_META_KEY, serializer);
  } catch {
    /* already registered (HMR / second call) */
  }
}
