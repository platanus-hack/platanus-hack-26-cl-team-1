import { minToDateLabel, minToHHMM } from '../data/time'

/** Playback speeds in simulated minutes per real second. */
export const SPEEDS = [5, 15, 30, 60] as const

export function Timebar(props: {
  t0: string
  clock: number
  setClock: (t: number) => void
  playing: boolean
  setPlaying: (v: boolean) => void
  speed: number
  setSpeed: (v: number) => void
  terrain3d: boolean
  setTerrain3d: (v: boolean) => void
  terrainAvailable: boolean
  /** Evacuation alert time, marked on the scrubber. */
  alertMin: number
  /** End of the timeline (minutes since t0). */
  horizonMin: number
}) {
  const { t0, clock } = props
  return (
    <div className="timebar">
      <button
        type="button"
        className="play"
        aria-label={props.playing ? 'Pausar' : 'Reproducir'}
        onClick={() => props.setPlaying(!props.playing)}
      >
        {props.playing ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3.5" y="3" width="3" height="10" rx="0.5" />
            <rect x="9.5" y="3" width="3" height="10" rx="0.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 3l8 5-8 5z" />
          </svg>
        )}
      </button>
      <div className="clock">
        <div className="hhmm">{minToHHMM(t0, clock)}</div>
        <div className="date">{minToDateLabel(t0, clock)}</div>
      </div>
      <div className="scrub">
        <input
          type="range"
          min={0}
          max={props.horizonMin}
          step={1}
          value={clock}
          aria-label="Hora de la simulación"
          onChange={(e) => props.setClock(Number(e.target.value))}
        />
        {/* the thumb is 16 px wide, so the track spans 8 px .. width - 8 px */}
        <span
          className="alert-tick"
          style={{ left: `calc(8px + (100% - 16px) * ${props.alertMin / props.horizonMin})` }}
          title={`Alerta de evacuación: ${minToHHMM(t0, props.alertMin)}`}
        >
          <span>Alerta {minToHHMM(t0, props.alertMin)}</span>
        </span>
      </div>
      <select aria-label="Velocidad de reproducción" value={props.speed} onChange={(e) => props.setSpeed(Number(e.target.value))}>
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s} min/s
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`btn small${props.terrain3d ? ' active' : ''}`}
        aria-pressed={props.terrain3d}
        disabled={!props.terrainAvailable}
        title={props.terrainAvailable ? 'Relieve en 3D' : 'El 3D necesita conexión (AWS Terrain Tiles)'}
        onClick={() => props.setTerrain3d(!props.terrain3d)}
      >
        3D
      </button>
    </div>
  )
}
