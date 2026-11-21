/** Project → sketch (codegen) → compile, with diagnostics mapped back to blocks. */
import type { BoardId, CompileResult, ProjectModel } from '@/contracts';
import { generateCode } from '@/program/codegen';
import { getProgramIR } from '@/program/blocks';
import { programContext } from '@/program/context';
import { errorResult } from './client';
import { compileSketch, publishLocalResult, type CompileOptions } from './compile';

export type ProjectSketch = { board: BoardId; code: string; lineMap: Record<number, string> } | { error: string; board: BoardId | null };

export const NO_BOARD_MESSAGE = 'Agrega una placa (Arduino Uno o ESP32-C6) al circuito para poder compilar.';

/** Generated sketch + line map of a project (an error when there is no board or codegen fails). Never throws. */
export function projectSketch(project: ProjectModel): ProjectSketch {
  let board: BoardId | null = null;
  try {
    const ctx = programContext(project);
    if (!ctx.board) return { error: NO_BOARD_MESSAGE, board: null };
    board = ctx.board.id;
    const gen = generateCode(getProgramIR(project), ctx);
    return { board, code: gen.code, lineMap: gen.lineMap };
  } catch (err) {
    return { error: `No se pudo generar el código del programa: ${err instanceof Error ? err.message : String(err)}`, board };
  }
}

/** Generate the project's sketch and compile it (diagnostics get blockId). Never throws. */
export async function compileProject(project: ProjectModel, opts: Omit<CompileOptions, 'lineMap'> = {}): Promise<CompileResult> {
  const sk = projectSketch(project);
  if ('error' in sk) {
    const r = errorResult(sk.board ?? 'uno', sk.error);
    publishLocalResult(r);
    opts.onStatus?.(r);
    return r;
  }
  return compileSketch(sk.board, sk.code, { ...opts, lineMap: sk.lineMap });
}
