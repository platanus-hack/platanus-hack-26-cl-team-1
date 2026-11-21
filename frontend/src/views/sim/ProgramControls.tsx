/** Left block of the sim dock: program status, clock, speed, live/mute toggles, reset/repair. */
import { Pause, Play, RotateCcw, Square, Volume2, VolumeX, Wrench, Zap, ZapOff } from 'lucide-react';
import { useSim } from '@/store/sim';
import { formatClock, setMuted, simRuntime, useMuted } from '@/sim/runtime';

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

const speedLabel = (s: number) => `${String(s).replace('.', ',')}×`;

export function StatusPill({ compact = false }: { compact?: boolean }) {
  const program = useSim((s) => s.program);
  const text = program === 'running' ? 'Ejecutando' : program === 'paused' ? 'Pausado' : 'Detenido';
  return (
    <span className={`simp-pill is-${program} ${compact ? 'is-compact' : ''}`} role="status" aria-label={`Programa: ${text}`}>
      <span className="simp-pill-dot" aria-hidden />
      {text}
    </span>
  );
}

export function SimClock({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  const timeMs = useSim((s) => s.timeMs);
  const program = useSim((s) => s.program);
  return (
    <span className={`simp-clock is-${size} is-${program}`} title="Tiempo simulado del programa (mm:ss.d)">
      {formatClock(timeMs)}
    </span>
  );
}

export function Switch({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`simp-switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)} title={title}>
      <span className="simp-switch-track" aria-hidden>
        <span className="simp-switch-knob" />
      </span>
      <span className="simp-switch-label">{label}</span>
    </button>
  );
}

export function ProgramControls() {
  const program = useSim((s) => s.program);
  const speed = useSim((s) => s.speed);
  const setSpeed = useSim((s) => s.setSpeed);
  const live = useSim((s) => s.live);
  const setLive = useSim((s) => s.setLive);
  const burnedCount = useSim((s) => s.burned.length);
  const repair = useSim((s) => s.repair);
  const muted = useMuted();

  return (
    <div className="simp-ctl">
      <div className="simp-ctl-status">
        <StatusPill />
        <div className="simp-ctl-transport">
          {program === 'running' ? (
            <button className="simp-iconbtn" onClick={() => simRuntime.pauseProgram()} title="Pausar programa" aria-label="Pausar programa">
              <Pause size={14} />
            </button>
          ) : (
            <button className="simp-iconbtn is-accent" onClick={() => simRuntime.startProgram()} title={program === 'paused' ? 'Continuar programa' : 'Ejecutar programa'} aria-label="Ejecutar programa">
              <Play size={14} />
            </button>
          )}
          <button className="simp-iconbtn" onClick={() => simRuntime.stopProgram()} disabled={program === 'stopped'} title="Detener programa" aria-label="Detener programa">
            <Square size={12} />
          </button>
        </div>
      </div>

      <div className="simp-ctl-clock">
        <SimClock />
        <span className="simp-ctl-caption">tiempo simulado</span>
      </div>

      <div className="simp-speed" role="radiogroup" aria-label="Velocidad de simulación">
        {SPEEDS.map((s) => (
          <button key={s} role="radio" aria-checked={speed === s} className={speed === s ? 'is-active' : ''} onClick={() => setSpeed(s)} title={`Velocidad ${speedLabel(s)}`}>
            {speedLabel(s)}
          </button>
        ))}
      </div>

      <div className="simp-ctl-row">
        <Switch
          checked={live}
          onChange={setLive}
          label="Corriente en vivo"
          title={live ? 'Desactivar el cálculo eléctrico en vivo' : 'Activar el cálculo eléctrico en vivo'}
        />
        <span className={`simp-live-icon ${live ? 'is-on' : ''}`} aria-hidden>
          {live ? <Zap size={13} /> : <ZapOff size={13} />}
        </span>
        <button
          className={`simp-iconbtn ${muted ? 'is-muted' : ''}`}
          onClick={() => setMuted(!muted)}
          title={muted ? 'Activar sonido del zumbador' : 'Silenciar zumbador'}
          aria-label={muted ? 'Activar sonido' : 'Silenciar'}
          aria-pressed={muted}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>

      <div className="simp-ctl-row">
        <button className="btn sm simp-btn" onClick={() => simRuntime.reset()} title="Detiene el programa, limpia el monitor serie y repara los componentes quemados">
          <RotateCcw size={13} /> Reiniciar
        </button>
        {burnedCount > 0 && (
          <button className="btn sm danger simp-btn" onClick={() => repair()} title={`Reemplaza ${burnedCount === 1 ? 'el componente quemado' : `los ${burnedCount} componentes quemados`} por ${burnedCount === 1 ? 'uno nuevo' : 'unos nuevos'}`}>
            <Wrench size={13} /> Reparar todo
          </button>
        )}
      </div>
    </div>
  );
}
