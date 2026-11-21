/**
 * Minimal typings of Blockly's JSON serialization (what
 * Blockly.serialization.workspaces.save produces) — only the parts we read or
 * write. Kept local so the IR converters stay plain data transformations.
 */

export type FieldValue = string | number | boolean | { id: string; name?: string; type?: string };

export interface BlockState {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  deletable?: boolean;
  movable?: boolean;
  editable?: boolean;
  enabled?: boolean;
  inline?: boolean;
  collapsed?: boolean;
  extraState?: unknown;
  fields?: Record<string, FieldValue>;
  inputs?: Record<string, InputState>;
  next?: { block?: BlockState; shadow?: BlockState };
}

export interface InputState {
  block?: BlockState;
  shadow?: BlockState;
}

export interface VariableState {
  name: string;
  id: string;
  type?: string;
}

/** Extra metadata we persist next to Blockly's own state (see varMeta.ts). */
export interface VarMetaEntry {
  type?: 'number' | 'boolean';
  init?: number | boolean;
}

export interface WorkspaceState {
  blocks?: { languageVersion: number; blocks: BlockState[] };
  variables?: VariableState[];
  /** VarDecl metadata keyed by Blockly variable id (type hint + initial value). */
  cvVariables?: Record<string, VarMetaEntry>;
  [key: string]: unknown;
}

export const isWorkspaceState = (v: unknown): v is WorkspaceState =>
  !!v && typeof v === 'object' && !Array.isArray(v);
