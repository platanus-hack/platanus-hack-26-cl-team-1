import type { BoardId, ProjectModel } from '@/contracts';
import { nanoid } from 'nanoid';

export function createEmptyProject(name = 'Mi circuito'): ProjectModel {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: nanoid(10),
    name,
    parts: [],
    wires: [],
    program: { workspace: null },
    meta: { createdAt: now, updatedAt: now },
  };
}

/** Empty project with a board (left) and a breadboard (right) already placed. */
export function createStarterProject(board: BoardId | null = 'uno', name = 'Mi circuito'): ProjectModel {
  const p = createEmptyProject(name);
  if (board === 'uno') {
    p.parts.push({ id: 'uno1', type: 'arduino-uno', label: 'Arduino Uno', x: 0, y: 0, rotation: 0, props: {} });
    p.parts.push({ id: 'bb1', type: 'breadboard-half', label: 'Protoboard', x: 34, y: 0, rotation: 0, props: {} });
  } else if (board === 'esp32c6') {
    p.parts.push({ id: 'bb1', type: 'breadboard-half', label: 'Protoboard', x: 0, y: 0, rotation: 0, props: {} });
    // DevKit straddling the breadboard: J1 on row c (y=7), J3 on row j (y=16); pins x=3..18 → columns 2..17
    p.parts.push({ id: 'esp1', type: 'esp32c6-devkit', label: 'ESP32-C6', x: 0, y: 6, rotation: 0, props: {} });
  } else {
    p.parts.push({ id: 'bb1', type: 'breadboard-half', label: 'Protoboard', x: 0, y: 0, rotation: 0, props: {} });
  }
  return p;
}
