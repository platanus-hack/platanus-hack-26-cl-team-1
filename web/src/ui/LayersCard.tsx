import { useState } from 'react'
import { FUEL_LABEL_ES } from '../engine/types'
import type { FuelCode } from '../engine/types'
import type { LayerToggles } from './MapView'
import { FUEL_COLOURS } from './overlays'

const ITEMS: { key: keyof LayerToggles; label: string; swatch: string }[] = [
  { key: 'fuego', label: 'Fuego', swatch: 'fire' },
  { key: 'viviendas', label: 'Viviendas', swatch: 'bld' },
  { key: 'calles', label: 'Calles', swatch: 'road' },
  { key: 'zonasSeguras', label: 'Zonas seguras', swatch: 'safe' },
  { key: 'cortafuegos', label: 'Cortafuegos', swatch: 'fb' },
  { key: 'firms', label: 'NASA FIRMS', swatch: 'firms' },
  { key: 'cicatriz', label: 'Cicatriz real (Sentinel-2)', swatch: 'scar' },
  { key: 'combustible', label: 'Combustible', swatch: 'fuel' },
]

export function LayersCard({
  layers,
  setLayer,
  showRoutes,
}: {
  layers: LayerToggles
  setLayer: (k: keyof LayerToggles, v: boolean) => void
  showRoutes: boolean
}) {
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 900px)').matches)
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
          {ITEMS.map((it) => (
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
