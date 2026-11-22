import { useState } from 'react'
import { FUEL_LABEL_ES } from '../engine/types'
import type { FuelCode } from '../engine/types'
import type { LayerToggles } from './MapView'
import { FUEL_COLOURS, POPULATION_FULL_AT } from './overlays'
import { NARROW_QUERY } from './useMediaQuery'

const ITEMS: { key: keyof LayerToggles; label: string; swatch: string }[] = [
  { key: 'fuego', label: 'Fuego', swatch: 'fire' },
  { key: 'viviendas', label: 'Viviendas', swatch: 'bld' },
  { key: 'calles', label: 'Calles', swatch: 'road' },
  { key: 'zonasSeguras', label: 'Zonas seguras', swatch: 'safe' },
  { key: 'cortafuegos', label: 'Cortafuegos', swatch: 'fb' },
  { key: 'firms', label: 'NASA FIRMS', swatch: 'firms' },
  { key: 'cicatriz', label: 'Cicatriz 2024 (Sentinel-2)', swatch: 'scar' },
  { key: 'combustible', label: 'Combustible', swatch: 'fuel' },
  { key: 'poblacion', label: 'Personas a esta hora', swatch: 'pop' },
  { key: 'plan', label: 'Plan de preparación', swatch: 'plan' },
]

export function LayersCard({
  layers,
  setLayer,
  showRoutes,
  hide = [],
}: {
  layers: LayerToggles
  setLayer: (k: keyof LayerToggles, v: boolean) => void
  showRoutes: boolean
  /** Layers this timeline has no data for (e.g. FIRMS detections from today, population where the event has none). */
  hide?: readonly (keyof LayerToggles)[]
}) {
  // Open on wide screens; on phones the card would cover most of the map.
  const [open, setOpen] = useState(() => !window.matchMedia(NARROW_QUERY).matches)
  return (
    <div className={`layers-card${open ? ' open' : ''}`}>
      <button type="button" className="layers-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        Capas y leyenda
        <svg className="chev" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="layers-body">
          {ITEMS.filter((it) => !hide.includes(it.key)).map((it) => (
            <label key={it.key} className="layer-row">
              <input type="checkbox" checked={layers[it.key]} onChange={(e) => setLayer(it.key, e.target.checked)} />
              <span className={`swatch ${it.swatch}`} aria-hidden="true" />
              {it.label}
            </label>
          ))}
          <div className="legend">
            {layers.fuego && (
              <div className="legend-row">
                <span className="lg burning" /> Ardiendo (últimos 30 min) <span className="lg burned" /> Quemado
              </div>
            )}
            {layers.viviendas && (
              <div className="legend-row wrap">
                <span className="lg dot" style={{ background: '#8b93a1' }} /> Sin amenaza
                <span className="lg dot" style={{ background: '#4ade80' }} /> Sale a tiempo
                <span className="lg dot" style={{ background: '#fbbf24' }} /> En riesgo
                <span className="lg dot" style={{ background: '#ef4444' }} /> Salida cortada
                <span className="muted small">Resultado de todo el escenario, no de la hora mostrada.</span>
              </div>
            )}
            {layers.calles && (
              <div className="legend-row wrap">
                <span className="lg line" style={{ background: '#4a4f5c' }} /> Cortada por el fuego
                <span className="lg line dashed" /> Cerrada
                {showRoutes && (
                  <>
                    <span className="lg line routes" /> Ruta de evacuación (grosor: hogares)
                  </>
                )}
              </div>
            )}
            {layers.plan && !hide.includes('plan') && (
              <div className="legend-row wrap">
                <span className="lg plan-belt" /> Celdas de 1 km donde se trata la franja
                <span className="lg plan-sector" /> Sectores con programa de preparación
              </div>
            )}
            {layers.poblacion && (
              <div className="legend-row wrap">
                <span className="lg pop-ramp" /> 1 a {POPULATION_FULL_AT}+ personas por celda de 60 m (estimación)
              </div>
            )}
            {layers.combustible && (
              <div className="legend-row wrap">
                {([1, 2, 3, 4, 5, 6] as FuelCode[]).map((f) => (
                  <span key={f} className="fuel-item">
                    <span className="lg" style={{ background: `rgba(${FUEL_COLOURS[f].slice(0, 3).join(',')},0.9)` }} /> {FUEL_LABEL_ES[f]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
