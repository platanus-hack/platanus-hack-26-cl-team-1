/** Right block: supply currents, board pins in use and live controls. */
import { useMemo } from 'react';
import { Gauge, Zap } from 'lucide-react';
import type { Binding, BoardProfile, ProjectModel, SupplyState } from '@/contracts';
import { projectBoard } from '@/catalog';
import { formatCurrent, formatVolts } from '@/lib/format';
import { getBindings } from '@/store/derived';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { LiveControls } from './LiveControls';
import { buildPinRows, type PinRow } from './pinRows';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function SupplyRow({ s }: { s: SupplyState }) {
  const amps = Math.abs(s.currentA);
  const ratio = s.limitA && s.limitA > 0 ? Math.min(1, amps / s.limitA) : 0;
  const tone = s.overloaded || ratio >= 0.9 ? 'danger' : ratio >= 0.6 ? 'warn' : 'ok';
  const width = amps > 1e-5 ? Math.max(ratio * 100, 2) : 0;
  return (
    <div className={`simp-supply is-${tone}`} title={s.overloaded ? 'Sobrecarga: se pide más corriente de la que esta fuente puede entregar' : undefined}>
      <span className="simp-supply-label">
        <Zap size={11} aria-hidden /> {s.label}
      </span>
      <div className="simp-bar" role="meter" aria-label={`Corriente de ${s.label}`} aria-valuemin={0} aria-valuemax={s.limitA ?? 1} aria-valuenow={amps}>
        <span style={{ width: `${width}%` }} />
      </div>
      <span className="simp-num simp-supply-val">
        {formatCurrent(amps)}
        {s.limitA ? <span className="simp-dim"> / {formatCurrent(s.limitA)}</span> : null}
      </span>
    </div>
  );
}

function PinRowView({ r }: { r: PinRow }) {
  const current = r.currentA !== null && Math.abs(r.currentA) >= 1e-4 ? formatCurrent(r.currentA) : '—';
  return (
    <div className={`simp-pin is-${r.mode}`} role="row">
      <span className="simp-pin-id" role="cell" title={`Pin ${r.pin}`}>
        {r.label}
      </span>
      <span className="simp-pin-parts" role="cell" title={r.parts.join(', ')}>
        {r.parts.length ? r.parts.join(', ') : <span className="simp-dim">programa</span>}
      </span>
      <span className="simp-pin-mode" role="cell">
        {r.modeLabel}
      </span>
      <span className={`simp-pin-val ${r.level === 1 ? 'is-high' : r.level === 0 ? 'is-low' : ''}`} role="cell">
        <span className="simp-pin-dot" aria-hidden />
        {r.valueText}
      </span>
      <span className="simp-num simp-pin-v" role="cell">
        {r.volts !== null ? formatVolts(r.volts) : '—'}
      </span>
      <span className="simp-num simp-pin-a" role="cell" title="Corriente que entrega (+) o recibe (−) el pin">
        {current}
      </span>
    </div>
  );
}

function PinTable({ rows, board }: { rows: PinRow[]; board: BoardProfile | null }) {
  return (
    <div className="simp-group">
      <div className="simp-group-label">
        Pines {board && <span className="simp-dim">· {board.name}</span>}
      </div>
      {!board ? (
        <p className="simp-hint">Sin placa: agrega un Arduino Uno o un ESP32-C6 para ver sus pines.</p>
      ) : rows.length === 0 ? (
        <p className="simp-hint">Ningún pin en uso todavía. Conecta un componente a un pin o ejecuta un programa.</p>
      ) : (
        <div className="simp-pins" role="table" aria-label="Pines de la placa">
          <div className="simp-pin is-head" role="row">
            <span role="columnheader">Pin</span>
            <span role="columnheader" className="simp-pin-parts">Conectado a</span>
            <span role="columnheader">Modo</span>
            <span role="columnheader">Valor</span>
            <span role="columnheader" className="simp-pin-v">Voltaje</span>
            <span role="columnheader" className="simp-pin-a">Corriente</span>
          </div>
          {rows.map((r) => (
            <PinRowView key={r.pin} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Measurements() {
  const project: ProjectModel = useProject((s) => s.project);
  const result = useSim((s) => s.result);
  const drives = useSim((s) => s.drives);
  const live = useSim((s) => s.live);
  const setLive = useSim((s) => s.setLive);
  const fresh = result && result.project === project ? result : null;

  const board = useMemo(() => safe(() => projectBoard(project)?.profile ?? null, null), [project]);
  const bindings = useMemo<Binding[]>(() => safe(() => getBindings(project), []), [project]);
  const labels = useMemo(() => new Map(project.parts.map((p) => [p.id, p.label || p.id])), [project.parts]);
  const rows = useMemo(() => safe(() => buildPinRows(board, bindings, drives, fresh, labels), []), [board, bindings, drives, fresh, labels]);
  const supplies = fresh?.supplies ?? [];

  return (
    <section className="simp-meas" aria-label="Mediciones">
      <header className="simp-section-head">
        <Gauge size={13} />
        <span className="simp-section-title">Mediciones</span>
        {fresh && !fresh.converged && <span className="simp-tag is-warn">sin converger</span>}
      </header>
      <div className="simp-meas-scroll">
        {!live ? (
          <div className="simp-off">
            <span>La corriente en vivo está desactivada.</span>
            <button className="btn sm" onClick={() => setLive(true)}>
              <Zap size={12} /> Activar
            </button>
          </div>
        ) : (
          supplies.length > 0 && (
            <div className="simp-group">
              <div className="simp-group-label">Alimentación</div>
              {supplies.map((s) => (
                <SupplyRow key={s.id} s={s} />
              ))}
            </div>
          )
        )}
        <LiveControls parts={project.parts} />
        <PinTable rows={rows} board={board} />
      </div>
    </section>
  );
}
