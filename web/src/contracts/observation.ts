// Generated from contracts/schemas/observation.schema.json by scripts/gen-types.mjs. Do not edit.

export type LatencyMs = number;
export type Model = string;
export type Action = string | null;
export type Confidence = number;
export type Note = string | null;
export type Objects = string[];
export type Quality = "ok" | "bad" | "unknown";
export type Seq = number;
/**
 * Where the frames come from. The server treats both the same way.
 */
export type Source = "sim" | "webcam";
export type TMs = number;

export interface Observation {
  latency_ms: LatencyMs;
  model: Model;
  output: VlmOutput;
  seq: Seq;
  source: Source;
  t_ms: TMs;
}
/**
 * `action` is null when nothing from the task's action set is happening, or the model is unsure.
 * A null action must come with quality `unknown`: the supervisor stays silent on it.
 */
export interface VlmOutput {
  action: Action;
  confidence: Confidence;
  note: Note;
  objects: Objects;
  quality: Quality;
}
