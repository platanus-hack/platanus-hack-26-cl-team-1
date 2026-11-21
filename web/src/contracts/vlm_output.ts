// Generated from contracts/schemas/vlm_output.schema.json by scripts/gen-types.mjs. Do not edit.

export type Action = string | null;
export type Confidence = number;
export type Note = string | null;
export type Objects = string[];
export type Quality = "ok" | "bad" | "unknown";

/**
 * `action` is null when nothing from the task's action set is happening, or the model is unsure.
 * A null action must come with quality `unknown`: the supervisor stays silent on it.
 */
export interface VlmOutput {
  action: Action;
  confidence: Confidence;
  note?: Note;
  objects?: Objects;
  quality: Quality;
}
