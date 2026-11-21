/**
 * Debug overlay drawn on top of the video (key D): projected hole grid, expected
 * holes of the active step, issue holes, detections, latency, click calibration.
 * Coordinates are frame pixels (640×480); the canvas has the same aspect as the video box.
 */
import { useEffect, useMemo, useRef } from 'react';
import { breadboardPins, findPartDef } from '@/catalog';
import { parsePinRef } from '@/lib/pinref';
import { CALIB_HOLES, applyH, useAssembly } from '@/assembly/store';
import { send } from '@/assembly/session';
import { FRAME_H, FRAME_W } from '@/assembly/useCamera';

const HOLES = breadboardPins().map((p) => ({ id: p.id, x: p.x, y: p.y }));
const HOLE_POS = new Map(HOLES.map((h) => [h.id, h]));
/** Clicks of the 4-hole calibration in progress (frame pixels). */
let calibPoints: Record<string, [number, number]> = {};

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';
}

export function DebugOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);
  const debug = useAssembly((s) => s.debug);
  const H = useAssembly((s) => s.H);
  const detections = useAssembly((s) => s.detections);
  const steps = useAssembly((s) => s.steps);
  const current = useAssembly((s) => s.current);
  const project = useAssembly((s) => s.project);
  const issue = useAssembly((s) => s.issue);
  const calibClick = useAssembly((s) => s.calibClick);

  const expected = useMemo(() => {
    const step = steps.find((s) => s.index === current);
    if (!step || !project) return [] as string[];
    const holes: string[] = [];
    for (const ref of step.highlight) {
      const { part, pin } = parsePinRef(ref);
      const inst = project.parts.find((p) => p.id === part);
      if (inst && findPartDef(inst.type)?.electrical.model === 'bus' && HOLE_POS.has(pin)) holes.push(pin);
    }
    return holes;
  }, [steps, current, project]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = FRAME_W;
    c.height = FRAME_H;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, FRAME_W, FRAME_H);
    if (!debug && !issue) return;
    const accent = css('--accent');
    const danger = css('--danger');
    if (H) {
      const dot = (id: string, r: number, color: string, fill = false) => {
        const h = HOLE_POS.get(id);
        if (!h) return;
        const [x, y] = applyH(H, h.x, h.y);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        if (fill) {
          g.fillStyle = color;
          g.fill();
        } else {
          g.strokeStyle = color;
          g.lineWidth = r < 3 ? 0.8 : 2;
          g.stroke();
        }
      };
      if (debug) {
        // Breadboards are white: dark dots with a blue rim read on both paper and plastic.
        for (const h of HOLES) {
          dot(h.id, 2, 'rgba(10, 13, 17, 0.85)', true);
          g.globalAlpha = 0.9;
          dot(h.id, 2.4, css('--blue'));
          g.globalAlpha = 1;
        }
        for (const id of expected) dot(id, 5, accent);
      }
      for (const id of issue?.holes ?? []) dot(id, 6, danger);
    }
    if (!debug) return;
    g.font = '11px JetBrains Mono, monospace';
    for (const d of detections) {
      const [x1, y1, x2, y2] = d.box;
      g.strokeStyle = d.cls === 'hand' ? css('--warning') : css('--blue');
      g.lineWidth = 1.5;
      g.strokeRect(x1, y1, x2 - x1, y2 - y1);
      const label = `${d.cls} ${(d.conf * 100).toFixed(0)}%${d.holes?.length ? ' ' + d.holes.join(',') : ''}`;
      const w = g.measureText(label).width + 6;
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(x1, Math.max(0, y1 - 14), w, 14);
      g.fillStyle = '#fff';
      g.fillText(label, x1 + 3, Math.max(10, y1 - 3));
    }
  }, [debug, H, detections, expected, issue]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (calibClick === null) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * FRAME_W;
    const y = ((e.clientY - r.top) / r.height) * FRAME_H;
    if (calibClick === 0) calibPoints = {};
    calibPoints[CALIB_HOLES[calibClick]] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    if (calibClick + 1 < CALIB_HOLES.length) {
      useAssembly.getState().patch({ calibClick: calibClick + 1 });
    } else {
      send({ type: 'calib_points', points: calibPoints });
      calibPoints = {};
      useAssembly.getState().patch({ calibClick: null });
    }
  };

  return <canvas ref={ref} className={`asm-overlay ${calibClick !== null ? 'clicking' : ''}`} onClick={onClick} />;
}
