/**
 * Local (view-only) state of the hardware workspace: viewport, hover,
 * in-progress gestures, palette drag. Not persisted, not undoable.
 */
import { create } from 'zustand';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import type { CheckIssue, Id, PinRef, Point } from '@/contracts';
import { GRID_PX } from '@/lib/geometry';
import type { Rect, Viewport } from './logic/viewport';

export interface WireDraft {
  from: PinRef;
  fromPt: Point;
  waypoints: Point[];
  /** Current rubber-band end (snapped to the hovered pin when there is one). */
  cursor: Point;
}

export interface PaletteDrag {
  type: string;
  clientX: number;
  clientY: number;
}

export interface Ghost {
  type: string;
  x: number;
  y: number;
  /** World points where pins will plug in (male↔female). */
  holes: Point[];
  invalid: boolean;
}

export interface HWState {
  vp: Viewport;
  size: { w: number; h: number };
  /** Increment to ask the canvas to fit the project. */
  fitRequest: number;
  /** Last fitRequest the canvas applied (a pending request survives unmounts). */
  fitApplied: number;
  showFlow: boolean;
  paletteCollapsed: boolean;
  spaceHeld: boolean;

  hoverPart: Id | null;
  hoverPin: PinRef | null;
  hoverWire: Id | null;
  /** Cursor in canvas pixel coordinates (tooltips). */
  cursor: Point | null;

  draft: WireDraft | null;
  marquee: Rect | null;
  /** Holes highlighted while dragging parts on the canvas. */
  dragHoles: Point[];
  dragging: boolean;

  paletteDrag: PaletteDrag | null;
  ghost: Ghost | null;

  issues: CheckIssue[];

  set: (p: Partial<HWState>) => void;
  requestFit: () => void;
}

export const useHW = create<HWState>((set, get) => ({
  vp: { scale: GRID_PX, tx: 40, ty: 40 },
  size: { w: 0, h: 0 },
  fitRequest: 1,
  fitApplied: 0,
  showFlow: true,
  paletteCollapsed: false,
  spaceHeld: false,
  hoverPart: null,
  hoverPin: null,
  hoverWire: null,
  cursor: null,
  draft: null,
  marquee: null,
  dragHoles: [],
  dragging: false,
  paletteDrag: null,
  ghost: null,
  issues: [],
  set: (p) => set(p),
  requestFit: () => set({ fitRequest: get().fitRequest + 1 }),
}));

/** Canvas element registry (palette drop hit-testing). */
let canvasEl: HTMLElement | null = null;
export const registerCanvasEl = (el: HTMLElement | null) => {
  canvasEl = el;
};
export const getCanvasEl = () => canvasEl;


/**
 * Fit the view (and drop transient gestures) whenever a whole project is
 * loaded: examples, import, "new", undo/redo of a load. Module-level so it
 * also catches loads while the canvas is hidden.
 */
type ProjectStoreState = ReturnType<typeof useProject.getState>;

/**
 * True when THIS dispatch applied a `project.load`. Only the ops it appended
 * count: later ops merged into the same agent-turn entry (group) carry the
 * earlier load in `last.ops` but must not re-fit / drop the user's gesture.
 */
function loadedNewProject(s: ProjectStoreState, prev: ProjectStoreState): boolean {
  const last = s.past[s.past.length - 1];
  if (!last || prev.past.includes(last)) return false; // undo, or no history change
  const prevLast = prev.past[prev.past.length - 1];
  const merged =
    !!prevLast && s.past.length === prev.past.length && !s.past.includes(prevLast) &&
    last.ops.length > prevLast.ops.length && last.ops[0] === prevLast.ops[0];
  const added = merged ? last.ops.slice(prevLast.ops.length) : last.ops;
  return added.some((o) => o.op === 'project.load');
}

useProject.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  if (s.project.id === prev.project.id && !loadedNewProject(s, prev)) return;
  useHW.getState().set({ draft: null, ghost: null, marquee: null, dragHoles: [], dragging: false });
  useUI.getState().clearSelection();
  useHW.getState().requestFit();
});
