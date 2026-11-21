/**
 * WORKSTREAM B — block editor public API (owned by the Blockly agent).
 *
 * Rules: irToWorkspace writes a stable `id` on every block (node.id, else a
 * deterministic generated id) and workspaceToIR copies block.id into every IR
 * node `id`. Part/pin dropdowns always include the field's current value (shown
 * as "(falta) led2" when missing) so loading never rewrites references.
 *
 * Internal files: kinds (vocabulary), defs/register/theme/fields (Blockly
 * definitions), toolbox, toIR, fromIR, validate, memo, warnings, flyouts.
 */
import type { ProgramIR, ProjectModel } from '@/contracts';
import type { ProgramContext } from '../context';
import { registerBlocks as register } from './register';
import { buildToolbox as toolbox, type ToolboxDef } from './toolbox';
import { workspaceToIR as toIR } from './toIR';
import { irToWorkspace as fromIR } from './fromIR';
import { validateIR as validate } from './validate';
import { getProgramErrors as memoErrors, getProgramIR as memoIR } from './memo';
import type { WorkspaceState } from './types';

/** Register all custom block definitions with Blockly (idempotent). */
export function registerBlocks(): void {
  register();
}

/** Toolbox JSON (Blockly category toolbox) for the current hardware. */
export function buildToolbox(ctx: ProgramContext): ToolboxDef {
  return toolbox(ctx);
}

/** Blockly workspace JSON → Block IR (headless; works without a DOM workspace). */
export function workspaceToIR(workspace: unknown | null, ctx: ProgramContext | null): { ir: ProgramIR; errors: string[] } {
  return toIR(workspace, ctx);
}

/**
 * Block IR → Blockly workspace JSON (agent set_program, examples). Missing
 * variables/functions default to []; referenced-but-undeclared variables are
 * auto-declared. Unsupported nodes are reported in `errors`.
 */
export function irToWorkspace(ir: Partial<ProgramIR>, ctx?: ProgramContext): { workspace: WorkspaceState; errors: string[] } {
  return fromIR(ir, ctx);
}

/** Validate an IR (node kinds, required fields, existing parts, part type allows the node, pin caps). Spanish messages with node paths. */
export function validateIR(ir: ProgramIR, ctx: ProgramContext): { errors: string[]; warnings: string[] } {
  return validate(ir, ctx);
}

/** Memoized IR of a project's current workspace. */
export function getProgramIR(project: ProjectModel): ProgramIR {
  return memoIR(project);
}

/** Memoized workspaceToIR errors (loose blocks outside setup/loop, missing parts…). */
export function getProgramErrors(project: ProjectModel): string[] {
  return memoErrors(project);
}

/* ---- extras for the editor view and tests ---- */
export type { ToolboxDef, ToolboxCategory, ToolboxItem, ToolboxBlock } from './toolbox';
export type { WorkspaceState, BlockState } from './types';
export { NO_BOARD_HINT, PROCEDURE_CATEGORY } from './toolbox';
export { createHeadlessWorkspace, loadSilently, irFromBlocklyWorkspace } from './toIR';
export { computeBlockWarnings, partWarning, pinWarning } from './warnings';
export { registerToolboxCallbacks } from './flyouts';
export { refreshDynamicFields, FieldDynamicDropdown } from './fields';
export { getTheme, THEME_NAME } from './theme';
export { checkerPlugin } from './checker';
export { CATEGORIES, type CategoryKey } from './palette';
export { B as BLOCK_TYPES, HAT_TYPES } from './kinds';
