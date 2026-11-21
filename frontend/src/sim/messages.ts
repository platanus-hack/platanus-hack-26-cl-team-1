/** Spanish, educational user-facing texts of the sim runtime. */
import type { ShortInfo } from './health';

export const MSG = {
  noBoard: 'Para ejecutar un programa primero agrega una placa (Arduino Uno o ESP32-C6) al circuito.',
  emptyProgram: 'El programa está vacío: en la vista Software arrastra bloques dentro de «al iniciar» o «repetir por siempre».',
  programUpdated: 'Programa actualizado',
  programDone: 'El programa terminó.',
  programError: (msg: string) => `Error en el programa: ${msg}`,
  solverError: (msg: string) => `Error de simulación: ${msg}`,
  burned: (label: string) => `¡El ${label} se quemó! Pasó demasiada corriente… agrega una resistencia de 220 Ω`,
  /** Several parts burned in the same instant: one toast instead of a stack. */
  burnedMany: (labels: string[]) =>
    `¡Se quemaron ${spanishList(labels)}! Pasó demasiada corriente… agrega una resistencia de 220 Ω a cada uno`,
  /** The solver's messages already start with "¡Cortocircuito!": never repeat it. */
  short: (s: ShortInfo) => {
    const body = (s.message ?? '').replace(/^\s*¡?\s*cortocircuito\s*!?\s*/i, '').trim();
    return body
      ? `¡Cortocircuito! ${body}`
      : '¡Cortocircuito! La corriente va directo de + a GND sin pasar por ningún componente que la limite. Revisa los cables.';
  },
};

/** 'A', 'A y B', 'A, B y C', 'A, B, C, D y 3 más'. */
export function spanishList(items: string[], max = 4): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length > max) return `${items.slice(0, max).join(', ')} y ${items.length - max} más`;
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return typeof e === 'string' ? e : 'error desconocido';
}
