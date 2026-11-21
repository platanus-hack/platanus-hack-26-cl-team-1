import type { Id, Op, PinRef, Point, PropValue, Rotation } from '@/contracts';

/**
 * planAddPart rules: returns `error` (Spanish) if a board already exists and
 * another one is added. placement 'auto': insertable parts go on the
 * breadboard (an esp32c6-devkit straddles the centre channel when there is
 * room), boards/breadboard/non-insertable parts go to free space.
 */
export interface PlanAddPartOptions {
  label?: string;
  props?: Record<string, PropValue>;
  placement?: 'auto' | 'breadboard' | 'free';
  near?: Id;
  /**
   * 'free': exact origin. 'breadboard'/'auto': preferred origin — the valid
   * breadboard position closest to it wins.
   */
  at?: Point;
  /** Restrict the breadboard search (or the free placement) to this rotation. */
  rotation?: Rotation;
}

export interface PlanAddPartResult {
  ops: Op[];
  id: Id;
  label: string;
  /** For breadboard placement: pin id → hole PinRef it was inserted into. */
  holes?: Record<string, PinRef>;
  note?: string;
  error?: string;
}

export interface PlanConnectResult {
  ops: Op[];
  wireId: Id;
  /** Actual endpoints used (may be a free hole of the same strip). */
  from: PinRef;
  to: PinRef;
  note?: string;
  error?: string;
}

export interface PlanDisconnectResult {
  ops: Op[];
  removed: Id[];
  error?: string;
}
