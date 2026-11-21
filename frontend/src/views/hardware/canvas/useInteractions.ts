/**
 * Pointer state machine of the breadboard canvas: pan, marquee, part drag
 * (carrying inserted parts), wire drawing, waypoint editing and direct
 * manipulation of interactive parts.
 */
import { useCallback, useEffect, useRef, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import type { Id, PinRef, Point, ProjectModel, Wire } from '@/contracts';
import { findPartDef } from '@/catalog';
import { nextWireId } from '@/lib/ids';
import { coveredHoles } from '@/placement';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { useHW } from '../state';
import { carriedParts, getPinIndex, insertionsFor, pinAt, type PinEntry } from '../logic/pinIndex';
import { moveOps, partsInRect, snapshotMove, wiresInRect, type MoveSnapshot, type Selection } from '../logic/editOps';
import { rectFromPoints, screenToWorld, wheelZoomFactor, zoomAt } from '../logic/viewport';
import { autoWireColor, classifyEndpoint } from '../logic/wireColor';
import { closestSegment } from '../logic/wirePath';
import { safeNetlist } from './overlays';
import { wireWorldPoints } from './WiresLayer';
import {
  actuatorInteraction,
  bodyInteraction,
  bumpRuntime,
  clamp01,
  flipToggle,
  numericRuntime,
  setRuntime,
  type InteractMode,
} from './interactive';

const DRAG_THRESHOLD_PX = 4;

const coveredCache = new WeakMap<ProjectModel, ReadonlySet<PinRef>>();
/** Breadboard holes under another part's body (memoized per immutable project). */
function coveredHolesOf(project: ProjectModel): ReadonlySet<PinRef> {
  let s = coveredCache.get(project);
  if (!s) {
    try {
      s = coveredHoles(project);
    } catch {
      s = new Set();
    }
    coveredCache.set(project, s);
  }
  return s;
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number }
  | { kind: 'marquee'; start: Point; additive: boolean; base: Selection; moved: boolean; sx: number; sy: number }
  | {
      kind: 'part';
      partId: Id;
      sx: number;
      sy: number;
      start: Point;
      snap: MoveSnapshot;
      moving: Set<Id>;
      primary: Set<Id>;
      moved: boolean;
      lastDx: number;
      lastDy: number;
      key: string;
      body: { mode: InteractMode; key: string } | null;
      pressed: boolean;
    }
  | { kind: 'actuator'; partId: Id; key: string; mode: InteractMode; sx: number; sy: number; startValue: number; moved: boolean }
  | { kind: 'wire'; sx: number; sy: number; moved: boolean }
  | { kind: 'waypoint'; wireId: Id; index: number; key: string; moved: boolean; sx: number; sy: number };

let gestureSeq = 0;

const toast = (t: string, k: 'info' | 'warning' | 'error' = 'info') => useUI.getState().toast(t, k);

export function useInteractions(rootRef: RefObject<HTMLDivElement | null>) {
  const gesture = useRef<Gesture | null>(null);

  const local = useCallback(
    (clientX: number, clientY: number) => {
      const r = rootRef.current?.getBoundingClientRect();
      return { sx: clientX - (r?.left ?? 0), sy: clientY - (r?.top ?? 0) };
    },
    [rootRef],
  );

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const { sx, sy } = local(clientX, clientY);
      return screenToWorld(useHW.getState().vp, sx, sy);
    },
    [local],
  );

  /**
   * Pin under the pointer, respecting what is drawn on top. Breadboard holes
   * covered by another part's body are never offered (contract: "not free for
   * new legs or wire ends"), even when the pointer is over a jumper crossing
   * that body or just outside its outline.
   */
  const hitPin = useCallback((world: Point, el: Element | null, forWire: boolean): PinEntry | null => {
    const project = useProject.getState().project;
    const idx = getPinIndex(project);
    const covered = coveredHolesOf(project);
    const scale = useHW.getState().vp.scale;
    const radius = Math.min(0.46, Math.max(0.3, 7 / scale));
    if (el?.closest('[data-wire-id]') && !forWire) return null;
    const partEl = el?.closest('[data-part-id]');
    const topId = partEl?.getAttribute('data-part-id');
    const topZ = topId ? project.parts.findIndex((p) => p.id === topId) : -1;
    return pinAt(idx, world, radius, (e) => (topZ < 0 || e.z >= topZ) && !(e.isHole && covered.has(e.ref)));
  }, []);

  const cancelDraft = useCallback(() => {
    if (useHW.getState().draft) useHW.getState().set({ draft: null });
  }, []);

  const finishWire = useCallback((to: PinEntry) => {
    const hw = useHW.getState();
    const d = hw.draft;
    if (!d) return;
    if (to.ref === d.from) {
      hw.set({ draft: null });
      return;
    }
    const project = useProject.getState().project;
    const netlist = safeNetlist(project);
    const color = autoWireColor(classifyEndpoint(project, netlist, d.from), classifyEndpoint(project, netlist, to.ref), project.wires);
    const wire: Wire = { id: nextWireId(project), from: d.from, to: to.ref, color };
    if (d.waypoints.length) wire.waypoints = d.waypoints.map((p) => ({ ...p }));
    const r = useProject.getState().dispatch({ op: 'wire.add', wire }, { label: 'Agregar cable' });
    hw.set({ draft: null });
    if (!r.ok) toast(r.error ?? 'No se pudo crear el cable', 'error');
    else useUI.getState().select({ wires: [wire.id] });
  }, []);

  const startDraft = useCallback((pin: PinEntry) => {
    useHW.getState().set({ draft: { from: pin.ref, fromPt: { x: pin.x, y: pin.y }, waypoints: [], cursor: { x: pin.x, y: pin.y } } });
  }, []);

  /** Hover bookkeeping (part / wire / pin under the cursor, tooltip anchor, rubber band). */
  const updateHover = useCallback(
    (clientX: number, clientY: number) => {
      const hw = useHW.getState();
      const el = document.elementFromPoint(clientX, clientY);
      const inside = !!el && !!rootRef.current?.contains(el);
      const world = toWorld(clientX, clientY);
      const drafting = !!hw.draft;
      const tool = useUI.getState().tool;
      const pin = inside ? hitPin(world, el, drafting || tool === 'wire') : null;
      const partId = inside ? (el?.closest('[data-part-id]')?.getAttribute('data-part-id') ?? null) : null;
      const wireId = inside && !drafting ? (el?.closest('[data-wire-id]')?.getAttribute('data-wire-id') ?? null) : null;
      const { sx, sy } = local(clientX, clientY);
      const patch: Partial<typeof hw> = { cursor: inside ? { x: sx, y: sy } : null };
      if (hw.hoverPart !== partId) patch.hoverPart = partId;
      if (hw.hoverWire !== wireId) patch.hoverWire = wireId;
      const pinRefStr = pin?.ref ?? null;
      if (hw.hoverPin !== pinRefStr) {
        patch.hoverPin = pinRefStr;
        useUI.getState().setHoveredPin(pinRefStr);
      }
      if (hw.draft) patch.draft = { ...hw.draft, cursor: pin ? { x: pin.x, y: pin.y } : world };
      hw.set(patch);
    },
    [hitPin, local, rootRef, toWorld],
  );

  const onPointerDown = useCallback(
    (e: RPointerEvent<SVGSVGElement>) => {
      const hw = useHW.getState();
      const ui = useUI.getState();
      if (ui.highlight && ui.highlight.source !== 'guide') ui.clearHighlight();
      const { sx, sy } = local(e.clientX, e.clientY);
      const world = toWorld(e.clientX, e.clientY);
      const target = e.target as Element;
      const svg = e.currentTarget;
      const capture = () => {
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      };

      // Pan: middle / right button, space held, or pan tool.
      if (e.button === 1 || e.button === 2 || hw.spaceHeld || ui.tool === 'pan') {
        if (e.button === 2 && hw.draft) {
          cancelDraft();
          return;
        }
        e.preventDefault();
        gesture.current = { kind: 'pan', sx, sy, tx: hw.vp.tx, ty: hw.vp.ty };
        capture();
        return;
      }
      if (e.button !== 0) return;

      // Wire draft in progress: finish on a pin, waypoint on empty space.
      if (hw.draft) {
        const pin = hitPin(world, target, true);
        if (pin) finishWire(pin);
        else hw.set({ draft: { ...hw.draft, waypoints: [...hw.draft.waypoints, { x: Math.round(world.x), y: Math.round(world.y) }] } });
        return;
      }

      const wpEl = target.closest('[data-waypoint]');
      if (wpEl) {
        const [wireId, i] = (wpEl.getAttribute('data-waypoint') ?? '').split(':');
        gesture.current = { kind: 'waypoint', wireId, index: Number(i), key: `hw-wp-${++gestureSeq}`, moved: false, sx, sy };
        capture();
        return;
      }

      const partEl = target.closest('[data-part-id]');
      const partId = partEl?.getAttribute('data-part-id') ?? null;
      const actEl = target.closest('[data-actuator]');

      // Interactive actuators never start a drag.
      if (actEl && partId && ui.tool === 'select') {
        const key = actEl.getAttribute('data-actuator') ?? '';
        const mode = actuatorInteraction(partId, key);
        if (mode) {
          if (!e.shiftKey && !ui.selection.parts.includes(partId)) ui.select({ parts: [partId] });
          if (mode === 'press') setRuntime(partId, key, true);
          gesture.current = { kind: 'actuator', partId, key, mode, sx, sy, startValue: numericRuntime(partId, key), moved: false };
          capture();
          return;
        }
      }

      const pin = hitPin(world, target, ui.tool === 'wire');
      if (pin) {
        startDraft(pin);
        gesture.current = { kind: 'wire', sx, sy, moved: false };
        capture();
        return;
      }
      if (ui.tool === 'wire') return;

      const wireEl = target.closest('[data-wire-id]');
      if (wireEl) {
        const id = wireEl.getAttribute('data-wire-id')!;
        if (e.shiftKey) {
          const has = ui.selection.wires.includes(id);
          ui.select({ parts: ui.selection.parts, wires: has ? ui.selection.wires.filter((w) => w !== id) : [...ui.selection.wires, id] });
        } else ui.select({ wires: [id] });
        return;
      }

      if (partId) {
        let selParts = ui.selection.parts;
        if (e.shiftKey) {
          selParts = selParts.includes(partId) ? selParts.filter((p) => p !== partId) : [...selParts, partId];
          ui.select({ parts: selParts, wires: ui.selection.wires });
          if (!selParts.includes(partId)) return;
        } else if (!selParts.includes(partId)) {
          selParts = [partId];
          ui.select({ parts: selParts });
        }
        const project = useProject.getState().project;
        const primary = new Set(selParts);
        const moving = new Set(primary);
        for (const c of carriedParts(project, primary, safeNetlist(project) ?? undefined)) moving.add(c);
        const body = bodyInteraction(partId);
        const pressed = body?.mode === 'press';
        if (pressed && body) setRuntime(partId, body.key, true);
        gesture.current = {
          kind: 'part',
          partId,
          sx,
          sy,
          start: world,
          snap: snapshotMove(project, moving),
          moving,
          primary,
          moved: false,
          lastDx: 0,
          lastDy: 0,
          key: `hw-drag-${++gestureSeq}`,
          body,
          pressed,
        };
        capture();
        return;
      }

      // Empty space: marquee selection.
      const base: Selection = e.shiftKey ? { ...ui.selection } : { parts: [], wires: [] };
      if (!e.shiftKey) ui.clearSelection();
      gesture.current = { kind: 'marquee', start: world, additive: e.shiftKey, base, moved: false, sx, sy };
      capture();
    },
    [cancelDraft, finishWire, hitPin, local, startDraft, toWorld],
  );

  const onPointerMove = useCallback(
    (e: RPointerEvent<SVGSVGElement>) => {
      const g = gesture.current;
      const hw = useHW.getState();
      const { sx, sy } = local(e.clientX, e.clientY);
      if (!g) {
        updateHover(e.clientX, e.clientY);
        return;
      }
      const far = (x0: number, y0: number) => Math.hypot(sx - x0, sy - y0) > DRAG_THRESHOLD_PX;
      switch (g.kind) {
        case 'pan':
          hw.set({ vp: { ...hw.vp, tx: g.tx + (sx - g.sx), ty: g.ty + (sy - g.sy) } });
          return;
        case 'marquee': {
          if (!g.moved && !far(g.sx, g.sy)) return;
          g.moved = true;
          const world = toWorld(e.clientX, e.clientY);
          const rect = rectFromPoints(g.start, world);
          hw.set({ marquee: rect });
          const project = useProject.getState().project;
          const parts = partsInRect(project, rect);
          const wires = wiresInRect(project, rect);
          const uniq = <T,>(a: T[]) => [...new Set(a)];
          useUI.getState().select(
            g.additive ? { parts: uniq([...g.base.parts, ...parts]), wires: uniq([...g.base.wires, ...wires]) } : { parts, wires },
          );
          return;
        }
        case 'part': {
          if (!g.moved) {
            if (!far(g.sx, g.sy)) return;
            g.moved = true;
            if (g.pressed && g.body) {
              setRuntime(g.partId, g.body.key, false);
              g.pressed = false;
            }
            hw.set({ dragging: true, hoverPin: null });
          }
          const world = toWorld(e.clientX, e.clientY);
          const dx = Math.round(world.x - g.start.x);
          const dy = Math.round(world.y - g.start.y);
          if (dx === g.lastDx && dy === g.lastDy) return;
          g.lastDx = dx;
          g.lastDy = dy;
          const label = g.primary.size === 1 ? 'Mover componente' : 'Mover componentes';
          useProject.getState().dispatch(moveOps(g.snap, dx, dy), { label, mergeKey: g.key, group: g.key });
          // Preview which legs will plug in where.
          const project = useProject.getState().project;
          const idx = getPinIndex(project);
          const holes: Point[] = [];
          for (const id of g.moving) {
            const part = project.parts.find((p) => p.id === id);
            const def = part && findPartDef(part.type);
            if (!part || !def) continue;
            for (const ins of insertionsFor(def, part, part.rotation, idx, g.moving)) holes.push({ x: ins.x, y: ins.y });
          }
          hw.set({ dragHoles: holes });
          return;
        }
        case 'actuator': {
          // Knobs (potentiometer rotor) and light sensors (LDR disc) are dragged vertically.
          if (g.mode !== 'knob' && g.mode !== 'light') {
            if (far(g.sx, g.sy)) g.moved = true;
            return;
          }
          g.moved = true;
          setRuntime(g.partId, g.key, clamp01(g.startValue + (g.sy - sy) * 0.6));
          return;
        }
        case 'wire': {
          if (far(g.sx, g.sy)) g.moved = true;
          updateHover(e.clientX, e.clientY);
          return;
        }
        case 'waypoint': {
          if (!g.moved && !far(g.sx, g.sy)) return;
          g.moved = true;
          const project = useProject.getState().project;
          const wire = project.wires.find((w) => w.id === g.wireId);
          if (!wire?.waypoints) return;
          const world = toWorld(e.clientX, e.clientY);
          const p = { x: Math.round(world.x), y: Math.round(world.y) };
          const cur = wire.waypoints[g.index];
          if (!cur || (cur.x === p.x && cur.y === p.y)) return;
          const waypoints = wire.waypoints.map((q, i) => (i === g.index ? p : q));
          useProject.getState().dispatch({ op: 'wire.update', id: wire.id, patch: { waypoints } }, { label: 'Editar cable', mergeKey: g.key, group: g.key });
          return;
        }
      }
    },
    [local, toWorld, updateHover],
  );

  const endGesture = useCallback(
    (e: RPointerEvent<SVGSVGElement>, cancelled: boolean) => {
      const g = gesture.current;
      gesture.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!g) return;
      const hw = useHW.getState();
      switch (g.kind) {
        case 'marquee':
          hw.set({ marquee: null });
          break;
        case 'part':
          if (g.pressed && g.body) setRuntime(g.partId, g.body.key, false);
          if (!g.moved && !cancelled && g.body?.mode === 'toggle') flipToggle(g.partId, g.body.key);
          if (g.moved) hw.set({ dragging: false, dragHoles: [] });
          break;
        case 'actuator':
          if (g.mode === 'press') setRuntime(g.partId, g.key, false);
          else if (g.mode === 'toggle' && !g.moved && !cancelled) flipToggle(g.partId, g.key);
          break;
        case 'wire': {
          if (cancelled) {
            hw.set({ draft: null });
            break;
          }
          if (!g.moved) break; // click on a pin: keep drawing (click-click mode)
          const world = toWorld(e.clientX, e.clientY);
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const pin = hitPin(world, el, true);
          if (pin && pin.ref !== hw.draft?.from) finishWire(pin);
          else if (useUI.getState().tool !== 'wire') hw.set({ draft: null });
          break;
        }
        default:
          break;
      }
      updateHover(e.clientX, e.clientY);
    },
    [finishWire, hitPin, toWorld, updateHover],
  );

  const onPointerUp = useCallback((e: RPointerEvent<SVGSVGElement>) => endGesture(e, false), [endGesture]);
  const onPointerCancel = useCallback((e: RPointerEvent<SVGSVGElement>) => endGesture(e, true), [endGesture]);

  const onPointerLeave = useCallback(() => {
    if (gesture.current) return;
    const hw = useHW.getState();
    if (hw.hoverPart || hw.hoverPin || hw.hoverWire || hw.cursor) {
      hw.set({ hoverPart: null, hoverPin: null, hoverWire: null, cursor: null });
      useUI.getState().setHoveredPin(null);
    }
  }, []);

  /** Double-click: on a waypoint removes it, on a wire inserts one. */
  const onDoubleClick = useCallback(
    (e: RMouseEvent<SVGSVGElement>) => {
      const target = e.target as Element;
      const project = useProject.getState().project;
      const wpEl = target.closest('[data-waypoint]');
      if (wpEl) {
        const [wireId, i] = (wpEl.getAttribute('data-waypoint') ?? '').split(':');
        const wire = project.wires.find((w) => w.id === wireId);
        if (!wire?.waypoints) return;
        const waypoints = wire.waypoints.filter((_, k) => k !== Number(i));
        useProject.getState().dispatch({ op: 'wire.update', id: wireId, patch: { waypoints } }, { label: 'Quitar curva del cable' });
        return;
      }
      const wireEl = target.closest('[data-wire-id]');
      if (wireEl && !useHW.getState().draft) {
        const id = wireEl.getAttribute('data-wire-id')!;
        const wire = project.wires.find((w) => w.id === id);
        const pts = wire && wireWorldPoints(project, wire);
        if (!wire || !pts) return;
        const world = toWorld(e.clientX, e.clientY);
        const p = { x: Math.round(world.x), y: Math.round(world.y) };
        const seg = closestSegment(pts, p);
        const waypoints = [...(wire.waypoints ?? [])];
        waypoints.splice(seg, 0, p);
        useProject.getState().dispatch({ op: 'wire.update', id, patch: { waypoints } }, { label: 'Agregar curva al cable' });
        useUI.getState().select({ wires: [id] });
      }
    },
    [toWorld],
  );

  // Wheel: zoom at cursor, or turn a knob under the cursor.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const target = e.target as Element | null;
      const partId = target?.closest?.('[data-part-id]')?.getAttribute('data-part-id');
      if (partId && useUI.getState().tool === 'select' && !e.ctrlKey) {
        const body = bodyInteraction(partId);
        if (body && (body.mode === 'knob' || body.mode === 'light')) {
          bumpRuntime(partId, body.key, e.deltaY < 0 ? 5 : -5);
          return;
        }
      }
      const r = el.getBoundingClientRect();
      const hw = useHW.getState();
      hw.set({ vp: zoomAt(hw.vp, e.clientX - r.left, e.clientY - r.top, wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey)) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [rootRef]);

  /** Abort whatever gesture is in progress (Esc). Returns true if something was cancelled. */
  const cancelGesture = useCallback((): boolean => {
    const hw = useHW.getState();
    const g = gesture.current;
    let did = false;
    if (g) {
      if (g.kind === 'part' && g.moved) {
        // restore the original positions (still one merged undo step)
        useProject.getState().dispatch(moveOps(g.snap, 0, 0), { label: 'Mover componente', mergeKey: g.key, group: g.key });
      }
      if (g.kind === 'part' && g.pressed && g.body) setRuntime(g.partId, g.body.key, false);
      if (g.kind === 'actuator' && g.mode === 'press') setRuntime(g.partId, g.key, false);
      gesture.current = null;
      did = true;
    }
    if (hw.draft || hw.marquee || hw.dragging) {
      hw.set({ draft: null, marquee: null, dragging: false, dragHoles: [] });
      did = true;
    }
    return did;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onDoubleClick, cancelGesture };
}
