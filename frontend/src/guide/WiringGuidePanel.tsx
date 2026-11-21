/**
 * Step-by-step wiring guide panel: progress bar, current step card, prev/next,
 * checklist. Every step change highlights its parts/holes/wires on the canvas.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Cable,
  Check,
  ChevronLeft,
  ChevronRight,
  CircuitBoard,
  Code2,
  Component,
  Grid3x3,
  Lightbulb,
  ListChecks,
  PartyPopper,
  RotateCcw,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import type { GuideStep, WireColor } from '@/contracts';
import { netlistFor } from '@/placement';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { buildWiringGuide } from './build';
import { WIRE_COLOR_ES } from './text';
import './WiringGuidePanel.css';

const KIND_META: Record<GuideStep['kind'], { label: string; icon: typeof Cable }> = {
  board: { label: 'Placa', icon: CircuitBoard },
  breadboard: { label: 'Protoboard', icon: Grid3x3 },
  part: { label: 'Componente', icon: Component },
  power: { label: 'Alimentación', icon: Zap },
  wire: { label: 'Cable de señal', icon: Cable },
  check: { label: 'Revisión', icon: ShieldCheck },
  program: { label: 'Programa', icon: Code2 },
};

/** UIState.highlight source of the guide's canvas caption. */
const HIGHLIGHT_SOURCE = 'guide';

const HOLE_RE = /\b([a-j](?:[1-9]|[12]\d|30))\b/g;

/** Detail text with breadboard holes rendered as small mono chips. */
function renderDetail(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(HOLE_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <code key={i} className="guide-hole">
        {m[1]}
      </code>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface WiringGuidePanelProps {
  /** Optional close button handler (shown in the header when provided). */
  onClose?: () => void;
  /**
   * Show the "Guía de armado" title row. Default: only when `onClose` is given
   * (hosts like the hardware drawer already render their own title).
   */
  showTitle?: boolean;
  className?: string;
}

export function WiringGuidePanel({ onClose, showTitle, className }: WiringGuidePanelProps = {}) {
  const titled = showTitle ?? !!onClose;
  const project = useProject((s) => s.project);
  const steps = useMemo(() => {
    try {
      return buildWiringGuide(project, netlistFor(project));
    } catch (err) {
      console.error('[guide] no se pudo generar la guía', err);
      return [];
    }
  }, [project]);
  const wireColors = useMemo(() => new Map(project.wires.map((w) => [w.id, w.color])), [project.wires]);

  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLOListElement>(null);
  // Another project (example, import, "new") reuses ids like led1/w1: start over.
  const [guideFor, setGuideFor] = useState(project.id);
  if (guideFor !== project.id) {
    setGuideFor(project.id);
    setCurrent(0);
    setDone(new Set());
  }

  const index = Math.min(current, Math.max(0, steps.length - 1));
  const step = steps[index] as GuideStep | undefined;
  const hasContent = steps.some((s) => s.kind === 'part' || s.kind === 'wire' || s.kind === 'power');

  // Highlight the current step on the canvas (tagged with our source so we only
  // ever clear our own caption, never one set by the agent or the checks panel).
  const highlightKey = step && hasContent ? `${step.id}|${step.title}|${step.highlight.join(',')}` : '';
  useEffect(() => {
    if (!step || !hasContent) {
      useUI.getState().clearHighlight(HIGHLIGHT_SOURCE);
      return;
    }
    useUI.getState().setHighlight(step.highlight, step.title, HIGHLIGHT_SOURCE);
  }, [highlightKey]); // eslint-disable-line
  useEffect(() => () => useUI.getState().clearHighlight(HIGHLIGHT_SOURCE), []);

  // Keep the active row visible.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const go = (i: number) => setCurrent(Math.max(0, Math.min(steps.length - 1, i)));
  const toggle = (id: string, value?: boolean) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (value ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  const next = () => {
    if (!step) return;
    toggle(step.id, true);
    if (index < steps.length - 1) go(index + 1);
  };

  const doneCount = steps.filter((s) => done.has(s.id)).length;
  const allDone = steps.length > 0 && doneCount === steps.length;
  const progress = steps.length ? (doneCount / steps.length) * 100 : 0;

  const header = titled ? (
    <header className="guide-head">
      <span className="guide-head-icon">
        <ListChecks size={15} />
      </span>
      <span className="guide-head-title">Guía de armado</span>
      {hasContent && (
        <span className="guide-count mono">
          {doneCount}/{steps.length}
        </span>
      )}
      {onClose && (
        <button className="btn ghost icon sm guide-close" onClick={onClose} aria-label="Cerrar guía" title="Cerrar guía">
          <X size={15} />
        </button>
      )}
    </header>
  ) : hasContent ? (
    <header className="guide-head guide-head--compact">
      <span className="guide-summary">
        <b className="mono">{doneCount}</b> de <span className="mono">{steps.length}</span> pasos hechos
      </span>
      {doneCount > 0 && (
        <button className="btn ghost sm guide-reset" onClick={() => setDone(new Set())} title="Desmarcar todos los pasos">
          <RotateCcw size={13} /> Reiniciar
        </button>
      )}
    </header>
  ) : null;

  if (!hasContent || !step) {
    return (
      <div className={clsx('guide', className)}>
        {header}
        <div className="guide-empty">
          <div className="guide-empty-art" aria-hidden>
            <Grid3x3 size={26} />
          </div>
          <p className="guide-empty-title">Aún no hay nada que armar</p>
          <p className="guide-empty-text">
            Agrega componentes y cables al circuito (o carga un ejemplo) y aquí verás, paso a paso, cómo armarlo en la vida real.
          </p>
        </div>
      </div>
    );
  }

  const meta = KIND_META[step.kind];
  const Icon = meta.icon;
  const wireColor: WireColor | undefined = step.kind === 'wire' || step.kind === 'power' ? wireColors.get(step.id.replace(/^wire-/, '')) : undefined;

  return (
    <div
      className={clsx('guide', className)}
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        if (e.key === 'ArrowRight') go(index + 1);
        else if (e.key === 'ArrowLeft') go(index - 1);
      }}
    >
      {header}
      <div className="guide-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
        <div className="guide-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <section className="guide-card" data-kind={step.kind} key={step.id}>
        <div className="guide-card-top">
          <span className="guide-kind" data-kind={step.kind}>
            <Icon size={14} />
          </span>
          <span className="guide-step-label">
            Paso <b className="mono">{step.index}</b> de <span className="mono">{steps.length}</span> · {meta.label}
          </span>
          {wireColor && <span className="guide-wire-swatch" style={{ background: `var(--wire-${wireColor})` }} title={`Cable ${WIRE_COLOR_ES[wireColor] ?? wireColor}`} />}
        </div>
        <h3 className="guide-card-title">{step.title}</h3>
        <p className="guide-card-detail">{renderDetail(step.detail)}</p>
        {step.tip && (
          <div className="guide-tip">
            <Lightbulb size={14} />
            <span>{step.tip}</span>
          </div>
        )}
        <div className="guide-card-actions">
          <button className="btn sm" onClick={() => go(index - 1)} disabled={index === 0}>
            <ChevronLeft size={14} /> Anterior
          </button>
          <label className="guide-done-toggle">
            <input type="checkbox" checked={done.has(step.id)} onChange={() => toggle(step.id)} />
            <span>Hecho</span>
          </label>
          <button className="btn primary sm" onClick={next} disabled={index === steps.length - 1 && done.has(step.id)}>
            {index === steps.length - 1 ? 'Terminar' : 'Siguiente'} <ChevronRight size={14} />
          </button>
        </div>
      </section>

      {allDone && (
        <div className="guide-finished">
          <PartyPopper size={16} />
          <span>¡Listo! Armaste todo el circuito.</span>
        </div>
      )}

      <ol className="guide-list" ref={listRef}>
        {steps.map((s, i) => {
          const isDone = done.has(s.id);
          const color = s.kind === 'wire' || s.kind === 'power' ? wireColors.get(s.id.replace(/^wire-/, '')) : undefined;
          return (
            <li key={s.id} className={clsx('guide-item', i === index && 'active', isDone && 'done')} data-active={i === index}>
              <button
                className="guide-check"
                onClick={() => toggle(s.id)}
                aria-label={isDone ? `Marcar paso ${s.index} como pendiente` : `Marcar paso ${s.index} como hecho`}
                aria-pressed={isDone}
              >
                {isDone && <Check size={11} strokeWidth={3} />}
              </button>
              <button className="guide-item-main" onClick={() => go(i)}>
                <span className="guide-item-index mono">{s.index}</span>
                {color && <span className="guide-item-dot" style={{ background: `var(--wire-${color})` }} />}
                <span className="guide-item-title">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
