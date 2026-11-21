/**
 * User actions of the hardware workspace (dispatch + selection + toasts).
 */
import type { BoardId, Id, Op, Point } from '@/contracts';
import { findPartDef, projectBoard } from '@/catalog';
import { findFreeSpot } from '@/placement';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { getNetlist } from '@/store/derived';
import { createStarterProject } from '@/store/newProject';
import { getCanvasEl, useHW } from './state';
import { centerOn, screenToWorld, zoomAt } from './logic/viewport';
import {
  deleteOps,
  duplicateOps,
  findClearSpot,
  ghostOrigin,
  insertIndexFor,
  moveOps,
  newPartInstance,
  pruneSelection,
  rotateOps,
  snapshotMove,
} from './logic/editOps';
import { isBoard } from './logic/partInfo';
import { carriedParts } from './logic/pinIndex';

const toast = (text: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info') => useUI.getState().toast(text, kind);

function safeNetlist() {
  try {
    return getNetlist(useProject.getState().project);
  } catch {
    return undefined;
  }
}

/** Explanation shown when a second board is added. */
export function secondBoardMessage(existingLabel: string): string {
  return `Solo se puede usar una placa por proyecto. Ya tienes "${existingLabel}": elimínala primero si quieres cambiarla.`;
}

/** World point under a client position, or null when outside the canvas. */
export function clientToWorld(clientX: number, clientY: number): Point | null {
  const el = getCanvasEl();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
  return screenToWorld(useHW.getState().vp, clientX - r.left, clientY - r.top);
}

/** Centre of the visible canvas in world coordinates. */
export function viewportCenterWorld(): Point {
  const { vp, size } = useHW.getState();
  return screenToWorld(vp, size.w / 2, size.h / 2);
}

/**
 * Add a part of `type` with its centre at `world` (or at the viewport centre,
 * or a free spot when the canvas is not visible). Returns the new id.
 */
export function addPart(type: string, world?: Point | null): Id | null {
  const project = useProject.getState().project;
  const def = findPartDef(type);
  if (!def) return null;
  if (isBoard(def)) {
    const existing = projectBoard(project);
    if (existing) {
      toast(secondBoardMessage(existing.part.label), 'warning');
      return null;
    }
  }
  let origin: Point;
  const ui = useUI.getState();
  if (world) origin = ghostOrigin(def, world);
  else if (getCanvasEl() && ui.hardwareMode === 'board' && useHW.getState().size.w > 0) {
    // centre of the view, nudged to the nearest spot that does not land on another part
    origin = findClearSpot(project, def, viewportCenterWorld());
  } else {
    origin = findFreeSpot(project, type);
  }
  const part = newPartInstance(project, def, origin);
  const res = useProject.getState().dispatch({ op: 'part.add', part, index: insertIndexFor(project, def) }, { label: `Agregar ${def.name}` });
  if (!res.ok) {
    toast(res.error ?? 'No se pudo agregar el componente', 'error');
    return null;
  }
  ui.select({ parts: [part.id] });
  return part.id;
}

export function currentSelection() {
  const project = useProject.getState().project;
  return pruneSelection(project, useUI.getState().selection);
}

export function deleteSelection(): void {
  const project = useProject.getState().project;
  const sel = currentSelection();
  const ops = deleteOps(project, sel);
  if (!ops.length) return;
  const n = sel.parts.length + sel.wires.length;
  const label = sel.parts.length === 0 ? (sel.wires.length === 1 ? 'Eliminar cable' : 'Eliminar cables') : n === 1 ? 'Eliminar componente' : `Eliminar ${n} elementos`;
  const res = useProject.getState().dispatch(ops, { label });
  if (!res.ok) toast(res.error ?? 'No se pudo eliminar', 'error');
  useUI.getState().clearSelection();
}

export function rotateSelection(): void {
  const project = useProject.getState().project;
  const sel = currentSelection();
  const ops = rotateOps(project, sel.parts);
  if (!ops.length) return;
  const res = useProject.getState().dispatch(ops, { label: sel.parts.length === 1 ? 'Rotar componente' : 'Rotar componentes' });
  if (!res.ok) toast(res.error ?? 'No se pudo rotar', 'error');
}

export function duplicateSelection(): void {
  const project = useProject.getState().project;
  const sel = currentSelection();
  if (!sel.parts.length) return;
  const r = duplicateOps(project, sel.parts, sel.wires);
  if (r.skippedBoard) toast('La placa no se duplica: solo se puede usar una por proyecto.', 'info');
  if (!r.ops.length) return;
  const res = useProject.getState().dispatch(r.ops, { label: 'Duplicar' });
  if (!res.ok) {
    toast(res.error ?? 'No se pudo duplicar', 'error');
    return;
  }
  useUI.getState().select({ parts: r.parts, wires: r.wires });
}

/** Ops that move `ids` (and the parts plugged into them) by (dx, dy). */
export function groupMoveOps(ids: Id[], dx: number, dy: number): Op[] {
  const project = useProject.getState().project;
  const moving = new Set(ids);
  for (const c of carriedParts(project, moving, safeNetlist())) moving.add(c);
  return moveOps(snapshotMove(project, moving), dx, dy);
}

export function nudgeSelection(dx: number, dy: number): void {
  const sel = currentSelection();
  if (!sel.parts.length) return;
  const ops = groupMoveOps(sel.parts, dx, dy);
  if (ops.length) useProject.getState().dispatch(ops, { label: 'Mover componente', mergeKey: 'hw-nudge' });
}

export function selectAll(): void {
  const p = useProject.getState().project;
  useUI.getState().select({ parts: p.parts.map((x) => x.id), wires: p.wires.map((w) => w.id) });
}

export function zoomBy(factor: number): void {
  const { vp, size, set } = useHW.getState();
  set({ vp: zoomAt(vp, size.w / 2, size.h / 2, factor) });
}

export function setZoom(scale: number): void {
  const { vp, size, set } = useHW.getState();
  set({ vp: zoomAt(vp, size.w / 2, size.h / 2, scale / vp.scale) });
}

export function centerOnWorld(p: Point): void {
  const { vp, size, set } = useHW.getState();
  set({ vp: centerOn(vp, p, size.w, size.h) });
}

/** Add a board (left) + breadboard (right) to an empty project. */
export function addStarter(board: BoardId): void {
  const project = useProject.getState().project;
  if (project.parts.length) return;
  const starter = createStarterProject(board);
  const ops: Op[] = starter.parts.map((part) => ({ op: 'part.add', part }));
  const res = useProject.getState().dispatch(ops, { label: 'Montaje base' });
  if (!res.ok) toast(res.error ?? 'No se pudo crear el montaje', 'error');
  else useHW.getState().requestFit();
}
