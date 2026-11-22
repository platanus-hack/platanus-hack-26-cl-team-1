import type { TimelineId } from '../engine/types'
import { TIMELINE } from '../engine/types'
import { TIMELINE_OPTIONS } from '../data/timeline'

/** Top bar: name, what is being simulated, the scenario picker and (once the data is ready) the sources. */
export function Topbar({
  subtitle,
  timeline,
  onTimeline,
  offline,
  onSources,
}: {
  subtitle: string
  timeline: TimelineId
  onTimeline: (t: TimelineId) => void
  /** ?offline=1: the today timeline needs the forecast service, so it is shown as unavailable. */
  offline: boolean
  onSources?: () => void
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <h1>Cortafuego</h1>
        <p>{subtitle}</p>
      </div>
      <div className="topbar-end">
        <div className="timeline-pick seg" role="radiogroup" aria-label="Escenario">
          {TIMELINE_OPTIONS.map((o) => {
            const off = offline && o.value === TIMELINE.TODAY
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={o.value === timeline}
                className={o.value === timeline ? 'on' : ''}
                disabled={off}
                title={off ? 'Necesita conexión a internet para descargar el pronóstico' : undefined}
                onClick={() => onTimeline(o.value)}
              >
                <span className="long">{o.label}</span>
                <span className="short">{o.short}</span>
              </button>
            )
          })}
        </div>
        {onSources && (
          <button type="button" className="btn ghost" onClick={onSources}>
            <span className="long">Fuentes y supuestos</span>
            <span className="short">Fuentes</span>
          </button>
        )}
      </div>
    </header>
  )
}
