/**
 * Memoized IR of a project. The IR depends only on the workspace JSON and the
 * board id, so it is cached per workspace object (WeakMap) and recomputed when
 * the board changes; errors also depend on parts/bindings (cached per project).
 */
import type { ProgramIR, ProjectModel } from '@/contracts';
import { emptyProgram } from '@/contracts';
import { projectBoard } from '@/catalog';
import { programContext, type ProgramContext } from '../context';
import { workspaceToIR } from './toIR';
import { validateIR } from './validate';

interface Entry {
  board: ProgramIR['board'];
  ir: ProgramIR;
  errors: string[];
}

const byWorkspace = new WeakMap<object, Entry>();
const errorsByProject = new WeakMap<ProjectModel, string[]>();

/** A light context (no bindings) — enough for workspaceToIR, which only needs the board. */
function lightContext(project: ProjectModel): ProgramContext {
  const b = projectBoard(project);
  return { project, board: b?.profile ?? null, boardPartId: b?.part.id ?? null, bindings: [] };
}

function entryFor(project: ProjectModel): Entry {
  const ws = project.program.workspace;
  const ctx = lightContext(project);
  const board = ctx.board?.id ?? null;
  if (!ws || typeof ws !== 'object') return { board, ir: emptyProgram(board), errors: [] };
  const cached = byWorkspace.get(ws);
  if (cached && cached.board === board) return cached;
  const { ir, errors } = workspaceToIR(ws, ctx);
  const entry = { board, ir, errors };
  byWorkspace.set(ws, entry);
  return entry;
}

export function getProgramIR(project: ProjectModel): ProgramIR {
  try {
    return entryFor(project).ir;
  } catch {
    return emptyProgram(projectBoard(project)?.profile.id ?? null);
  }
}

export function getProgramErrors(project: ProjectModel): string[] {
  const cached = errorsByProject.get(project);
  if (cached) return cached;
  let out: string[];
  try {
    const entry = entryFor(project);
    const { errors } = validateIR(entry.ir, programContext(project));
    out = [...new Set([...entry.errors, ...errors])];
  } catch (e) {
    out = [`No se pudo analizar el programa: ${e instanceof Error ? e.message : String(e)}`];
  }
  errorsByProject.set(project, out);
  return out;
}
