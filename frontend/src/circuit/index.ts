/**
 * WORKSTREAM A — circuit module public API.
 *
 *   buildNetlist(project)                  connectivity (male↔female overlap + wires + buses)
 *   solveCircuit(project, netlist, inputs) DC operating point (nodal analysis, piecewise-linear devices)
 *   deriveBindings(project, netlist)       which board pin drives/reads each part signal
 *   runChecks(project, netlist, result?)   educational design-rule checks (Spanish)
 *
 * All results are memoized per immutable project object where possible and
 * none of these functions throws.
 */
import type { CircuitInputs } from '@/contracts';

export { buildNetlist } from './netlist';
export { solveCircuit } from './solver';
export { deriveBindings } from './bindings';
export { runChecks } from './checks';
export { ledBrightness } from './partStates';
export { ldrOhms } from './models';

/** Default inputs: all board pins high-Z, no runtime overrides. */
export const idleInputs = (): CircuitInputs => ({ drives: {}, runtime: {}, burned: [] });
