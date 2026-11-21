/**
 * runHeadless: isolated run for the agent's `simulate` tool and tests.
 * Wires the real circuit solver / interpreter into runHeadlessCore.
 */
import type { ProgramIR, ProjectModel, SimInputEvent, SimTimeline } from '@/contracts';
import { runChecks, solveCircuit } from '@/circuit';
import { canonicalBoardPin, findPartDef, projectBoard } from '@/catalog';
import { getProgramIR } from '@/program/blocks';
import { createInterpreter } from '@/program/interpreter';
import { programContext } from '@/program/context';
import { getNetlist } from '@/store/derived';
import { runHeadlessCore } from './headlessCore';
import { errorText } from './messages';

export const isEmptyProgram = (ir: ProgramIR | null | undefined): boolean =>
  !ir || ((ir.setup?.length ?? 0) === 0 && (ir.loop?.length ?? 0) === 0);

export async function runHeadless(project: ProjectModel, durationMs: number, inputs: SimInputEvent[] = []): Promise<SimTimeline> {
  try {
    const netlist = getNetlist(project);
    const bp = projectBoard(project);
    const board = bp?.profile ?? null;
    let create: Parameters<typeof runHeadlessCore>[3]['createInterpreter'] = null;
    if (board) {
      const ir = getProgramIR(project);
      if (!isEmptyProgram(ir)) {
        const ctx = programContext(project);
        create = (host) => createInterpreter(ir, ctx, host);
      }
    }
    const models = new Map(project.parts.map((p) => [p.id, findPartDef(p.type)?.electrical.model]));
    return await runHeadlessCore(project, durationMs, inputs, {
      solve: (inp) => solveCircuit(project, netlist, inp),
      board,
      canon: board ? (pin) => canonicalBoardPin(board, pin) : undefined,
      createInterpreter: create,
      checks: (result) => runChecks(project, netlist, result),
      modelOf: (id) => models.get(id),
    });
  } catch (e) {
    return { durationMs: 0, changes: [], serial: [], issues: [], error: errorText(e) };
  }
}
