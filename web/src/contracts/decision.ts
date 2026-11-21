// Generated from contracts/schemas/decision.schema.json by scripts/gen-types.mjs. Do not edit.

export type Event = "none" | "step_done" | "mistake" | "mistake_fixed" | "reminder" | "task_done";
export type MistakeId = string | null;
/**
 * Closed set of mistake types.
 *
 * `out_of_order` and `repeated` are detected generically from the step graph; `wrong_action` and
 * `incomplete` need a `MistakeDef` in the task to say what they look like and how to correct them.
 */
export type MistakeKind = "out_of_order" | "wrong_action" | "incomplete" | "repeated";
export type NextSteps = string[];
export type Priority = "normal" | "urgent";
export type Text = string;
export type Seq = number;
/**
 * This interface was referenced by `Statuses`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-z0-9_]*$".
 */
export type StepStatus = "pending" | "active" | "done" | "mistake";
export type Step = string | null;

export interface Decision {
  event: Event;
  mistake_id: MistakeId;
  mistake_kind: MistakeKind | null;
  next_steps: NextSteps;
  say: SayRequest | null;
  seq: Seq;
  statuses: Statuses;
  step: Step;
}
export interface SayRequest {
  priority: Priority;
  text: Text;
}
export interface Statuses {
  [k: string]: StepStatus;
}
