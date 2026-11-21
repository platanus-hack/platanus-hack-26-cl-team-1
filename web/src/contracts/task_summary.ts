// Generated from contracts/schemas/task_summary.schema.json by scripts/gen-types.mjs. Do not edit.

export type Domain = string;
export type Id = string;
export type Steps = number;
export type TitleEs = string;
export type Version = number;

/**
 * What the library lists to the UI.
 */
export interface TaskSummary {
  domain: Domain;
  id: Id;
  steps: Steps;
  title_es: TitleEs;
  version: Version;
}
