/**
 * runChecks: educational design-rule checks (Spanish). Static topology checks
 * always run; live checks use the latest solve when it matches the project.
 */
import type { CheckIssue, CircuitResult, Netlist, ProjectModel } from '@/contracts';
import { getAnalysis } from '../analysis';
import { deriveBindings } from '../bindings';
import { getTopology } from '../topology';
import { commonGroundChecks, inputChecks, motorChecks, servoChecks, staticOvervoltageChecks, strappingChecks } from './drivers';
import { IssueList, type CheckContext } from './issues';
import { ledChecks } from './leds';
import { liveChecks } from './live';
import { boardChecks, connectionChecks, staticShortChecks } from './structure';

const CHECKS: Array<(ctx: CheckContext) => void> = [
  boardChecks,
  liveChecks,
  staticShortChecks,
  ledChecks,
  motorChecks,
  commonGroundChecks,
  inputChecks,
  servoChecks,
  staticOvervoltageChecks,
  connectionChecks,
  strappingChecks,
];

export function runChecks(project: ProjectModel, netlist: Netlist, result?: CircuitResult | null): CheckIssue[] {
  try {
    const topo = getTopology(project);
    const ctx: CheckContext = {
      an: getAnalysis(topo),
      topo,
      netlist,
      bindings: deriveBindings(project, netlist),
      // Never mix a stale result (NetIds and part states belong to another project object).
      result: result && result.project === project ? result : null,
      issues: new IssueList(),
    };
    for (const check of CHECKS) {
      try {
        check(ctx);
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[circuit] check failed', err);
      }
    }
    return ctx.issues.list();
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[circuit] runChecks failed', err);
    return [];
  }
}
