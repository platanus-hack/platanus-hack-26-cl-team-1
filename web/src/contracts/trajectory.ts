// Generated from contracts/schemas/trajectory.schema.json by scripts/gen-types.mjs. Do not edit.

export type Completed = boolean;
/**
 * @minItems 1
 */
export type Events = [TrajectoryEvent, ...TrajectoryEvent[]];
export type MistakeId = string | null;
/**
 * Closed set of mistake types.
 *
 * `out_of_order` and `repeated` are detected generically from the step graph; `wrong_action` and
 * `incomplete` need a `MistakeDef` in the task to say what they look like and how to correct them.
 */
export type MistakeKind = "out_of_order" | "wrong_action" | "incomplete" | "repeated";
export type ObservedAction = string | null;
export type ObservedConfidence = number;
export type Step = string | null;
export type TMs = number;
export type TrueAction = string | null;
export type Id = string;
export type Seed = number;
/**
 * Assigned per run / recording session, never per frame or clip of the same run.
 */
export type Split = "train" | "val" | "test";
export type TaskId = string;
export type TaskVersion = number;

export interface Trajectory {
  completed: Completed;
  events: Events;
  id: Id;
  noise?: Noise;
  seed: Seed;
  split: Split;
  task_id: TaskId;
  task_version: TaskVersion;
}
export interface TrajectoryEvent {
  mistake_id?: MistakeId;
  mistake_kind?: MistakeKind | null;
  observed_action: ObservedAction;
  observed_confidence: ObservedConfidence;
  step: Step;
  t_ms: TMs;
  true_action: TrueAction;
}
export interface Noise {
  [k: string]: number;
}
