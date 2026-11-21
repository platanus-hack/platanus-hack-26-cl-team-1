/**
 * Tool definitions from /shared/agent-tools.json + a small JSON-Schema
 * validator. With eager input streaming the API does not validate tool inputs,
 * so executeTool checks them here and answers {error} in Spanish.
 */
import type { ToolName } from '@/contracts';
import toolsJson from '../../../shared/agent-tools.json';

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: unknown[];
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export const TOOL_DEFS: ToolDef[] = toolsJson as unknown as ToolDef[];

/**
 * Every tool name, keyed by ToolName: the compiler rejects a missing or extra
 * key, and a vitest compares the keys with agent-tools.json.
 */
export const TOOL_NAMES: Record<ToolName, true> = {
  get_project: true,
  add_part: true,
  remove_part: true,
  update_part: true,
  move_part: true,
  connect: true,
  disconnect: true,
  set_program: true,
  get_code: true,
  run_checks: true,
  simulate: true,
  compile: true,
  ask_user: true,
  highlight: true,
  switch_view: true,
  load_example: true,
  new_project: true,
};

export const isToolName = (name: string): name is ToolName => Object.prototype.hasOwnProperty.call(TOOL_NAMES, name);

const TYPE_ES: Record<string, string> = {
  object: 'un objeto',
  array: 'una lista',
  string: 'texto',
  integer: 'un número entero',
  number: 'un número',
  boolean: 'true o false',
  null: 'null',
};

function typeOk(v: unknown, t: string): boolean {
  switch (t) {
    case 'object':
      return !!v && typeof v === 'object' && !Array.isArray(v);
    case 'array':
      return Array.isArray(v);
    case 'string':
      return typeof v === 'string';
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'null':
      return v === null;
    default:
      return true;
  }
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
const label = (path: string) => (path ? `«${path}»` : 'la entrada');

/** Validate `value` against `schema`; returns Spanish error messages (empty = valid). */
export function validateSchema(value: unknown, schema: JsonSchema, path = ''): string[] {
  const errors: string[] = [];
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some((t) => typeOk(value, t))) {
    errors.push(`${label(path)} debe ser ${types.map((t) => TYPE_ES[t] ?? t).join(' o ')}.`);
    return errors;
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${label(path)} debe ser uno de: ${schema.enum.map(show).join(', ')} (llegó ${show(value)}).`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${label(path)} debe ser ≥ ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${label(path)} debe ser ≤ ${schema.maximum}.`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${label(path)} necesita al menos ${schema.minItems} elementos.`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${label(path)} admite como máximo ${schema.maxItems} elementos.`);
    if (schema.items) value.forEach((item, i) => errors.push(...validateSchema(item, schema.items!, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined) errors.push(`falta el campo ${label(path ? `${path}.${key}` : key)}.`);
    }
    for (const [key, v] of Object.entries(obj)) {
      const sub = props[key];
      const p = path ? `${path}.${key}` : key;
      if (sub) {
        if (v !== undefined) errors.push(...validateSchema(v, sub, p));
      } else if (schema.additionalProperties === false) {
        errors.push(`campo desconocido ${label(p)}${Object.keys(props).length ? ` (válidos: ${Object.keys(props).join(', ')})` : ''}.`);
      } else if (typeof schema.additionalProperties === 'object') {
        errors.push(...validateSchema(v, schema.additionalProperties, p));
      }
    }
  }
  return errors;
}

/** Validate a tool input against its input_schema from agent-tools.json. */
export function validateToolInput(name: string, input: unknown): string | null {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return `Herramienta desconocida «${name}».`;
  const errors = validateSchema(input ?? {}, def.input_schema);
  if (errors.length === 0) return null;
  return `Entrada inválida para ${name}: ${errors.slice(0, 8).join(' ')}`;
}
