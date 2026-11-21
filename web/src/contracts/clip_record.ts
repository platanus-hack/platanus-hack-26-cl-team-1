// Generated from contracts/schemas/clip_record.schema.json by scripts/gen-types.mjs. Do not edit.

export type Action = string | null;
export type DurationS = number;
export type Fps = number;
export type Id = string;
export type IsCorrect = boolean;
export type MistakeId = string | null;
export type Path = string;
export type Prompt = string | null;
export type RunId = string;
export type ClipSource = "runway" | "wan" | "recorded";
/**
 * Assigned per run / recording session, never per frame or clip of the same run.
 */
export type Split = "train" | "val" | "test";
export type Step = string | null;
export type TaskId = string;
export type TaskVersion = number;

export interface ClipRecord {
  action: Action;
  duration_s: DurationS;
  fps: Fps;
  id: Id;
  is_correct: IsCorrect;
  mistake_id?: MistakeId;
  path: Path;
  prompt?: Prompt;
  run_id: RunId;
  source: ClipSource;
  split: Split;
  step: Step;
  task_id: TaskId;
  task_version: TaskVersion;
}
