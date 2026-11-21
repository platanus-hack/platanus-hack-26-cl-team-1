// Generated from contracts/schemas/ws_server_message.schema.json by scripts/gen-types.mjs. Do not edit.

export type WsServerMessage = Ready | State | Issue | IssueClear | Say | CancelSay | Debug | Error;
export type SessionId = string;
export type Actions = string[];
export type Description = string;
export type Domain = string;
export type Id = string;
export type Action = string | null;
export type CorrectionEs = string;
export type Description1 = string;
export type Id1 = string;
/**
 * Closed set of mistake types.
 *
 * `out_of_order` and `repeated` are detected generically from the step graph; `wrong_action` and
 * `incomplete` need a `MistakeDef` in the task to say what they look like and how to correct them.
 */
export type MistakeKind = "out_of_order" | "wrong_action" | "incomplete" | "repeated";
export type Step = string;
export type VisualCue = string;
export type Mistakes = MistakeDef[];
export type Objects = string[];
export type OntologyVersion = number;
/**
 * @minItems 1
 */
export type Steps = [Step1, ...Step1[]];
export type Action1 = string;
export type CompletionCue = string;
export type Id2 = string;
export type InstructionEs = string;
export type MinDurationS = number | null;
export type Requires = string[];
export type TitleEs = string;
export type TitleEs1 = string;
export type Version = number;
export type Type = "ready";
export type NextSteps = string[];
export type Seq = number;
/**
 * This interface was referenced by `Statuses`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-z0-9_]*$".
 */
export type StepStatus = "pending" | "active" | "done" | "mistake";
export type Type1 = "state";
export type MistakeId = string | null;
export type Step2 = string | null;
export type TextEs = string;
export type Type2 = "issue";
export type Step3 = string | null;
export type Type3 = "issue_clear";
export type Audio = boolean;
export type Id3 = string;
export type Priority = "normal" | "urgent";
export type Text = string;
export type Type4 = "say";
export type Id4 = string;
export type Type5 = "cancel_say";
export type LatencyMs1 = number;
export type Model = string;
export type Action2 = string | null;
export type Confidence = number;
export type Note = string | null;
export type Objects1 = string[];
export type Quality = "ok" | "bad" | "unknown";
export type Seq1 = number;
/**
 * Where the frames come from. The server treats both the same way.
 */
export type Source = "sim" | "webcam";
export type TMs = number;
export type Seq2 = number;
export type Type6 = "debug";
export type Code = "bad_message" | "unknown_task" | "protocol_version" | "internal";
export type Message = string;
export type Type7 = "error";

export interface Ready {
  session_id: SessionId;
  task: Task;
  type: Type;
}
export interface Task {
  actions: Actions;
  description: Description;
  domain: Domain;
  id: Id;
  mistakes: Mistakes;
  objects: Objects;
  ontology_version: OntologyVersion;
  steps: Steps;
  title_es: TitleEs1;
  version: Version;
}
/**
 * A task-specific mistake: what it looks like and what to say.
 */
export interface MistakeDef {
  action: Action;
  correction_es: CorrectionEs;
  description: Description1;
  id: Id1;
  kind: MistakeKind;
  step: Step;
  visual_cue: VisualCue;
}
export interface Step1 {
  action: Action1;
  completion_cue: CompletionCue;
  id: Id2;
  instruction_es: InstructionEs;
  min_duration_s: MinDurationS;
  requires: Requires;
  title_es: TitleEs;
}
export interface State {
  next_steps: NextSteps;
  seq: Seq;
  statuses: Statuses;
  type: Type1;
}
export interface Statuses {
  [k: string]: StepStatus;
}
export interface Issue {
  kind: MistakeKind;
  mistake_id: MistakeId;
  step: Step2;
  text_es: TextEs;
  type: Type2;
}
export interface IssueClear {
  step: Step3;
  type: Type3;
}
/**
 * Subtitle + voice. When `audio` is true a binary audio frame with the same id follows;
 * otherwise the browser may speak it with speechSynthesis.
 */
export interface Say {
  audio: Audio;
  id: Id3;
  priority: Priority;
  text: Text;
  type: Type4;
}
export interface CancelSay {
  id: Id4;
  type: Type5;
}
export interface Debug {
  latency_ms: LatencyMs;
  observation: Observation | null;
  seq: Seq2;
  type: Type6;
}
export interface LatencyMs {
  [k: string]: number;
}
export interface Observation {
  latency_ms: LatencyMs1;
  model: Model;
  output: VlmOutput;
  seq: Seq1;
  source: Source;
  t_ms: TMs;
}
/**
 * `action` is null when nothing from the task's action set is happening, or the model is unsure.
 * A null action must come with quality `unknown`: the supervisor stays silent on it.
 */
export interface VlmOutput {
  action: Action2;
  confidence: Confidence;
  note: Note;
  objects: Objects1;
  quality: Quality;
}
export interface Error {
  code: Code;
  message: Message;
  type: Type7;
}
