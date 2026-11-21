/**
 * WORKSTREAM A — example projects (owned by the schematic/guide agent).
 * Ids must match shared/agent-tools.json load_example enum.
 *
 * buildExample(id) constructs the project programmatically through the
 * placement planner (planAddPart / planConnect + applyOps), so coordinates
 * and holes are always valid, and stores the program as a Blockly workspace
 * (irToWorkspace). getExampleProgram(id) returns the Block IR.
 */
import type { BoardId, ProgramIR, ProjectModel } from '@/contracts';
import { irToWorkspace } from '@/program/blocks';
import { programContext } from '@/program/context';
import { createStarterProject } from '@/store/newProject';
import { ExampleBuilder } from './builder';
import { RECIPES } from './recipes';

export interface ExampleInfo {
  id: string;
  name: string; // Spanish
  description: string; // Spanish
  board: BoardId | null;
  level: 'básico' | 'intermedio';
}

import examplesJson from '../../../shared/examples.json';

/** Metadata lives in shared/examples.json (also read by the agent server). */
export const EXAMPLES: ExampleInfo[] = examplesJson as ExampleInfo[];

function toWorkspace(ir: ProgramIR, project: ProjectModel): unknown | null {
  try {
    let ctx;
    try {
      ctx = programContext(project);
    } catch {
      ctx = undefined;
    }
    return irToWorkspace(ir, ctx).workspace ?? null;
  } catch {
    return null;
  }
}

interface Built {
  project: ProjectModel;
  ir: ProgramIR | null;
}

/** Strict build: throws (Spanish message) if any placement/wiring op fails. */
export function buildExampleStrict(id: string): Built {
  const info = EXAMPLES.find((e) => e.id === id);
  const recipe = RECIPES[id];
  if (!info || !recipe) throw new Error(`Ejemplo desconocido: ${id}`);
  const b = new ExampleBuilder(info.board, info.name);
  const ir = recipe(b);
  if (ir) b.setProgramIR(ir, toWorkspace);
  const project: ProjectModel = { ...b.project, meta: { ...b.project.meta, description: info.description, exampleId: id } };
  return { project, ir };
}

export function buildExample(id: string): ProjectModel {
  try {
    return buildExampleStrict(id).project;
  } catch (err) {
    console.error('[examples] no se pudo construir', id, err);
    const info = EXAMPLES.find((e) => e.id === id);
    const p = createStarterProject(info ? info.board : 'uno', info?.name ?? 'Ejemplo');
    p.meta.exampleId = id;
    if (info) p.meta.description = info.description;
    return p;
  }
}

/** Block IR of an example's program (null when it has none, e.g. battery-led). */
export function getExampleProgram(id: string): ProgramIR | null {
  try {
    return buildExampleStrict(id).ir;
  } catch {
    return null;
  }
}
