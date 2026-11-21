import type { Binding, BoardProfile, ProjectModel } from '@/contracts';
import { projectBoard } from '@/catalog';
import { getBindings } from '@/store/derived';

/** Everything codegen / interpreter / toolbox need besides the IR. */
export interface ProgramContext {
  project: ProjectModel;
  board: BoardProfile | null;
  /** Id of the board part on the canvas (e.g. 'uno1'). */
  boardPartId: string | null;
  bindings: Binding[];
}

export function programContext(project: ProjectModel): ProgramContext {
  const b = projectBoard(project);
  return { project, board: b?.profile ?? null, boardPartId: b?.part.id ?? null, bindings: getBindings(project) };
}

/** Binding lookup helpers. */
export const bindingFor = (ctx: ProgramContext, part: string, channel?: string) =>
  ctx.bindings.find((b) => b.part === part && (channel === undefined || b.channel === channel) && b.boardPin !== null) ??
  ctx.bindings.find((b) => b.part === part && (channel === undefined || b.channel === channel));
