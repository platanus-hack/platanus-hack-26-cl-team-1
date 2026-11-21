import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Cable,
  CircuitBoard,
  ListOrdered,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  RotateCw,
  ShieldCheck,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react';
import { GRID_PX } from '@/lib/geometry';
import { formatCurrent } from '@/lib/format';
import { useSim } from '@/store/sim';
import { useUI } from '@/store/ui';
import { useHW } from '../state';
import { deleteSelection, rotateSelection, setZoom, zoomBy } from '../actions';

function ToolButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
  className,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      className={`hw-tb-btn${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      data-tip={shortcut ? `${label} · ${shortcut}` : label}
    >
      {icon}
    </button>
  );
}

/** Top-left floating toolbar: tools, edit actions, current-flow toggle. */
export function CanvasToolbar() {
  const tool = useUI((s) => s.tool);
  const setTool = useUI((s) => s.setTool);
  const hasSel = useUI((s) => s.selection.parts.length + s.selection.wires.length > 0);
  const hasParts = useUI((s) => s.selection.parts.length > 0);
  const showFlow = useHW((s) => s.showFlow);
  return (
    <div className="hw-toolbar hw-toolbar--tl" onPointerDown={(e) => e.stopPropagation()}>
      <div className="hw-tb-group">
        <ToolButton
          icon={<MousePointer2 size={16} />}
          label="Seleccionar"
          shortcut="V"
          active={tool === 'select'}
          onClick={() => {
            setTool('select');
            useHW.getState().set({ draft: null });
          }}
        />
        <ToolButton icon={<Cable size={16} />} label="Cable" shortcut="W" active={tool === 'wire'} onClick={() => setTool(tool === 'wire' ? 'select' : 'wire')} />
      </div>
      <span className="hw-tb-sep" />
      <div className="hw-tb-group">
        <ToolButton icon={<RotateCw size={16} />} label="Rotar" shortcut="R" disabled={!hasParts} onClick={rotateSelection} />
        <ToolButton icon={<Trash2 size={16} />} label="Eliminar" shortcut="Supr" disabled={!hasSel} onClick={deleteSelection} className="is-danger" />
      </div>
      <span className="hw-tb-sep" />
      <button
        className={`hw-tb-flow${showFlow ? ' is-on' : ''}`}
        onClick={() => useHW.getState().set({ showFlow: !showFlow })}
        aria-pressed={showFlow}
        data-tip="Animar la corriente en los cables"
      >
        <Zap size={14} />
        <span className="hw-tb-flow-label">Flujo de corriente</span>
        <span className="hw-tb-switch" />
      </button>
    </div>
  );
}

/** Top-right floating cluster: Protoboard | Esquemático, checks and guide drawers. */
export function ModeToolbar() {
  const mode = useUI((s) => s.hardwareMode);
  const setMode = useUI((s) => s.setHardwareMode);
  const panels = useUI((s) => s.panels);
  const issues = useHW((s) => s.issues);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const open = (p: 'checks' | 'guide') => {
    const ui = useUI.getState();
    const next = !ui.panels[p];
    ui.togglePanel(p === 'checks' ? 'guide' : 'checks', false);
    ui.togglePanel(p, next);
  };
  return (
    <div className="hw-toolbar hw-toolbar--tr" onPointerDown={(e) => e.stopPropagation()}>
      <div className="hw-seg" role="tablist" aria-label="Vista del circuito">
        <button role="tab" aria-selected={mode === 'board'} className={mode === 'board' ? 'is-active' : ''} onClick={() => setMode('board')}>
          <CircuitBoard size={14} />
          <span>Protoboard</span>
        </button>
        <button role="tab" aria-selected={mode === 'schematic'} className={mode === 'schematic' ? 'is-active' : ''} onClick={() => setMode('schematic')}>
          <Workflow size={14} />
          <span>Esquemático</span>
        </button>
      </div>
      <span className="hw-tb-sep" />
      <button className={`hw-tb-pill${panels.checks ? ' is-active' : ''}`} onClick={() => open('checks')} data-tip="Revisión del circuito">
        <ShieldCheck size={15} />
        <span className="hw-tb-pill-label">Revisión</span>
        {errors > 0 && <span className="hw-count hw-count--error">{errors}</span>}
        {warnings > 0 && <span className="hw-count hw-count--warning">{warnings}</span>}
        {errors + warnings === 0 && <span className="hw-count hw-count--ok">✓</span>}
      </button>
      <button className={`hw-tb-pill${panels.guide ? ' is-active' : ''}`} onClick={() => open('guide')} data-tip="Guía de armado paso a paso">
        <ListOrdered size={15} />
        <span className="hw-tb-pill-label">Guía</span>
      </button>
    </div>
  );
}

/** Bottom-right zoom controls. */
export function ZoomControls() {
  const scale = useHW((s) => s.vp.scale);
  const pct = Math.round((scale / GRID_PX) * 100);
  return (
    <div className="hw-toolbar hw-toolbar--br" onPointerDown={(e) => e.stopPropagation()}>
      <ToolButton icon={<Minus size={15} />} label="Alejar" shortcut="−" onClick={() => zoomBy(1 / 1.25)} />
      <button className="hw-zoom-pct" onClick={() => setZoom(GRID_PX)} data-tip="Zoom 100 %">
        {pct}%
      </button>
      <ToolButton icon={<Plus size={15} />} label="Acercar" shortcut="+" onClick={() => zoomBy(1.25)} />
      <span className="hw-tb-sep" />
      <ToolButton icon={<Maximize size={15} />} label="Ajustar a la vista" shortcut="0" onClick={() => useHW.getState().requestFit()} />
    </div>
  );
}

/** Bottom-left status: live simulation + supply draw. */
export function LiveStatus() {
  const live = useSim((s) => s.live);
  const supply = useSim(
    useShallow((s) => {
    const sup = s.result?.supplies ?? [];
    let a = 0;
    let over = false;
    for (const x of sup) {
      a += Math.abs(x.currentA);
      over ||= x.overloaded;
    }
      return { a: Math.round(a * 1e5) / 1e5, over, n: sup.length };
    }),
  );
  const shorts = useSim((s) => s.result?.shorts.length ?? 0);
  return (
    <div className={`hw-status${shorts ? ' is-short' : ''}`}>
      <span className={`hw-status-dot${live ? ' is-live' : ''}`} />
      <span>{live ? 'Simulación en vivo' : 'Simulación detenida'}</span>
      {live && supply.n > 0 && (
        <>
          <span className="hw-status-sep" />
          <Zap size={12} />
          <span className="hw-status-val">{formatCurrent(supply.a)}</span>
        </>
      )}
      {shorts > 0 && (
        <>
          <span className="hw-status-sep" />
          <span className="hw-status-alert">¡Cortocircuito!</span>
        </>
      )}
    </div>
  );
}
