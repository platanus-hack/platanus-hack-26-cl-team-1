/**
 * Screen-space HTML layer above the SVG: issue / burned badges, agent
 * highlight caption, pin & wire tooltips, interactive-part popovers and the
 * empty-canvas onboarding card.
 */
import { memo, useMemo, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Cpu, Flame, Gauge, Hand, MousePointerClick, OctagonX, Sparkles, Sun, ToggleLeft, TriangleAlert, X } from 'lucide-react';
import type { CheckIssue, Point, ProjectModel } from '@/contracts';
import { findPartDef } from '@/catalog';
import { formatCurrent, formatVolts } from '@/lib/format';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { useUI } from '@/store/ui';
import { useHW } from '../state';
import { worldToScreen } from '../logic/viewport';
import { describePin, effectiveProp, interactiveKey, safeWorldBounds } from '../logic/partInfo';
import { getPinIndex } from '../logic/pinIndex';
import { wireColorLabel } from '../logic/wireColor';
import { addStarter } from '../actions';
import { safeNetlist } from './overlays';
import { wireWorldPoints } from './WiresLayer';
import { clamp01, setRuntime } from './interactive';

/* ------------------------------------------------------------------ */

function worstSeverity(list: CheckIssue[]): CheckIssue['severity'] {
  if (list.some((i) => i.severity === 'error')) return 'error';
  if (list.some((i) => i.severity === 'warning')) return 'warning';
  return 'info';
}

const PartBadges = memo(function PartBadges({ project }: { project: ProjectModel }) {
  const vp = useHW((s) => s.vp);
  const issues = useHW((s) => s.issues);
  const storeBurned = useSim((s) => s.burned);
  const resultBurned = useSim(
    useShallow((s) => {
      const parts = s.result?.parts;
      if (!parts) return [] as string[];
      return Object.keys(parts).filter((k) => parts[k]?.burned);
    }),
  );
  const byPart = useMemo(() => {
    const m = new Map<string, CheckIssue[]>();
    for (const i of issues) {
      if (i.severity === 'info') continue;
      for (const p of i.parts) {
        const arr = m.get(p);
        if (arr) arr.push(i);
        else m.set(p, [i]);
      }
    }
    return m;
  }, [issues]);
  const burned = new Set([...storeBurned, ...resultBurned]);
  const openChecks = (partId: string) => {
    const ui = useUI.getState();
    ui.togglePanel('guide', false);
    ui.togglePanel('checks', true);
    ui.select({ parts: [partId] });
  };
  return (
    <>
      {project.parts.map((part) => {
        const list = byPart.get(part.id);
        const isBurned = burned.has(part.id);
        if (!list && !isBurned) return null;
        const b = safeWorldBounds(part);
        if (!b) return null;
        const tr = worldToScreen(vp, b.x + b.w, b.y);
        const tl = worldToScreen(vp, b.x, b.y);
        const sev = list ? worstSeverity(list) : null;
        return (
          <div key={part.id}>
            {list && sev && (
              <button
                className={`hw-badge hw-badge--${sev}`}
                style={{ left: tr.x, top: tl.y }}
                title={list.map((i) => i.title).join('\n')}
                onClick={() => openChecks(part.id)}
              >
                {sev === 'error' ? <OctagonX size={12} /> : <TriangleAlert size={12} />}
                {list.length > 1 && <span>{list.length}</span>}
              </button>
            )}
            {isBurned && (
              <div className="hw-burned" style={{ left: (tl.x + tr.x) / 2, top: tl.y }}>
                <Flame size={12} /> Quemado
              </div>
            )}
          </div>
        );
      })}
    </>
  );
});

/* ------------------------------------------------------------------ */

function targetAnchor(project: ProjectModel, target: string): Point | null {
  const part = project.parts.find((p) => p.id === target);
  if (part) {
    const b = safeWorldBounds(part);
    return b ? { x: b.x + b.w / 2, y: b.y } : null;
  }
  const wire = project.wires.find((w) => w.id === target);
  if (wire) {
    const pts = wireWorldPoints(project, wire);
    if (!pts) return null;
    const m = pts[Math.floor(pts.length / 2)];
    const n = pts[Math.max(0, Math.floor(pts.length / 2) - 1)];
    return { x: (m.x + n.x) / 2, y: Math.min(m.y, n.y) };
  }
  const pin = getPinIndex(project).byRef.get(target);
  return pin ? { x: pin.x, y: pin.y - 0.6 } : null;
}

const HighlightCaption = memo(function HighlightCaption({ project }: { project: ProjectModel }) {
  const highlight = useUI((s) => s.highlight);
  const vp = useHW((s) => s.vp);
  if (!highlight?.message) return null;
  const anchor = highlight.targets.map((t) => targetAnchor(project, t)).find((a) => a !== null) ?? null;
  if (!anchor) return null;
  const p = worldToScreen(vp, anchor.x, anchor.y);
  return (
    <div className="hw-caption" style={{ left: p.x, top: p.y }} key={highlight.at}>
      <Sparkles size={14} className="hw-caption-icon" />
      <span>{highlight.message}</span>
      <button className="hw-caption-close" onClick={() => useUI.getState().clearHighlight()} aria-label="Cerrar">
        <X size={12} />
      </button>
    </div>
  );
});

/* ------------------------------------------------------------------ */

function PinTooltip({ project, pinRef, at }: { project: ProjectModel; pinRef: string; at: Point }) {
  const fresh = useSim((s) => (s.result && s.result.project === project ? s.result : null));
  const volts = fresh?.pinVoltages[pinRef];
  const amps = fresh?.pinCurrents?.[pinRef];
  const info = describePin(project, pinRef);
  if (!info.part || !info.pin) return null;
  const netlist = safeNetlist(project);
  const netId = netlist?.pinNet[pinRef];
  const net = netId ? netlist?.nets.find((n) => n.id === netId) : undefined;
  const others = net ? net.pins.length - 1 : 0;
  const netText = net?.name ?? (others > 0 ? `${others} ${others === 1 ? 'punto conectado' : 'puntos conectados'}` : 'Sin conexión');
  const showAmps = amps !== undefined && Math.abs(amps) >= 1e-6 && info.pin?.kind !== 'hole';
  return (
    <div className="hw-tooltip" style={{ left: at.x + 14, top: at.y + 16 }}>
      <div className="hw-tooltip-title">
        <span className="hw-tooltip-part">{info.partLabel}</span>
        <span className="hw-tooltip-sep">·</span>
        <span>{info.pin?.label ?? info.pinLabel}</span>
      </div>
      <div className="hw-tooltip-row">
        <span className={`hw-tooltip-net${net?.name ? ' is-named' : ''}`}>{netText}</span>
        <span className="hw-tooltip-val">{volts !== undefined ? formatVolts(volts) : '—'}</span>
        {showAmps && <span className="hw-tooltip-val is-current">{formatCurrent(Math.abs(amps!))}</span>}
      </div>
      {info.pin?.hint && <div className="hw-tooltip-hint">{info.pin.hint}</div>}
    </div>
  );
}

function WireTooltip({ project, wireId, at }: { project: ProjectModel; wireId: string; at: Point }) {
  const current = useSim((s) => s.result?.wireCurrents[wireId]);
  const wire = project.wires.find((w) => w.id === wireId);
  if (!wire) return null;
  const a = describePin(project, wire.from);
  const b = describePin(project, wire.to);
  return (
    <div className="hw-tooltip" style={{ left: at.x + 14, top: at.y + 16 }}>
      <div className="hw-tooltip-title">
        <span className={`hw-swatch-dot hw-wire--${wire.color}`} />
        <span>Cable {wireColorLabel(wire.color).toLowerCase()}</span>
        <span className="hw-tooltip-val is-current">{current !== undefined ? formatCurrent(Math.abs(current)) : '—'}</span>
      </div>
      <div className="hw-tooltip-hint">
        {a.partLabel} {a.pinLabel} → {b.partLabel} {b.pinLabel}
      </div>
    </div>
  );
}

const HoverTooltip = memo(function HoverTooltip({ project }: { project: ProjectModel }) {
  const hoverPin = useHW((s) => s.hoverPin);
  const hoverWire = useHW((s) => s.hoverWire);
  const cursor = useHW((s) => s.cursor);
  const busy = useHW((s) => s.dragging || s.marquee !== null || s.paletteDrag !== null);
  if (!cursor || busy) return null;
  if (hoverPin) return <PinTooltip project={project} pinRef={hoverPin} at={cursor} />;
  if (hoverWire) return <WireTooltip project={project} wireId={hoverWire} at={cursor} />;
  return null;
});

/* ------------------------------------------------------------------ */

const InteractivePopover = memo(function InteractivePopover({ project }: { project: ProjectModel }) {
  const sel = useUI((s) => s.selection);
  const vp = useHW((s) => s.vp);
  const size = useHW((s) => s.size);
  const dragging = useHW((s) => s.dragging);
  const id = sel.parts.length === 1 && sel.wires.length === 0 ? sel.parts[0] : null;
  const rt = useSim((s) => (id ? s.runtime[id] : undefined));
  if (!id || dragging) return null;
  const part = project.parts.find((p) => p.id === id);
  const def = part && findPartDef(part.type);
  if (!part || !def?.interactive) return null;
  const key = interactiveKey(def);
  if (!key) return null;
  const b = safeWorldBounds(part);
  if (!b) return null;
  const p = worldToScreen(vp, b.x + b.w / 2, b.y + b.h);
  const left = Math.min(Math.max(p.x, 120), Math.max(120, size.w - 120));
  const top = Math.min(p.y + 12, Math.max(0, size.h - 64));
  const value = effectiveProp(part, def, rt, key);
  const stop = (e: RPointerEvent) => e.stopPropagation();
  let body: ReactNode = null;
  if (def.interactive === 'light' || def.interactive === 'knob') {
    const n = typeof value === 'number' ? value : 50;
    const Icon = def.interactive === 'light' ? Sun : Gauge;
    body = (
      <>
        <Icon size={14} className="hw-pop-icon" />
        <span className="hw-pop-label">{def.interactive === 'light' ? 'Luz' : 'Perilla'}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={n}
          className="hw-range"
          style={{ ['--hw-range-pct' as string]: `${n}%` }}
          onChange={(e) => setRuntime(id, key, clamp01(Number(e.target.value)))}
          aria-label={def.interactive === 'light' ? 'Nivel de luz' : 'Posición de la perilla'}
        />
        <span className="hw-pop-value">{Math.round(n)}%</span>
      </>
    );
  } else if (def.interactive === 'toggle') {
    const opts = def.props.find((pp) => pp.key === key)?.options ?? [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    body = (
      <>
        <ToggleLeft size={14} className="hw-pop-icon" />
        <span className="hw-pop-label">Posición</span>
        <div className="hw-pop-seg">
          {opts.map((o) => (
            <button key={String(o.value)} className={value === o.value ? 'active' : ''} onClick={() => setRuntime(id, key, o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      </>
    );
  } else if (def.interactive === 'press') {
    body = (
      <>
        <Hand size={14} className="hw-pop-icon" />
        <span className="hw-pop-label">Mantén presionado el botón para cerrarlo</span>
      </>
    );
  }
  return (
    <div className="hw-pop" style={{ left, top }} onPointerDown={stop}>
      {body}
    </div>
  );
});

/* ------------------------------------------------------------------ */

function Onboarding() {
  return (
    <div className="hw-onboard">
      <div className="hw-onboard-card">
        <div className="hw-onboard-icon">
          <Cpu size={26} />
        </div>
        <h2>Tu mesa de trabajo está vacía</h2>
        <p>Arrastra una placa y una protoboard desde la izquierda, o empieza con un montaje listo:</p>
        <div className="hw-onboard-actions">
          <button className="btn primary" onClick={() => addStarter('uno')}>
            Arduino Uno + protoboard
          </button>
          <button className="btn" onClick={() => addStarter('esp32c6')}>
            ESP32-C6 + protoboard
          </button>
        </div>
        <ul className="hw-onboard-tips">
          <li>
            <MousePointerClick size={13} /> Haz clic en un componente para agregarlo al centro
          </li>
          <li>
            <span className="kbd">W</span> dibuja cables · <span className="kbd">R</span> rota · <span className="kbd">Espacio</span> + arrastrar mueve la vista
          </li>
        </ul>
      </div>
    </div>
  );
}

export function HtmlOverlay() {
  const project = useProject((s) => s.project);
  const empty = project.parts.length === 0;
  const dropping = useHW((s) => s.ghost !== null);
  return (
    <div className="hw-html">
      <PartBadges project={project} />
      <HighlightCaption project={project} />
      <InteractivePopover project={project} />
      <HoverTooltip project={project} />
      {empty && !dropping && <Onboarding />}
    </div>
  );
}
