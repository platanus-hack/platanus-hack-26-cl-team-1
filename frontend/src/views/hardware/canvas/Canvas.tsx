import { useEffect, useRef, type ReactNode } from 'react';
import { findPartDef, projectBoard } from '@/catalog';
import { SharedDefs } from '@/parts/defs';
import { useProject } from '@/store/project';
import { useUI, type Highlight } from '@/store/ui';
import { registerCanvasEl, useHW } from '../state';
import { fitViewport, rectContains, visibleWorld, type Rect } from '../logic/viewport';
import { safeProjectBounds, safeWorldBounds, isBoard } from '../logic/partInfo';
import { getPinIndex, insertionsFor } from '../logic/pinIndex';
import { ghostOrigin } from '../logic/editOps';
import { clientToWorld, centerOnWorld, deleteSelection, duplicateSelection, nudgeSelection, rotateSelection, selectAll, zoomBy } from '../actions';
import { PartsLayer } from './PartsLayer';
import { WiresLayer, wireWorldPoints } from './WiresLayer';
import { DraftOverlay, GhostOverlay, MarqueeOverlay, PinOverlay, SelectionOverlay, WaypointHandles } from './overlays';
import { HtmlOverlay } from './HtmlOverlay';
import { useInteractions } from './useInteractions';

/** Applies the pan/zoom transform; children are created by the parent so they don't re-render on zoom. */
function WorldTransform({ children }: { children: ReactNode }) {
  const vp = useHW((s) => s.vp);
  return <g transform={`translate(${vp.tx} ${vp.ty}) scale(${vp.scale})`}>{children}</g>;
}

/** Dot grid (CSS backgrounds: cheap at any zoom). Minor dots fade out when zoomed out. */
function GridBackground() {
  const vp = useHW((s) => s.vp);
  const minor = vp.scale;
  const major = vp.scale * 5;
  const minorAlpha = Math.max(0, Math.min(1, (vp.scale - 6) / 10));
  return (
    <div className="hw-grid">
      <div
        className="hw-grid-minor"
        style={{
          backgroundSize: `${minor}px ${minor}px`,
          backgroundPosition: `${vp.tx - minor / 2}px ${vp.ty - minor / 2}px`,
          opacity: minorAlpha,
        }}
      />
      <div
        className="hw-grid-major"
        style={{ backgroundSize: `${major}px ${major}px`, backgroundPosition: `${vp.tx - major / 2}px ${vp.ty - major / 2}px` }}
      />
    </div>
  );
}

const HIGHLIGHT_MS = 8000;

/**
 * Agent / checks highlights are transient (8 s, or the next click on the
 * canvas). The wiring guide's step highlight (source 'guide') must stay while
 * the student places that part — the guide replaces/clears it itself.
 */
const isTransientHighlight = (h: Highlight | null | undefined): boolean => !!h && h.source !== 'guide';

/** Centre the view on highlight targets (parts, wires, pins) when they are not fully visible. */
function revealTargets(targets: string[]): void {
  const project = useProject.getState().project;
  const rects: Rect[] = [];
  const idx = getPinIndex(project);
  for (const t of targets) {
    const part = project.parts.find((p) => p.id === t);
    const b = part && safeWorldBounds(part);
    if (b) rects.push(b);
    const wire = project.wires.find((w) => w.id === t);
    const pts = wire && wireWorldPoints(project, wire);
    if (pts) for (const p of pts) rects.push({ x: p.x, y: p.y, w: 0, h: 0 });
    const pin = idx.byRef.get(t);
    if (pin) rects.push({ x: pin.x, y: pin.y, w: 0, h: 0 });
  }
  if (!rects.length) return;
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  const hw = useHW.getState();
  if (hw.size.w <= 0) return;
  if (!rectContains(visibleWorld(hw.vp, hw.size.w, hw.size.h), { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })) {
    centerOnWorld({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!el.closest?.('.blocklyDiv, .blocklyWidgetDiv, .cm-editor');
}

export function Canvas() {
  const project = useProject((s) => s.project);
  const tool = useUI((s) => s.tool);
  const spaceHeld = useHW((s) => s.spaceHeld);
  const drafting = useHW((s) => s.draft !== null);
  const dragging = useHW((s) => s.dragging);
  const rootRef = useRef<HTMLDivElement>(null);
  const handlers = useInteractions(rootRef);
  const { cancelGesture } = handlers;

  // Register for palette drops + track size (fit on first real size).
  useEffect(() => {
    const el = rootRef.current;
    registerCanvasEl(el);
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const hw = useHW.getState();
      if (r.width === hw.size.w && r.height === hw.size.h) return;
      hw.set({ size: { w: r.width, h: r.height } });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      registerCanvasEl(null);
    };
  }, []);

  // Fit requests (also applied when the canvas mounts after a request made while hidden).
  useEffect(() => {
    // Viewport produced by the last automatic fit: while the user has not panned/zoomed
    // since then, a canvas resize (window resize, panels opening) re-fits the content.
    let lastFitVp: unknown = null;
    const fit = (st: ReturnType<typeof useHW.getState>) => {
      const vp = fitViewport(safeProjectBounds(useProject.getState().project), st.size.w, st.size.h);
      lastFitVp = vp;
      st.set({ fitApplied: st.fitRequest, vp });
    };
    const apply = (st: ReturnType<typeof useHW.getState>, resized: boolean) => {
      if (st.size.w <= 0 || st.size.h <= 0) return;
      if (st.fitRequest !== st.fitApplied) fit(st);
      else if (resized && st.vp === lastFitVp) fit(st);
    };
    apply(useHW.getState(), false);
    return useHW.subscribe((st, prev) => {
      if (st.fitRequest !== prev.fitRequest || st.size !== prev.size) apply(st, st.size !== prev.size);
    });
  }, []);

  // Palette drag → ghost preview snapped to the grid.
  useEffect(
    () =>
      useHW.subscribe((s, prev) => {
        if (s.paletteDrag === prev.paletteDrag) return;
        const d = s.paletteDrag;
        if (!d) {
          if (s.ghost) s.set({ ghost: null });
          return;
        }
        const def = findPartDef(d.type);
        const world = clientToWorld(d.clientX, d.clientY);
        if (!def || !world) {
          if (s.ghost) s.set({ ghost: null });
          return;
        }
        const project = useProject.getState().project;
        const o = ghostOrigin(def, world);
        if (s.ghost && s.ghost.type === d.type && s.ghost.x === o.x && s.ghost.y === o.y) return;
        const holes = insertionsFor(def, o, 0, getPinIndex(project)).map((i) => ({ x: i.x, y: i.y }));
        s.set({ ghost: { type: d.type, x: o.x, y: o.y, holes, invalid: isBoard(def) && !!projectBoard(project) } });
      }),
    [],
  );

  // Agent highlight: reveal off-screen targets, auto-clear 8 s after it was set.
  // A highlight set while the canvas was hidden (software view, schematic) is
  // handled on mount: cleared on time and revealed once the canvas has a size.
  useEffect(() => {
    let pendingReveal: Highlight | null = null;
    const scheduleClear = (h: Highlight) => {
      if (!isTransientHighlight(h)) return; // the wiring guide owns (and clears) its step highlight
      const at = h.at;
      setTimeout(() => {
        const cur = useUI.getState().highlight;
        if (cur && cur.at === at) useUI.getState().clearHighlight();
      }, Math.max(0, HIGHLIGHT_MS - (Date.now() - at)));
    };
    const reveal = (h: Highlight) => {
      if (useHW.getState().size.w <= 0) {
        pendingReveal = h;
        return;
      }
      pendingReveal = null;
      revealTargets(h.targets);
    };
    const initial = useUI.getState().highlight;
    if (initial) {
      scheduleClear(initial);
      reveal(initial);
    }
    const unUI = useUI.subscribe((s, prev) => {
      if (s.highlight === prev.highlight) return;
      if (!s.highlight) {
        pendingReveal = null;
        return;
      }
      scheduleClear(s.highlight);
      reveal(s.highlight);
    });
    const unHW = useHW.subscribe((st, prev) => {
      if (!pendingReveal || st.size === prev.size || st.size.w <= 0) return;
      const h = pendingReveal;
      if (useUI.getState().highlight !== h) {
        pendingReveal = null;
        return;
      }
      reveal(h);
    });
    return () => {
      unUI();
      unHW();
    };
  }, []);

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const ui = useUI.getState();
      const hw = useHW.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      if (k === ' ') {
        if (!hw.spaceHeld) hw.set({ spaceHeld: true });
        e.preventDefault();
        return;
      }
      if (mod && k.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && k.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (mod) return;
      switch (k) {
        case 'v':
        case 'V':
          ui.setTool('select');
          hw.set({ draft: null });
          break;
        case 'w':
        case 'W':
          ui.setTool(ui.tool === 'wire' ? 'select' : 'wire');
          if (ui.tool === 'wire') hw.set({ draft: null });
          break;
        case 'r':
        case 'R':
          if (!e.repeat) rotateSelection();
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelection();
          break;
        case 'Escape':
          if (!cancelGesture()) {
            if (ui.tool !== 'select') ui.setTool('select');
            ui.clearSelection();
            ui.clearHighlight();
          }
          break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!ui.selection.parts.length) return;
          e.preventDefault();
          const step = e.shiftKey ? 5 : 1;
          const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
          const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
          nudgeSelection(dx, dy);
          break;
        }
        case '+':
        case '=':
          zoomBy(1.2);
          break;
        case '-':
        case '_':
          zoomBy(1 / 1.2);
          break;
        case '0':
        case '!':
          useHW.getState().requestFit();
          break;
        default:
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || isTypingTarget(e.target)) return;
      e.preventDefault(); // a focused toolbar button must not be "clicked" by the pan key
      if (useHW.getState().spaceHeld) useHW.getState().set({ spaceHeld: false });
    };
    const onBlur = () => useHW.getState().spaceHeld && useHW.getState().set({ spaceHeld: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [cancelGesture]);

  const cls = [
    'hw-canvas',
    `tool-${tool}`,
    spaceHeld ? 'is-space' : '',
    drafting ? 'is-drafting' : '',
    dragging ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} ref={rootRef}>
      <GridBackground />
      <div className="hw-vignette" />
      <svg
        className="hw-svg"
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onPointerLeave={handlers.onPointerLeave}
        onDoubleClick={handlers.onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <SharedDefs />
        <WorldTransform>
          <PartsLayer parts={project.parts} />
          <WiresLayer project={project} />
          <SelectionOverlay project={project} />
          <PinOverlay project={project} />
          <GhostOverlay />
          <DraftOverlay project={project} />
          <WaypointHandles />
          <MarqueeOverlay />
        </WorldTransform>
      </svg>
      <HtmlOverlay />
    </div>
  );
}
