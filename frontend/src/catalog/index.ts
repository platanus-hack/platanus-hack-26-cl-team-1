/**
 * Parts & boards catalog. Loads /shared/parts/*.json and /shared/boards/*.json
 * and resolves generated pins (breadboard holes, board headers).
 */
import type { BoardId, BoardProfile, PartDef, PartInstance, PinDef, ProjectModel, PropValue } from '@/contracts';
import { breadboardBuses, breadboardPins } from './breadboard';

const partModules = import.meta.glob('../../../shared/parts/*.json', { eager: true, import: 'default' }) as Record<string, PartDef>;
const boardModules = import.meta.glob('../../../shared/boards/*.json', { eager: true, import: 'default' }) as Record<string, BoardProfile>;

const BOARDS = new Map<BoardId, BoardProfile>();
for (const b of Object.values(boardModules)) BOARDS.set(b.id, b);

const BOARD_PIN_KIND: Record<string, PinDef['kind']> = {
  gpio: 'gpio',
  power: 'power',
  ground: 'ground',
  reset: 'reset',
  nc: 'nc',
  aref: 'terminal',
};

function resolve(def: PartDef): PartDef {
  if (def.generator === 'breadboard-half') {
    return { ...def, pins: breadboardPins().map((p) => ({ ...p, contact: 'female' as const })), internalBuses: breadboardBuses() };
  }
  if (def.generator === 'board-profile' && def.board) {
    const board = BOARDS.get(def.board);
    if (!board) throw new Error(`Board profile not found: ${def.board}`);
    const pins: PinDef[] = board.pins.map((p) => ({
      id: p.id,
      label: p.label || p.id,
      x: p.x,
      y: p.y,
      kind: BOARD_PIN_KIND[p.kind] ?? 'terminal',
      polarity: p.kind === 'power' ? '+' : p.kind === 'ground' ? '-' : undefined,
      hint: p.notes,
      contact: board.headerContact,
    }));
    return { ...def, pins, internalBuses: [...(def.internalBuses ?? []), ...board.internalBuses] };
  }
  return { ...def, pins: def.pins.map((p) => ({ ...p, contact: p.contact ?? 'male' })) };
}

const PARTS = new Map<string, PartDef>();
for (const raw of Object.values(partModules)) PARTS.set(raw.type, resolve(raw));

/** Display order in the palette. */
const ORDER = [
  'arduino-uno', 'esp32c6-devkit', 'breadboard-half', 'battery-9v', 'battery-aa4',
  'led', 'led-rgb', 'buzzer', 'motor-dc', 'servo-sg90',
  'button', 'switch-slide', 'potentiometer', 'ldr',
  'resistor', 'diode', 'npn',
];

export function allPartDefs(): PartDef[] {
  return [...PARTS.values()].sort((a, b) => {
    const ia = ORDER.indexOf(a.type), ib = ORDER.indexOf(b.type);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

export function findPartDef(type: string): PartDef | undefined {
  return PARTS.get(type);
}

export function getPartDef(type: string): PartDef {
  const d = PARTS.get(type);
  if (!d) throw new Error(`Tipo de componente desconocido: ${type}`);
  return d;
}

export function allBoards(): BoardProfile[] {
  return [...BOARDS.values()];
}

export function getBoardProfile(id: BoardId): BoardProfile {
  const b = BOARDS.get(id);
  if (!b) throw new Error(`Placa desconocida: ${id}`);
  return b;
}

/** Default props of a part type. */
export function defaultProps(def: PartDef): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const p of def.props) out[p.key] = p.default;
  return out;
}

/** Effective prop value (instance value, else default). */
export function propValue(part: PartInstance, key: string, def: PartDef = getPartDef(part.type)): PropValue | undefined {
  if (key in part.props) return part.props[key];
  return def.props.find((p) => p.key === key)?.default;
}

export const isBoardDef = (def: PartDef) => def.electrical.model === 'mcu';

/** Canonical board pin id (resolves aliasOf: SDA → A4). */
export function canonicalBoardPin(board: BoardProfile, pinId: string): string {
  return board.pins.find((p) => p.id === pinId)?.aliasOf ?? pinId;
}

/** The active board of a project: the first MCU part (only one is supported). */
export function projectBoard(project: ProjectModel): { part: PartInstance; profile: BoardProfile } | null {
  for (const part of project.parts) {
    const def = findPartDef(part.type);
    if (def && def.electrical.model === 'mcu') return { part, profile: getBoardProfile(def.electrical.board) };
  }
  return null;
}

export * from './breadboard';
