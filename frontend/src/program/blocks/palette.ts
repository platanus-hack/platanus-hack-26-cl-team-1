/**
 * Category palette of the block editor (pure data, shared by the theme, the
 * toolbox and the view). Shades are chosen so white zelos text stays readable
 * on top of every colour.
 */

export type CategoryKey =
  | 'events'
  | 'control'
  | 'logic'
  | 'math'
  | 'variables'
  | 'functions'
  | 'pins'
  | 'leds'
  | 'inputs'
  | 'sound'
  | 'motion'
  | 'board'
  | 'comm';

export interface CategoryInfo {
  key: CategoryKey;
  name: string; // Spanish toolbox label
  colour: string;
}

export const CATEGORIES: Record<CategoryKey, CategoryInfo> = {
  events: { key: 'events', name: 'Eventos', colour: '#d9922e' }, // amber
  control: { key: 'control', name: 'Control', colour: '#e0703a' }, // orange
  logic: { key: 'logic', name: 'Lógica', colour: '#3d86f0' }, // blue
  math: { key: 'math', name: 'Matemáticas', colour: '#8b68ee' }, // violet
  variables: { key: 'variables', name: 'Variables', colour: '#d9518f' }, // pink
  functions: { key: 'functions', name: 'Funciones', colour: '#5865e0' }, // indigo
  pins: { key: 'pins', name: 'Pines', colour: '#139c94' }, // teal
  leds: { key: 'leds', name: 'LEDs', colour: '#dd4549' }, // red
  inputs: { key: 'inputs', name: 'Entradas', colour: '#2a9d5c' }, // green
  sound: { key: 'sound', name: 'Sonido', colour: '#b8961c' }, // yellow
  motion: { key: 'motion', name: 'Movimiento', colour: '#1693c4' }, // cyan
  board: { key: 'board', name: 'Placa', colour: '#5f6e84' }, // slate
  comm: { key: 'comm', name: 'Comunicación', colour: '#737d89' }, // grey
};

/** Theme block-style name of a category (used by block definitions). */
export const blockStyle = (k: CategoryKey) => `cv_${k}_blocks`;
/** Theme category-style name of a category (used by the toolbox). */
export const categoryStyle = (k: CategoryKey) => `cv_${k}_category`;

/** Mix a #rrggbb colour with white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const target = amount > 0 ? 255 : 0;
    return Math.round(c + (target - c) * Math.abs(amount));
  });
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
