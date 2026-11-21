/**
 * Memoized IR of a project. The IR depends only on the workspace JSON and the
 * board id, so it is cached per workspace object (WeakMap) and recomputed when
 * the board changes; errors also depend on parts/bindings (cached per project).
 */
import type { ProgramIR, ProjectModel } from '@/contracts';
import { emptyProgram } from '@/contracts';
import { projectBoard } from '@/catalog';
import { programContext, type ProgramContext } from '../context';
import { workspaceToIR, type ProgramIssue } from './toIR';
import { validateIR } from './validate';

interface Entry {
  board: ProgramIR['board'];
  ir: ProgramIR;
  errors: string[];
  issues: ProgramIssue[];
}

const byWorkspace = new WeakMap<object, Entry>();
const errorsByProject = new WeakMap<ProjectModel, string[]>();
const issuesByProject = new WeakMap<ProjectModel, ProgramIssue[]>();

/** A light context (no bindings) — enough for workspaceToIR, which only needs the board. */
function lightContext(project: ProjectModel): ProgramContext {
  const b = projectBoard(project);
  return { project, board: b?.profile ?? null, boardPartId: b?.part.id ?? null, bindings: [] };
}

function entryFor(project: ProjectModel): Entry {
  const ws = project.program.workspace;
  const ctx = lightContext(project);
  const board = ctx.board?.id ?? null;
  if (!ws || typeof ws !== 'object') return { board, ir: emptyProgram(board), errors: [], issues: [] };
  const cached = byWorkspace.get(ws);
  if (cached && cached.board === board) return cached;
  const { ir, errors, issues } = workspaceToIR(ws, ctx);
  const entry = { board, ir, errors, issues };
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

/** validateIR prefixes errors with the IR path of the node: "loop[0].branches[1].do[2] (led): …". */
const PATH_PREFIX = /^([A-Za-z_]\w*(?:\[\d+\]|\.[A-Za-z_]\w*)*)(?: \([^)]*\))?: (.+)$/s;

/** Id of the deepest IR node with an id along `path` (ids are Blockly block ids). */
function blockIdAt(ir: ProgramIR, path: string): string | undefined {
  let node: unknown = ir;
  let id: string | undefined;
  for (const m of path.matchAll(/([A-Za-z_]\w*)|\[(\d+)\]/g)) {
    if (!node || typeof node !== 'object') break;
    node = (node as Record<string, unknown>)[m[1] ?? Number(m[2])];
    const nodeId = node && typeof node === 'object' ? (node as { id?: unknown }).id : undefined;
    if (typeof nodeId === 'string') id = nodeId;
  }
  return id;
}

/**
 * The program errors for the editor UI: each with the block it is about (so it can be clicked)
 * and without the internal IR path the agent needs ("loop[0] (led): …").
 */
export function getProgramIssues(project: ProjectModel): ProgramIssue[] {
  const cached = issuesByProject.get(project);
  if (cached) return cached;
  const out: ProgramIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: ProgramIssue) => {
    const key = `${issue.blockId ?? ''}\u0000${issue.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(issue);
  };
  try {
    const entry = entryFor(project);
    for (const issue of entry.issues) add(issue);
    for (const error of validateIR(entry.ir, programContext(project)).errors) {
      const m = PATH_PREFIX.exec(error);
      if (!m) {
        add({ message: error });
        continue;
      }
      const text = m[2].charAt(0).toUpperCase() + m[2].slice(1);
      const blockId = blockIdAt(entry.ir, m[1]);
      add(blockId ? { message: text, blockId } : { message: text });
    }
  } catch (e) {
    add({ message: `No se pudo analizar el programa: ${e instanceof Error ? e.message : String(e)}` });
  }
  issuesByProject.set(project, out);
  return out;
}
