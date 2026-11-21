/**
 * Connection checker following the IR's C semantics: numbers and booleans are
 * interchangeable (truthiness = value != 0), so a program written by the agent
 * (e.g. `si leer digital 2`) always loads. Strings stay restricted to the
 * inputs that explicitly accept them (serial print).
 */
import * as Blockly from 'blockly';

export const CHECKER_NAME = 'cv_checker';

const NUMERIC = new Set(['Number', 'Boolean']);

function widen(check: string[] | null): string[] | null {
  if (!check) return null;
  return check.some((c) => NUMERIC.has(c)) ? [...new Set([...check, 'Number', 'Boolean'])] : check;
}

export class CvConnectionChecker extends Blockly.ConnectionChecker {
  override doTypeChecks(a: Blockly.Connection, b: Blockly.Connection): boolean {
    const ca = widen(a.getCheck());
    const cb = widen(b.getCheck());
    if (!ca || !cb) return true;
    return ca.some((c) => cb.includes(c));
  }
}

export function registerChecker(): void {
  if (!Blockly.registry.hasItem(Blockly.registry.Type.CONNECTION_CHECKER, CHECKER_NAME)) {
    Blockly.registry.register(Blockly.registry.Type.CONNECTION_CHECKER, CHECKER_NAME, CvConnectionChecker);
  }
}

/** Workspace options plugin entry (inject + headless workspaces). */
export const checkerPlugin = { connectionChecker: CHECKER_NAME };
