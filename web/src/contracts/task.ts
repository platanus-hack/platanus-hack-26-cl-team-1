// Generated from contracts/schemas/task.schema.json by scripts/gen-types.mjs. Do not edit.

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

export interface Task {
  actions: Actions;
  description: Description;
  domain: Domain;
  id: Id;
  mistakes?: Mistakes;
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
  action?: Action;
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
  min_duration_s?: MinDurationS;
  requires?: Requires;
  title_es: TitleEs;
}
