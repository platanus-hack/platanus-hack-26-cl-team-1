/**
 * Bottom dock of the app: program status + controls, serial monitor and live
 * measurements. The header row stays visible when the dock is collapsed.
 */
import { useState } from 'react';
import { Activity, ChevronDown, ChevronUp, Flame, TriangleAlert, X } from 'lucide-react';
import { formatCurrent } from '@/lib/format';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { Measurements } from './Measurements';
import { ProgramControls, SimClock, StatusPill } from './ProgramControls';
import { SerialMonitor } from './SerialMonitor';
import './sim.css';

const COLLAPSED_KEY = 'circuito-vivo:simpanel:collapsed';

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Compact info shown in the header while collapsed. */
function CollapsedSummary() {
  const project = useProject((s) => s.project);
  const result = useSim((s) => s.result);
  const lastLine = useSim((s) => (s.serial.length ? s.serial[s.serial.length - 1].text : ''));
  const supply = result && result.project === project ? result.supplies[0] : undefined;
  return (
    <div className="simp-summary">
      {supply && (
        <span className={`simp-tag ${supply.overloaded ? 'is-danger' : ''}`} title={supply.label}>
          {supply.label} · {formatCurrent(Math.abs(supply.currentA))}
        </span>
      )}
      {lastLine && (
        <span className="simp-summary-serial" title={lastLine}>
          <span className="simp-dim">serie›</span> {lastLine}
        </span>
      )}
    </div>
  );
}

export function SimPanel() {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const error = useSim((s) => s.error);
  const burned = useSim((s) => s.burned.length);
  const live = useSim((s) => s.live);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
  };

  return (
    <div className={`simp ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="simp-head">
        <button className="simp-head-toggle" onClick={toggle} aria-expanded={!collapsed} title={collapsed ? 'Mostrar panel de simulación' : 'Ocultar panel de simulación'}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <Activity size={13} className={live ? 'simp-head-live' : ''} />
          <span className="simp-head-title">Simulación</span>
        </button>
        <StatusPill compact />
        <SimClock size="sm" />
        {burned > 0 && (
          <span className="simp-tag is-danger" title="Componentes quemados">
            <Flame size={11} /> {burned} {burned === 1 ? 'quemado' : 'quemados'}
          </span>
        )}
        {collapsed && <CollapsedSummary />}
        <span className="simp-spacer" />
        {error && (
          <div className="simp-error" role="alert" title={error}>
            <TriangleAlert size={13} />
            <span className="simp-error-text">{error}</span>
            <button className="simp-iconbtn is-xs" onClick={() => useSim.getState().patch({ error: null })} aria-label="Descartar error" title="Descartar">
              <X size={12} />
            </button>
          </div>
        )}
      </div>
      {!collapsed && (
        <div className="simp-body">
          <ProgramControls />
          <SerialMonitor />
          <Measurements />
        </div>
      )}
    </div>
  );
}
