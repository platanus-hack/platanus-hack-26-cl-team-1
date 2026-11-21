/**
 * WORKSTREAM B — Block IR → Arduino C++ (codegen) + program checks.
 * Follows the NUMERIC MODEL, IMPLICIT SETUP and SENSOR FORMULAS sections of
 * contracts/ir.ts exactly; the interpreter mirrors it through ./shared.
 *
 *  - generateCode(ir, ctx)  → sketch for ctx.board (Uno / ESP32-C6 core 3.x),
 *    1-based lineMap → block id, Spanish warnings.
 *  - programChecks(ir, ctx) → CheckIssue[] (block-unbound, pin-not-analog,
 *    pin-not-pwm, block-unsupported-board, timer-conflict).
 */
export { generateCode } from './generate';
export { programChecks } from './checks';
export {
  collectVariables,
  formatValue,
  planSetup,
  resolveBoard,
  resolveGenericPin,
  resolvePart,
  type ResolvedPin,
  type SetupPlan,
  type VarInfo,
} from './shared';
