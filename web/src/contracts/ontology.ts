// Generated from contracts/schemas/ontology.schema.json by scripts/gen-types.mjs. Do not edit.

export type Id = string;
export type LabelEs = string;
export type Object = string | null;
export type Target = string | null;
export type Verb = string;
export type VisualCue = string;
export type Actions = ActionDef[];
export type Domain = string;
export type Description = string;
export type Id1 = string;
export type LabelEs1 = string;
export type Objects = ObjectDef[];
export type Version = number;

export interface Ontology {
  actions: Actions;
  domain: Domain;
  objects: Objects;
  version: Version;
}
/**
 * One atomic, visible action: `verb(object, target)`.
 *
 * `visual_cue` says what the action looks like on camera. It feeds the perception prompt and the
 * video-generation prompt, so it must describe something a camera can see.
 */
export interface ActionDef {
  id: Id;
  label_es: LabelEs;
  object?: Object;
  target?: Target;
  verb: Verb;
  visual_cue: VisualCue;
}
export interface ObjectDef {
  description: Description;
  id: Id1;
  label_es: LabelEs1;
}
