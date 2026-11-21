/**
 * CONTRACT 2 — Op list and their effects
 * ---------------------------------------------------------------------------
 * Every mutation of ProjectModel is an Op. The project store applies ops in
 * transactions:  dispatch(ops, meta)  → one undo step.
 *
 * applyOp(model, op) is PURE and returns { model, inverse } where `inverse`
 * is the list of ops that exactly undoes it (already in the order to apply).
 * Undo applies the inverses of a transaction in reverse order; redo re-applies
 * the original ops.
 *
 * Effects:
 *  part.add       Insert part at `index` (default: end). Fails if id exists or type unknown.
 *                 inverse: part.remove
 *  part.remove    Remove part AND every wire attached to any of its pins (cascade).
 *                 inverse: part.add (same index) + wire.add for each removed wire.
 *  part.move      Set x,y (integers). inverse: part.move to old position.
 *  part.rotate    Set rotation. inverse: part.rotate old.
 *  part.setProps  Shallow-merge props. inverse: part.setProps with the previous values
 *                 (keys that did not exist are restored to the PartDef default).
 *  part.setLabel  Rename. inverse: old label.
 *  wire.add       Insert wire. Fails if id exists or a pin ref does not exist.
 *  wire.remove    Remove wire. inverse: wire.add at the same index. Removing a wire that no
 *                 longer exists (e.g. already cascaded by a part.remove in the same
 *                 transaction) is a NO-OP with an empty inverse.
 *  wire.update    Patch color / waypoints / endpoints. inverse: patch with old values.
 *  program.set    Replace Blockly workspace JSON. inverse: program.set old.
 *  project.rename Rename. inverse: old name.
 *  project.load   Replace the whole project (examples, import, "new").
 *                 inverse: project.load with the previous project.
 */
import type { Id, PartInstance, Point, ProjectModel, PropValue, Rotation, Wire, WireColor } from './model';

export type Op =
  | { op: 'part.add'; part: PartInstance; index?: number }
  | { op: 'part.remove'; id: Id }
  | { op: 'part.move'; id: Id; x: number; y: number }
  | { op: 'part.rotate'; id: Id; rotation: Rotation }
  | { op: 'part.setProps'; id: Id; props: Record<string, PropValue> }
  | { op: 'part.setLabel'; id: Id; label: string }
  | { op: 'wire.add'; wire: Wire; index?: number }
  | { op: 'wire.remove'; id: Id }
  | {
      op: 'wire.update';
      id: Id;
      patch: { color?: WireColor; waypoints?: Point[]; from?: string; to?: string };
    }
  | { op: 'program.set'; workspace: unknown | null }
  | { op: 'project.rename'; name: string }
  | { op: 'project.load'; project: ProjectModel };

export type OpName = Op['op'];

export type OpSource = 'user' | 'agent' | 'system';

export interface DispatchMeta {
  /** Spanish label shown in the history / undo tooltip, e.g. 'Agregar LED'. */
  label?: string;
  source?: OpSource;
  /**
   * Consecutive dispatches with the same mergeKey (within 1s) are merged into
   * one undo step (e.g. dragging a part emits many part.move).
   */
  mergeKey?: string;
  /**
   * Consecutive dispatches with the same group (no time window) merge into ONE
   * undo step — the agent passes its user-turn id so a whole assistant turn is
   * undone at once.
   */
  group?: string;
}

export interface ApplyResult {
  model: ProjectModel;
  inverse: Op[];
}

export interface DispatchResult {
  ok: boolean;
  /** Spanish error when an op was rejected (transaction is atomic: nothing applied). */
  error?: string;
}

export interface HistoryEntry {
  ops: Op[];
  inverse: Op[]; // already in apply order (reverse of ops' inverses)
  label: string;
  source: OpSource;
  at: number; // epoch ms
  mergeKey?: string;
  group?: string;
}
