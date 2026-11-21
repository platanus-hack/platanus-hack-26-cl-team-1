/**
 * Live app snapshot: the <contexto_app> block embedded in each student message
 * (CLIENT RULES) and the log-only AgentTurnRequest.context.
 */
import type { AgentTurnRequest, ApiContentBlock, CheckIssue, ProjectSummary } from '@/contracts';
import { projectBoard } from '@/catalog';
import { getProgramErrors, getProgramIR } from '@/program/blocks';
import { getBindings, getIssues, getNetlist } from '@/store/derived';
import { getProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { useUI } from '@/store/ui';
import { buildProjectSummary } from './summary';

export interface AppContextPayload {
  view: 'hardware' | 'schematic' | 'software';
  board: 'uno' | 'esp32c6' | null;
  parts: number;
  wires: number;
  issues: number;
  errors: number;
  simRunning: boolean;
  selection?: string[];
}

function safeIssues(): CheckIssue[] {
  try {
    return getIssues(getProject());
  } catch {
    return [];
  }
}

export function snapshotAppContext(): AppContextPayload {
  const project = getProject();
  const ui = useUI.getState();
  const issues = safeIssues();
  const selection = ui.selection.parts;
  return {
    view: ui.currentView(),
    board: projectBoard(project)?.profile.id ?? null,
    parts: project.parts.length,
    wires: project.wires.length,
    issues: issues.length,
    errors: issues.filter((i) => i.severity === 'error').length,
    simRunning: useSim.getState().program === 'running',
    ...(selection.length ? { selection: selection.slice(0, 8) } : {}),
  };
}

export const contextText = (c: AppContextPayload): string => `<contexto_app>${JSON.stringify(c)}</contexto_app>`;

export function contextBlock(c: AppContextPayload = snapshotAppContext()): ApiContentBlock {
  return { type: 'text', text: contextText(c) };
}

export function requestContext(c: AppContextPayload = snapshotAppContext()): NonNullable<AgentTurnRequest['context']> {
  return { view: c.view, board: c.board, partCount: c.parts, issueCount: c.issues, simRunning: c.simRunning };
}

/** get_project: the full ProjectSummary from the live stores. */
export function getProjectSummary(): ProjectSummary {
  const project = getProject();
  let program = null;
  let programErrors: string[] = [];
  try {
    program = getProgramIR(project);
    programErrors = getProgramErrors(project);
  } catch (e) {
    programErrors = [`No se pudo leer el programa: ${e instanceof Error ? e.message : String(e)}`];
  }
  return buildProjectSummary({
    project,
    netlist: getNetlist(project),
    bindings: getBindings(project),
    issues: safeIssues(),
    program,
    programErrors,
    view: useUI.getState().currentView(),
  });
}
