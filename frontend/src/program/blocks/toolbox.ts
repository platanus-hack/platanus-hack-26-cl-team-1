/**
 * buildToolbox(ctx): Blockly category toolbox (JSON) for the current hardware.
 *  - Part categories only list blocks for part types present in the project
 *    (PartDef.blocks), with the first such part preselected.
 *  - "Placa" depends on ctx.board; without a board only the basic categories
 *    are shown plus a hint label.
 */
import type { BoardProfile } from '@/contracts';
import type { ProgramContext } from '../context';
import { B, BI, type PartKind, type PinFilter } from './kinds';
import { CATEGORIES, categoryStyle, type CategoryKey } from './palette';
import { partsForKind, pinsForFilter } from './options';

export interface ToolboxBlock {
  kind: 'block';
  type: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { shadow?: unknown; block?: unknown }>;
  extraState?: unknown;
}
export interface ToolboxLabel {
  kind: 'label';
  text: string;
  'web-class'?: string;
}
export interface ToolboxSep {
  kind: 'sep';
  gap?: number;
}
export type ToolboxItem = ToolboxBlock | ToolboxLabel | ToolboxSep;
export interface ToolboxCategory {
  kind: 'category';
  name: string;
  categorystyle: string;
  toolboxitemid: string;
  contents?: ToolboxItem[];
  custom?: string;
}
export interface ToolboxDef {
  kind: 'categoryToolbox';
  contents: ToolboxCategory[];
}

/** Dynamic category callback keys (registered on the workspace by registerToolboxCallbacks). */
export const PROCEDURE_CATEGORY = 'CV_PROCEDURE';
export const VARIABLE_CATEGORY = 'CV_VARIABLE';

export const NO_BOARD_HINT = 'Agrega una placa en la vista Hardware para usar los pines';

const numShadow = (v: number) => ({ shadow: { type: BI.number, fields: { NUM: v } } });
const shadow = (type: string, fields: Record<string, unknown>) => ({ shadow: { type, fields } });
const blk = (type: string, extra: Omit<ToolboxBlock, 'kind' | 'type'> = {}): ToolboxBlock => ({ kind: 'block', type, ...extra });
const label = (text: string, cls = 'sw-flyout-label'): ToolboxLabel => ({ kind: 'label', text, 'web-class': cls });

function category(key: CategoryKey, contents: ToolboxItem[]): ToolboxCategory {
  return { kind: 'category', name: CATEGORIES[key].name, categorystyle: categoryStyle(key), toolboxitemid: key, contents };
}

function defaultPin(board: BoardProfile, filter: PinFilter): string | undefined {
  const pins = pinsForFilter(board, filter);
  const onboard = board.onboard.find((o) => o.kind === 'led');
  if (onboard && pins.some((p) => p.id === onboard.pin)) return onboard.pin;
  return pins[0]?.id;
}

function pinFields(board: BoardProfile, filter: PinFilter, extra: Record<string, unknown> = {}) {
  const pin = defaultPin(board, filter);
  return pin ? { PIN: pin, ...extra } : extra;
}

function basicCategories(): ToolboxCategory[] {
  return [
    category('events', [
      label('Siempre están en tu programa: arrástralos para ordenarlos.'),
      blk(B.setup),
      blk(B.loop),
    ]),
    category('control', [
      blk(B.delay, { inputs: { MS: numShadow(1000) } }),
      blk(BI.if),
      blk(BI.if, { extraState: { hasElse: true } }),
      blk(BI.repeat, { inputs: { TIMES: numShadow(10) } }),
      blk(BI.whileUntil),
      blk(B.waitUntil),
      blk(BI.for, { fields: { VAR: { name: 'i' } }, inputs: { FROM: numShadow(1), TO: numShadow(10), BY: numShadow(1) } }),
      blk(BI.flow),
    ]),
    category('logic', [
      blk(BI.compare, { inputs: { A: numShadow(0), B: numShadow(0) } }),
      blk(BI.operation),
      blk(BI.negate),
      blk(BI.boolean),
    ]),
    category('math', [
      blk(BI.number, { fields: { NUM: 0 } }),
      blk(BI.arithmetic, { inputs: { A: numShadow(1), B: numShadow(1) } }),
      blk(BI.modulo, { inputs: { DIVIDEND: numShadow(10), DIVISOR: numShadow(3) } }),
      blk(BI.single, { inputs: { NUM: numShadow(9) } }),
      blk(BI.randomInt, { inputs: { FROM: numShadow(1), TO: numShadow(100) } }),
      blk(B.map, { inputs: { VALUE: numShadow(512), FROM_LOW: numShadow(0), FROM_HIGH: numShadow(1023), TO_LOW: numShadow(0), TO_HIGH: numShadow(255) } }),
      blk(B.constrain, { inputs: { VALUE: numShadow(50), LOW: numShadow(0), HIGH: numShadow(100) } }),
      blk(B.millis),
    ]),
    { kind: 'category', name: CATEGORIES.variables.name, categorystyle: categoryStyle('variables'), toolboxitemid: 'variables', custom: VARIABLE_CATEGORY },
    { kind: 'category', name: CATEGORIES.functions.name, categorystyle: categoryStyle('functions'), toolboxitemid: 'functions', custom: PROCEDURE_CATEGORY },
  ];
}

function pinCategory(board: BoardProfile): ToolboxCategory {
  return category('pins', [
    blk(B.pinMode, { fields: pinFields(board, 'digital', { MODE: 'OUTPUT' }) }),
    blk(B.digitalWrite, { fields: pinFields(board, 'digital'), inputs: { VALUE: shadow(B.pinLevel, { LEVEL: '1' }) } }),
    blk(B.digitalRead, { fields: pinFields(board, 'digital') }),
    blk(B.pinLevel, { fields: { LEVEL: '1' } }),
    blk(B.analogWrite, { fields: pinFields(board, 'pwm'), inputs: { VALUE: numShadow(128) } }),
    blk(B.analogRead, { fields: pinFields(board, 'analog') }),
    blk(B.tone, { fields: pinFields(board, 'digital'), inputs: { FREQ: numShadow(440) } }),
    blk(B.toneMs, { fields: pinFields(board, 'digital'), inputs: { FREQ: numShadow(440), MS: numShadow(500) } }),
    blk(B.noTone, { fields: pinFields(board, 'digital') }),
  ]);
}

/** Toolbox block for a part-level node, or null when no part enables it. */
function partBlock(ctx: ProgramContext, kind: PartKind, type: string, extra: Omit<ToolboxBlock, 'kind' | 'type'> = {}): ToolboxBlock | null {
  const parts = partsForKind(ctx.project.parts, kind);
  if (parts.length === 0) return null;
  return blk(type, { ...extra, fields: { PART: parts[0].id, ...(extra.fields ?? {}) } });
}

function compact<T>(items: Array<T | null>): T[] {
  return items.filter((i): i is T => i !== null);
}

function partCategories(ctx: ProgramContext): ToolboxCategory[] {
  const note = shadow(B.note, { NOTE: '440' });
  const groups: Array<[CategoryKey, ToolboxItem[]]> = [
    [
      'leds',
      compact([
        partBlock(ctx, 'led', B.led, { inputs: { ON: shadow(B.onOff, { STATE: 'TRUE' }) } }),
        partBlock(ctx, 'ledBrightness', B.ledBrightness, { inputs: { PERCENT: numShadow(50) } }),
        partBlock(ctx, 'rgb', B.rgb, { fields: { PRESET: 'red' }, inputs: { R: numShadow(255), G: numShadow(0), B: numShadow(0) } }),
      ]),
    ],
    [
      'inputs',
      compact([
        partBlock(ctx, 'buttonPressed', B.buttonPressed),
        partBlock(ctx, 'buttonClicked', B.buttonClicked),
        partBlock(ctx, 'switchOn', B.switchOn),
        partBlock(ctx, 'potPercent', B.potPercent),
        partBlock(ctx, 'lightPercent', B.lightPercent),
        partBlock(ctx, 'analogRaw', B.analogRaw),
      ]),
    ],
    [
      'sound',
      compact([
        partBlock(ctx, 'buzzerTone', B.buzzerToneMs, { inputs: { FREQ: note, MS: numShadow(500) } }),
        partBlock(ctx, 'buzzerTone', B.buzzerTone, { inputs: { FREQ: note } }),
        partBlock(ctx, 'buzzerOff', B.buzzerOff),
      ]),
    ],
    [
      'motion',
      compact([
        partBlock(ctx, 'servo', B.servo, { inputs: { ANGLE: numShadow(90) } }),
        partBlock(ctx, 'motor', B.motor, { inputs: { SPEED: numShadow(50) } }),
      ]),
    ],
  ];
  const out: ToolboxCategory[] = [];
  for (const [key, items] of groups) {
    if (items.length === 0) continue;
    if (key === 'sound') items.push(blk(B.note, { fields: { NOTE: '440' } }));
    out.push(category(key, items));
  }
  return out;
}

function boardCategory(board: BoardProfile | null): ToolboxCategory {
  if (!board) return category('board', [label(NO_BOARD_HINT, 'sw-flyout-hint')]);
  const items: ToolboxItem[] = [label(board.name)];
  if (board.onboard.some((o) => o.kind === 'led' || o.kind === 'rgb-ws2812')) {
    items.push(blk(B.onboardLed, { inputs: { ON: shadow(B.onOff, { STATE: 'TRUE' }) } }));
  }
  if (board.onboard.some((o) => o.kind === 'rgb-ws2812')) {
    items.push(blk(B.onboardRgb, { fields: { PRESET: 'blue' }, inputs: { R: numShadow(0), G: numShadow(0), B: numShadow(255) } }));
  }
  return category('board', items);
}

function commCategory(): ToolboxCategory {
  return category('comm', [
    blk(B.serialPrint, { fields: { NEWLINE: 'TRUE' }, inputs: { VALUE: shadow(BI.text, { TEXT: 'Hola' }) } }),
    blk(BI.text, { fields: { TEXT: 'texto' } }),
  ]);
}

export function buildToolbox(ctx: ProgramContext): ToolboxDef {
  const board = ctx.board;
  if (!board) return { kind: 'categoryToolbox', contents: [...basicCategories(), boardCategory(null)] };
  return {
    kind: 'categoryToolbox',
    contents: [...basicCategories(), pinCategory(board), ...partCategories(ctx), boardCategory(board), commCategory()],
  };
}
