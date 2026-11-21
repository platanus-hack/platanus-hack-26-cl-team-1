// Generated from contracts/schemas/ws_client_message.schema.json by scripts/gen-types.mjs. Do not edit.

export type WsClientMessage = Hello | SkipStep | Reset | Mute | Label;
export type Debug = boolean;
export type Protocol = 1;
export type Record = boolean;
/**
 * Where the frames come from. The server treats both the same way.
 */
export type Source = "sim" | "webcam";
export type TaskId = string;
export type Type = "hello";
export type Type1 = "skip_step";
export type Type2 = "reset";
export type On = boolean;
export type Type3 = "mute";
export type MistakeId = string | null;
export type Step = string | null;
export type Type4 = "label";

export interface Hello {
  debug: Debug;
  protocol: Protocol;
  record: Record;
  source: Source;
  task_id: TaskId;
  type: Type;
}
export interface SkipStep {
  type: Type1;
}
export interface Reset {
  type: Type2;
}
export interface Mute {
  on: On;
  type: Type3;
}
/**
 * Operator label during dataset recording (record=True only).
 */
export interface Label {
  mistake_id: MistakeId;
  step: Step;
  type: Type4;
}
