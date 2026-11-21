/**
 * Memoized derived data (keyed on the immutable project object).
 * Views/agent/sim should use these instead of recomputing.
 */
import { useMemo } from 'react';
import type { Binding, CheckIssue, CircuitResult, Netlist, ProjectModel } from '@/contracts';
import { buildNetlist, deriveBindings, runChecks, solveCircuit } from '@/circuit';
import { getProgramIR } from '@/program/blocks';
import { programChecks } from '@/program/codegen';
import { programContext } from '@/program/context';
import { useProject } from './project';
import { useSim } from './sim';

const netlistCache = new WeakMap<ProjectModel, Netlist>();
const bindingsCache = new WeakMap<ProjectModel, Binding[]>();

export function getNetlist(project: ProjectModel): Netlist {
  let n = netlistCache.get(project);
  if (!n) {
    n = buildNetlist(project);
    netlistCache.set(project, n);
  }
  return n;
}

export function getBindings(project: ProjectModel): Binding[] {
  let b = bindingsCache.get(project);
  if (!b) {
    b = deriveBindings(project, getNetlist(project));
    bindingsCache.set(project, b);
  }
  return b;
}

/**
 * A live solve result that matches `project` — the one in the sim store when it
 * is fresh, otherwise a synchronous solve with the current sim inputs.
 * (CircuitResult.project is the staleness key: NetIds differ between builds.)
 */
export function getFreshResult(project: ProjectModel): CircuitResult | null {
  const s = useSim.getState();
  if (!s.live) return null;
  if (s.result && s.result.project === project) return s.result;
  try {
    return solveCircuit(project, getNetlist(project), {
      drives: s.drives,
      runtime: s.runtime,
      burned: s.burned,
      onboardRgb: s.onboardRgb,
      servoAngles: s.servoAngles,
    });
  } catch {
    return null;
  }
}

function computeIssues(project: ProjectModel, result: CircuitResult | null): CheckIssue[] {
  const circuit = runChecks(project, getNetlist(project), result);
  let program: CheckIssue[] = [];
  try {
    program = programChecks(getProgramIR(project), programContext(project));
  } catch {
    /* program module not ready */
  }
  return [...circuit, ...program];
}

/** Circuit + program checks for the CURRENT project (agent tools, summaries). */
export function getIssues(project: ProjectModel): CheckIssue[] {
  return computeIssues(project, getFreshResult(project));
}

/* React hooks */
export const useNetlist = () => getNetlist(useProject((s) => s.project));
export const useBindings = () => getBindings(useProject((s) => s.project));
export function useIssues(): CheckIssue[] {
  const project = useProject((s) => s.project);
  const result = useSim((s) => s.result);
  // Only use a result solved for this exact project; stale ones would mis-index nets.
  const fresh = result && result.project === project ? result : null;
  return useMemo(() => computeIssues(project, fresh), [project, fresh]);
}
