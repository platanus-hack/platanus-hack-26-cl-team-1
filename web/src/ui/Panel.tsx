import type { Dataset } from '../data/load'
import VALIDATION from '../../public/data/validation.json'
import EATON_VALIDATION from '../../public/data/eaton-2025/validation.json'
import type { EventId } from '../data/events'
import type { PopulationDay, PresenceParams, WeatherSeries } from '../engine/types'
import { POPULATION_DAY, TIMELINE } from '../engine/types'
import { dayKind, type BurnedAreaPeople } from '../engine/population'
import { LAG_CAP_MIN } from '../engine/fire/pacing'
import { isTodayTimeline } from '../data/timeline'
import { minToDateLabel, minToEndLabel, minToHHMM, localToMin, wallClockMin } from '../data/time'
import type { BrigadesOut, EvacOut, FireOut } from '../worker/protocol'
import type { EdgeContact } from '../engine/fire/edge'
import { edgeStatNote } from './edgeNote'
import { BrigadesSection } from './BrigadesSection'
import { PlanSection } from './PlanSection'
import { FirebreakEmberRange, type EmberRangeState } from './FirebreakEmberRange'
import type { FirebreakWidth, Scenario, WeatherSettings } from '../worker/scenario'
import { FIREBREAK_WIDTHS, sampleAt } from '../worker/scenario'
import { Compass, compassLabel, fmtInt, fmtSigned, Section, Segmented, Slider, Toggle } from './controls'
import { RiskChart, WeatherChart } from './charts'
import type { LayerToggles, Tool } from './MapView'

export interface Summary {
  burnedHaEnd: number
  buildingsReached: number
  trappedHouseholds: number
  trappedPeople: number
  /** People present where the fire arrives, at the time it arrives (src/engine/population). */
  /** null when the event has no population layer (EventDef.layers.population). */
  peopleReached: number | null
}

export interface Timings {
  /** Last fire run time (ms); fireRerun says whether this run recomputed the fire. */
  fireMs: number | null
  fireRerun: boolean
  evacMs: number
  roundTripMs: number
}

interface Props {
  data: Dataset
  scenario: Scenario
  update: (patch: Partial<Scenario>) => void
  /** Back to the default scenario (real weather, preset ignitions, no edits). */
  resetScenario: () => void
  updateWeather: (patch: Partial<WeatherSettings>) => void
  clock: number
  tool: Tool
  setTool: (t: Tool) => void
  fire: FireOut | null
  evac: EvacOut | null
  brigadesOut: BrigadesOut | null
  /** Where and when the fire reaches the edge of the simulated area (null before the first result). */
  edge: EdgeContact | null
  burnedHaNow: number
  summary: Summary | null
  baseline: Summary | null
  setBaseline: (s: Summary | null) => void
  /** Drawn firebreaks under several ember distances (worker/emberRange.ts). */
  emberRange: EmberRangeState | null
  timings: Timings | null
  busy: boolean
  simError: string | null
  rawSeries: WeatherSeries
  appliedSeries: WeatherSeries
  weatherNotes: string[]
  firebreakWidth: FirebreakWidth
  setFirebreakWidth: (w: FirebreakWidth) => void
  layers: LayerToggles
  setLayer: (k: keyof LayerToggles, v: boolean) => void
  showRoutes: boolean
  setShowRoutes: (v: boolean) => void
  linkStart: number | null
  firmsShown: number
  people: BurnedAreaPeople | null
  /** Share of residents at work or school at the clock's time (0..1). */
  awayNow: number
  populationDay: PopulationDay
  setPopulationDay: (d: PopulationDay) => void
}

const POPULATION_DAY_OPTIONS: { value: PopulationDay; label: string }[] = [
  { value: POPULATION_DAY.REAL, label: 'Fecha del escenario' },
  { value: POPULATION_DAY.WEEKDAY_SCHOOL, label: 'Hábil con clases' },
  { value: POPULATION_DAY.WEEKDAY_NO_SCHOOL, label: 'Hábil sin clases' },
  { value: POPULATION_DAY.WEEKEND, label: 'Fin de semana' },
]

const pct = (x: number) => `${Math.round(x * 100)} %`

const DOW_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** How the presence model's own calendar treats the scenario's date, e.g. "El modelo trata el viernes 2 feb 2024
 *  como día hábil sin clases (...)". It is the model's assumption: holidays are not modelled. */
function scenarioDayText(t0: string, params: PresenceParams): string {
  const k = dayKind(wallClockMin(t0), params)
  const what = !k.weekday ? 'fin de semana, con todos en casa' : k.school ? 'día hábil con clases' : 'día hábil sin clases'
  return `El modelo trata el ${DOW_ES[k.dow]} ${minToDateLabel(t0, 0)} como ${what} (calendario escolar aproximado, sin feriados).`
}

function ToolButton({ tool, current, setTool, label }: { tool: Tool; current: Tool; setTool: (t: Tool) => void; label: string }) {
  const on = current === tool
  return (
    <button type="button" className={`btn tool${on ? ' active' : ''}`} onClick={() => setTool(on ? 'none' : tool)}>
      {on ? 'Cancelar (Esc)' : label}
    </button>
  )
}

function polylineKm(points: [number, number][]): number {
  let m = 0
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const kx = 111320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
    m += Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 111320)
  }
  return m / 1000
}

function Delta({ now, base, digits = 0, unit = '' }: { now: number; base: number; digits?: number; unit?: string }) {
  const d = now - base
  const r = Number(d.toFixed(digits))
  const cls = r === 0 ? 'zero' : r > 0 ? 'up' : 'down'
  return (
    <span className={`delta ${cls}`}>
      {r === 0 ? 'sin cambio' : `${fmtSigned(r, digits)}${unit}`}
    </span>
  )
}

export function Results(p: Props) {
  const t0 = p.data.grid.t0
  const s = p.summary
  const b = p.baseline
  const edgeLine = p.edge ? edgeStatNote(p.edge, t0) : null
  return (
    <div className="results">
      <div className="results-head">
        <h2>Resultados</h2>
        <span className={`status${p.busy ? ' busy' : ''}`}>
          {p.busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Simulando…
            </>
          ) : p.timings ? (
            <span title={p.timings.fireRerun ? 'Se recalcularon el fuego y la evacuación' : 'El fuego no cambió: solo se recalculó la evacuación'}>
              {p.timings.fireRerun && p.timings.fireMs !== null
                ? `fuego ${fmtInt(p.timings.fireMs)} ms · evacuación ${fmtInt(p.timings.evacMs)} ms`
                : `solo evacuación: ${fmtInt(p.timings.evacMs)} ms`}
            </span>
          ) : (
            '—'
          )}
        </span>
      </div>
      {p.simError && <div className="alert error">Error de simulación: {p.simError}</div>}
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Superficie quemada a las {minToHHMM(t0, p.clock)}</div>
          <div className="stat-value">
            {s ? fmtInt(p.burnedHaNow) : '—'}
            <small> ha</small>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Al final ({minToEndLabel(t0, p.data.horizonMin)})</div>
          <div className="stat-value">
            {s ? fmtInt(s.burnedHaEnd) : '—'}
            <small> ha</small>
          </div>
          {s && edgeLine && <div className="stat-sub">{edgeLine}</div>}
          {s && b && <Delta now={s.burnedHaEnd} base={b.burnedHaEnd} unit=" ha" />}
        </div>
        <div className="stat">
          <div className="stat-label">Edificaciones alcanzadas por el fuego</div>
          <div className="stat-value">{s ? fmtInt(s.buildingsReached) : '—'}</div>
          {s && b && <Delta now={s.buildingsReached} base={b.buildingsReached} />}
        </div>
        <div className="stat strong">
          <div className="stat-label">Hogares con la salida cortada</div>
          <div className="stat-value">{s ? fmtInt(s.trappedHouseholds) : '—'}</div>
          {s && <div className="stat-sub">≈ {fmtInt(s.trappedPeople)} personas</div>}
          {s && b && <Delta now={s.trappedHouseholds} base={b.trappedHouseholds} />}
        </div>
        <div className="stat wide">
          <div className="stat-label">Personas donde llega el fuego, a la hora en que llega</div>
          <div className="stat-value">{s && s.peopleReached !== null ? fmtInt(s.peopleReached) : '—'}</div>
          {!p.data.population && <div className="stat-sub">Aún no hay capa de población para este incendio.</div>}
          {s && p.people && (
            <div className="stat-sub">
              {fmtInt(p.people.residents)} viven ahí (de noche o un fin de semana). A las {minToHHMM(t0, p.clock)}, {pct(p.awayNow)} de la
              población está en su trabajo o estudio.
            </div>
          )}
          {s && b && s.peopleReached !== null && b.peopleReached !== null && <Delta now={s.peopleReached} base={b.peopleReached} />}
        </div>
      </div>
      <div className="muted small">
        {p.scenario.brigades.enabled
          ? 'Con bomberos simulados (sección Bomberos, con sus supuestos): las cifras absolutas siguen siendo un techo de exposición, no daños ni víctimas. Lo confiable es comparar escenarios.'
          : 'Sin bomberos ni rescate: las cifras absolutas son un techo de exposición, no daños ni víctimas. Lo confiable es comparar escenarios.'}
      </div>
      <div className="base-row">
        <button type="button" className="btn small" disabled={!s || p.busy || p.simError !== null} onClick={() => s && p.setBaseline(s)}>
          Fijar como escenario base
        </button>
        {b && (
          <button type="button" className="btn small ghost" onClick={() => p.setBaseline(null)}>
            Quitar base
          </button>
        )}
        {!b && <span className="muted small">Sin escenario base</span>}
        <button
          type="button"
          className="btn small ghost push-right"
          onClick={p.resetScenario}
          title="Vuelve al clima del escenario, los focos predefinidos y sin cambios"
        >
          Restablecer
        </button>
      </div>
    </div>
  )
}

function RiskBlock(p: Props) {
  const t0 = p.data.grid.t0
  if (!p.evac) return null
  return (
    <div className="risk">
      <div className="chart-title">
        Hogares con la salida cortada según la hora de la alerta <span className="muted">(línea: alerta a las {minToHHMM(t0, p.scenario.alertMin)})</span>
      </div>
      <RiskChart curve={p.evac.riskByAlert} alertMin={p.scenario.alertMin} t0={t0} horizonMin={p.data.horizonMin} onPick={(alertMin) => p.update({ alertMin })} />
      <div className="muted small">
        <span className="fine-only">Haz clic</span>
        <span className="coarse-only">Toca</span> en el gráfico para probar otra hora de alerta.
      </div>
    </div>
  )
}

function ClimaSection(p: Props) {
  const w = p.scenario.weather
  const t0 = p.data.grid.t0
  const real = w.mode === 'real'
  const today = isTodayTimeline(p.data.timeline)
  const raw = sampleAt(p.rawSeries, p.clock)
  const used = sampleAt(p.appliedSeries, p.clock)
  const hhmm = minToHHMM(t0, p.clock)
  const corr = p.data.windDirCorrectionDeg
  const hint = (rawV: string, usedV: string) => (
    <>
      {today ? 'Pronóstico' : 'Real'} a las {hhmm}: <b>{rawV}</b> → usado: <b>{usedV}</b>
    </>
  )
  return (
    <Section title="Clima">
      <Segmented
        label="Modo de clima"
        value={w.mode}
        onChange={(mode) => p.updateWeather({ mode })}
        options={[
          { value: 'real', label: today ? `Pronóstico del ${minToDateLabel(t0, 0)} (Open-Meteo)` : `Clima real del ${minToDateLabel(t0, 0)} (ERA5)` },
          { value: 'constante', label: 'Clima constante' },
        ]}
      />
      {real ? (
        <>
          <Slider
            label="Viento (factor)"
            value={w.windFactor}
            min={0}
            max={2}
            step={0.05}
            display={`× ${w.windFactor.toFixed(2)}`}
            onChange={(v) => p.updateWeather({ windFactor: v })}
            hint={hint(`${raw.windKmh.toFixed(0)} km/h`, `${used.windKmh.toFixed(0)} km/h`)}
          />
          <Slider
            label="Dirección del viento (giro)"
            value={w.windDirOffsetDeg}
            min={-180}
            max={180}
            step={5}
            display={`${fmtSigned(w.windDirOffsetDeg)}°`}
            onChange={(v) => p.updateWeather({ windDirOffsetDeg: v })}
            extra={<Compass fromDeg={used.windFromDeg} />}
            hint={hint(
              corr !== 0
                ? `${compassLabel(raw.windFromDeg)} (${raw.windFromDeg.toFixed(0)}°, ERA5 con corrección calibrada de ${fmtSigned(corr)}°)`
                : `${compassLabel(raw.windFromDeg)} (${raw.windFromDeg.toFixed(0)}°, sin corrección)`,
              `${compassLabel(used.windFromDeg)} (${used.windFromDeg.toFixed(0)}°)`,
            )}
          />
          <Slider
            label="Humedad relativa (ajuste, pts)"
            value={w.rhOffset}
            min={-40}
            max={40}
            step={1}
            display={`${fmtSigned(w.rhOffset)} pts`}
            onChange={(v) => p.updateWeather({ rhOffset: v })}
            hint={hint(`${raw.rh.toFixed(0)} %`, `${used.rh.toFixed(0)} %`)}
          />
          <Slider
            label="Temperatura (ajuste, °C)"
            value={w.tempOffsetC}
            min={-10}
            max={10}
            step={0.5}
            display={`${fmtSigned(w.tempOffsetC, 1)} °C`}
            onChange={(v) => p.updateWeather({ tempOffsetC: v })}
            hint={hint(`${raw.tempC.toFixed(1)} °C`, `${used.tempC.toFixed(1)} °C`)}
          />
        </>
      ) : (
        <>
          <Slider label="Viento (km/h)" value={w.windKmh} min={0} max={100} step={1} display={`${w.windKmh} km/h`} onChange={(v) => p.updateWeather({ windKmh: v })} />
          <Slider
            label="Dirección del viento (desde)"
            value={w.windFromDeg}
            min={0}
            max={355}
            step={5}
            display={`${compassLabel(w.windFromDeg)} · ${w.windFromDeg}°`}
            onChange={(v) => p.updateWeather({ windFromDeg: v })}
            extra={<Compass fromDeg={w.windFromDeg} />}
          />
          <Slider label="Humedad relativa (%)" value={w.rh} min={1} max={100} step={1} display={`${w.rh} %`} onChange={(v) => p.updateWeather({ rh: v })} />
          <Slider label="Temperatura (°C)" value={w.tempC} min={0} max={45} step={0.5} display={`${w.tempC.toFixed(1)} °C`} onChange={(v) => p.updateWeather({ tempC: v })} />
        </>
      )}
      <Slider
        label="Factor de sequía"
        value={p.scenario.droughtFactor}
        min={0}
        max={10}
        step={0.5}
        display={p.scenario.droughtFactor.toFixed(1)}
        onChange={(v) => p.update({ droughtFactor: v })}
        hint={
          today
            ? '0 = combustible húmedo, 10 = vegetación seca de fin de verano (índice de McArthur). Parte en 10, como en febrero de 2024: ajústalo a la temporada.'
            : '0 = combustible húmedo, 10 = vegetación seca de fin de verano (índice de McArthur).'
        }
      />
      {p.weatherNotes.map((n) => (
        <div key={n} className="alert warn">
          {n}
        </div>
      ))}
      <div className="chart-title">
        <span className="key wind" /> Viento (km/h) <span className="key rh" /> Humedad (%) <span className="muted">usados por el modelo</span>
      </div>
      <WeatherChart series={p.appliedSeries} t0={t0} clock={p.clock} horizonMin={p.data.horizonMin} />
      <div className="muted small">Fuente: {p.data.weather.source}</div>
    </Section>
  )
}

function FuegoSection(p: Props) {
  const t0 = p.data.grid.t0
  const s = p.scenario
  const on = new Set(s.presetIgnitions)
  return (
    <Section title="Fuego">
      <div className="sub-title">Igniciones</div>
      <ul className="list">
        {p.data.ignitions.map((g) => (
          <li key={g.id}>
            <Toggle
              label={g.label}
              sub={`${minToHHMM(t0, localToMin(t0, g.timeLocal))} · ${g.source}`}
              title={g.source}
              checked={on.has(g.id)}
              onChange={(v) => p.update({ presetIgnitions: v ? [...s.presetIgnitions, g.id] : s.presetIgnitions.filter((x) => x !== g.id) })}
            />
          </li>
        ))}
        {s.userIgnitions.map((u, i) => (
          <li key={u.id} className="row">
            <span className="dot user" aria-hidden="true" />
            <span className="grow">
              Ignición agregada {i + 1} <span className="muted">· {minToHHMM(t0, u.tMin)}</span>
            </span>
            <button type="button" className="btn small ghost" onClick={() => p.update({ userIgnitions: s.userIgnitions.filter((x) => x.id !== u.id) })}>
              Quitar
            </button>
          </li>
        ))}
      </ul>
      {p.data.ignitions.length === 0 && s.userIgnitions.length === 0 && (
        <p className="muted small">Sin focos: ajusta el reloj y agrega uno en el mapa.</p>
      )}
      <div className="row">
        <ToolButton tool="ignition" current={p.tool} setTool={p.setTool} label={`Agregar ignición (${minToHHMM(t0, p.clock)})`} />
        {s.userIgnitions.length > 1 && (
          <button type="button" className="btn small ghost" onClick={() => p.update({ userIgnitions: [] })}>
            Quitar todas
          </button>
        )}
      </div>
      <p className="muted small">Toca un foco en el mapa para quitarlo.</p>
      <div className="sep" />
      <Toggle label="Pavesas (focos secundarios)" checked={s.spotting} onChange={(v) => p.update({ spotting: v })} sub="Brasas que el viento lleva por delante del frente" />
      <Slider
        label="Distancia máxima de pavesas"
        value={s.spotMetresPerKmh}
        min={0}
        max={40}
        step={1}
        disabled={!s.spotting}
        display={`${s.spotMetresPerKmh} m por km/h`}
        onChange={(v) => p.update({ spotMetresPerKmh: v })}
      />
    </Section>
  )
}

function CortafuegosSection(p: Props) {
  const s = p.scenario
  const widthOpts = FIREBREAK_WIDTHS.map((w) => ({ value: w, label: `${w} m` }))
  return (
    <Section title="Cortafuegos">
      <ToolButton tool="firebreak" current={p.tool} setTool={p.setTool} label="Dibujar cortafuego" />
      <div className="field">
        <div className="field-head">
          <label>Ancho del próximo cortafuego</label>
        </div>
        <Segmented label="Ancho del próximo cortafuego" value={p.firebreakWidth} onChange={p.setFirebreakWidth} options={widthOpts} />
      </div>
      {s.firebreaks.length === 0 ? (
        <p className="muted small">
          Sin cortafuegos. Dibuja una línea sobre el mapa: la vegetación bajo ella se elimina desde el inicio de la simulación. En la grilla de{' '}
          {p.data.grid.cellM} m, los anchos menores que una celda ocupan una celda.
        </p>
      ) : (
        <ul className="list">
          {s.firebreaks.map((f, i) => (
            <li key={f.id} className="row">
              <span className="swatch fb" aria-hidden="true" />
              <span className="grow">
                Cortafuego {i + 1} <span className="muted">· {polylineKm(f.points).toFixed(2)} km</span>
              </span>
              <select
                aria-label={`Ancho del cortafuego ${i + 1}`}
                value={f.widthM}
                onChange={(e) =>
                  p.update({ firebreaks: s.firebreaks.map((x) => (x.id === f.id ? { ...x, widthM: Number(e.target.value) as FirebreakWidth } : x)) })
                }
              >
                {FIREBREAK_WIDTHS.map((w) => (
                  <option key={w} value={w}>
                    {w} m
                  </option>
                ))}
              </select>
              <button type="button" className="btn small ghost" onClick={() => p.update({ firebreaks: s.firebreaks.filter((x) => x.id !== f.id) })}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      {s.firebreaks.length > 0 && (
        <>
          <button type="button" className="btn small ghost" onClick={() => p.update({ firebreaks: [] })}>
            Borrar todos
          </button>
          <FirebreakEmberRange range={p.emberRange} cellM={p.data.grid.cellM} own={s.spotting ? s.spotMetresPerKmh : null} />
        </>
      )}
    </Section>
  )
}

function EvacuacionSection(p: Props) {
  const s = p.scenario
  const t0 = p.data.grid.t0
  return (
    <Section title="Evacuación">
      <Slider
        label="Hora de la alerta"
        value={s.alertMin}
        min={0}
        max={p.data.horizonMin}
        step={5}
        display={minToHHMM(t0, s.alertMin)}
        onChange={(v) => p.update({ alertMin: v })}
        hint="Momento en que la alerta llega a todos los hogares del área."
      />
      <Slider
        label="Tiempo de preparación (mediana, min)"
        value={s.prepMedianMin}
        min={1}
        max={60}
        step={1}
        display={`${s.prepMedianMin} min`}
        onChange={(v) => p.update({ prepMedianMin: v })}
      />
      <Slider
        label="% que evacúa a pie"
        value={Math.round(s.footShare * 100)}
        min={0}
        max={100}
        step={5}
        display={`${Math.round(s.footShare * 100)} %`}
        onChange={(v) => p.update({ footShare: v / 100 })}
      />
      <div className="sub-title">Evacuación espontánea</div>
      <Slider
        label="Responden al ver el fuego (%)"
        value={Math.round(s.cueShare * 100)}
        min={0}
        max={100}
        step={5}
        display={`${Math.round(s.cueShare * 100)} %`}
        onChange={(v) => p.update({ cueShare: v / 100 })}
        hint="Hogares que salen al ver llamas, brasas o a sus vecinos evacuar, sin esperar la alerta. El resto espera la alerta. 0 % = solo la alerta."
      />
      <Slider
        label="Distancia a la que se ve el fuego (m)"
        value={s.cueRadiusM}
        min={0}
        max={3000}
        step={100}
        display={s.cueRadiusM === 0 ? 'desactivada' : `${s.cueRadiusM.toLocaleString('es-CL')} m`}
        onChange={(v) => p.update({ cueRadiusM: v })}
        disabled={s.cueShare === 0}
        hint="Esos hogares empiezan a prepararse cuando el fuego llega a esta distancia de su casa, si es antes de la alerta."
      />
      <div className="sub-title">Calles</div>
      <div className="tools">
        <ToolButton tool="closeRoad" current={p.tool} setTool={p.setTool} label="Cerrar calle" />
        <ToolButton tool="link" current={p.tool} setTool={p.setTool} label="Abrir salida de emergencia" />
      </div>
      <div className="row small">
        <span className="grow muted">
          {s.closedEdges.length} {s.closedEdges.length === 1 ? 'calle cerrada' : 'calles cerradas'} · {s.addedLinks.length}{' '}
          {s.addedLinks.length === 1 ? 'salida de emergencia' : 'salidas de emergencia'}
        </span>
        {(s.closedEdges.length > 0 || s.addedLinks.length > 0) && (
          <button type="button" className="btn small ghost" onClick={() => p.update({ closedEdges: [], addedLinks: [] })}>
            Deshacer cambios en calles
          </button>
        )}
      </div>
      <Toggle label="Mostrar rutas de evacuación" checked={p.showRoutes} onChange={p.setShowRoutes} sub="Grosor según hogares que pasan por cada calle" />
      <div className="sub-title">Dónde está la gente</div>
      {p.data.population ? <PopulationControls {...p} /> : (
        <div className="muted small">Aún no hay capa de población por hora para este incendio. La evacuación usa los hogares de las edificaciones, como en Viña del Mar.</div>
      )}
    </Section>
  )
}

function PopulationControls(p: Props) {
  const presence = p.data.event.presence.params
  return (
    <>
      <Segmented label="Día que se supone para la población" options={POPULATION_DAY_OPTIONS} value={p.populationDay} onChange={p.setPopulationDay} />
      <div className="muted small">
        De noche y los fines de semana todos en casa; un día hábil, quienes trabajan fuera de casa ({pct(presence.workerShare)}) y estudian ({pct(presence.studentShare)},
        solo en periodo de clases) pasan el día en su trabajo o estudio. {scenarioDayText(p.data.grid.t0, presence)} Cambia el conteo de personas donde llega
        el fuego, no la evacuación de los hogares.
      </div>
      <Toggle label="Mostrar personas a esta hora" checked={p.layers.poblacion} onChange={(v) => p.setLayer('poblacion', v)} sub="Personas por celda de 60 m a la hora del reloj" />
    </>
  )
}

/** Short Spanish name of each preset fire, by ignitions.json id (validation.json keys the pace results by id). */
const FIRE_ES: Record<string, string> = { 'las-tablas-penuelas': 'oeste', 'quilpue-villa-alemana-oriente': 'este' }
/** Front lag for the panel: signed minutes; at the cap (LAG_CAP_MIN) the model is at least that far off. */
const fmtLag = (m: number) =>
  Math.abs(m) >= LAG_CAP_MIN ? `${m > 0 ? '+' : '−'}${LAG_CAP_MIN / 60} h o más` : `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} min`

function ValidacionSection(p: Props) {
  return (
    <Section title="Validación" defaultOpen={false}>
      <Toggle label="Cicatriz real (Sentinel-2)" checked={p.layers.cicatriz} onChange={(v) => p.setLayer('cicatriz', v)} sub="Área quemada observada por satélite" />
      <Toggle
        label="Detecciones NASA FIRMS"
        checked={p.layers.firms}
        onChange={(v) => p.setLayer('firms', v)}
        sub={`${p.firmsShown} de ${p.data.firms.length} detecciones hasta la hora actual`}
      />
      {p.data.event.id === TIMELINE.VINA_2024 ? <VinaValidation /> : <OutOfSampleValidation event={p.data.event.id} t0={p.data.grid.t0} />}
    </Section>
  )
}

/** Out-of-sample results per event (src/engine/fire/validate-event.ts writes them). */
const OUT_OF_SAMPLE: Partial<Record<EventId, typeof EATON_VALIDATION>> = { [TIMELINE.EATON_2025]: EATON_VALIDATION }

function OutOfSampleValidation({ event, t0 }: { event: EventId; t0: string }) {
  const v = OUT_OF_SAMPLE[event]
  if (!v) return <p className="small">Sin validación para este incendio (falta correr validate-event.ts).</p>
  const when = (iso: string) => `${iso.slice(11, 16)} del ${minToDateLabel(t0, localToMin(t0, iso))}`
  const alt = v.vinaWindCorrection
  return (
    <>
      <p className="small">
        <strong>Prueba fuera de muestra:</strong> el modelo de fuego es el calibrado solo con el incendio de Viña del Mar 2024, sin ningún ajuste para
        este incendio. Clima real (ERA5) {v.windDirCorrectionDeg === 0 ? 'sin corrección de dirección' : `con corrección de ${fmtSigned(v.windDirCorrectionDeg)}°`},
        focos predefinidos, sin combate del fuego.
      </p>
      {v.own.at.map((a) => (
        <p key={a.timeLocal} className="small">
          A las {when(a.timeLocal)}: coincidencia con la cicatriz Sentinel-2 (Dice) <strong>{pct(a.scar.dice)}</strong>; el modelo quema{' '}
          {a.scar.modelHa.toLocaleString('es-CL')} ha y Sentinel-2 midió {a.scar.observedHa.toLocaleString('es-CL')} ha
          {a.perimeter && <>; con el perímetro oficial, Dice {pct(a.perimeter.dice)} ({a.perimeter.observedHa.toLocaleString('es-CL')} ha)</>}. Edificaciones
          dentro de la cicatriz alcanzadas: {a.buildings.inScar.toLocaleString('es-CL')} de {a.buildings.scarTotal.toLocaleString('es-CL')} ({pct(a.buildings.recall)}).
          Detecciones NASA FIRMS alcanzadas: {a.firms.reached} de {a.firms.total}.
        </p>
      ))}
      {alt && (
        <p className="small muted">
          Con la corrección de viento ajustada en Viña ({fmtSigned(alt.windDirCorrectionDeg)}°), a las {when(alt.at[alt.at.length - 1].timeLocal)}: Dice{' '}
          {pct(alt.at[alt.at.length - 1].scar.dice)} con la cicatriz.
        </p>
      )}
    </>
  )
}

function VinaValidation() {
  return (
    <>
      <p className="small">
        Coincidencia con la cicatriz real (Dice, a las {VALIDATION.evalTime.slice(11)} del 3 feb):{' '}
        <strong>{Math.round(VALIDATION.dice * 100)}%</strong>. El modelo quema {VALIDATION.modelHa.toLocaleString('es-CL')} ha;
        Sentinel-2 midió {VALIDATION.scarHa.toLocaleString('es-CL')} ha (el modelo no incluye el combate del fuego).
      </p>
      <p className="small">
        Detecciones satelitales del 2 feb que el fuego simulado ya alcanzó a esa hora:{' '}
        <strong>
          {VALIDATION.firmsReached.reached} de {VALIDATION.firmsReached.total}
        </strong>
        .
      </p>
      <p className="small">
        Edificaciones: el fuego simulado alcanza <strong>{VALIDATION.buildings.inScar.toLocaleString('es-CL')}</strong> de las{' '}
        {VALIDATION.buildings.scarTotal.toLocaleString('es-CL')} que están dentro de la cicatriz real ({Math.round(VALIDATION.buildings.recall * 100)}%). De todas
        las que alcanza ({VALIDATION.buildings.reached.toLocaleString('es-CL')}), {Math.round(VALIDATION.buildings.precision * 100)}% están dentro de la cicatriz y{' '}
        {Math.round(VALIDATION.buildings.precisionWithin120m * 100)}% a menos de 120 m de ella: el modelo sobrestima el daño urbano porque no incluye el combate del
        fuego.
      </p>
      <p className="small">
        Ritmo del avance frente al satélite (minutos que el frente simulado va atrasado, +, o adelantado, −, respecto del frente
        detectado): con GOES-16, una imagen cada 10 minutos, mientras el fuego real avanzaba (hasta las{' '}
        {VALIDATION.pacing.fit.advanceUntil['las-tablas-penuelas']} en el oeste y las{' '}
        {VALIDATION.pacing.fit.advanceUntil['quilpue-villa-alemana-oriente']} en el este) el desfase cuadrático medio es de{' '}
        <strong>{VALIDATION.pacing.fit.rmsAdvanceMin['las-tablas-penuelas']} min</strong> en el foco oeste y{' '}
        <strong>{VALIDATION.pacing.fit.rmsAdvanceMin['quilpue-villa-alemana-oriente']} min</strong> en el este. Hasta medianoche sube a{' '}
        {VALIDATION.pacing.fit.rmsLagMin['las-tablas-penuelas']} y {VALIDATION.pacing.fit.rmsLagMin['quilpue-villa-alemana-oriente']} min:
        después de esa hora el fuego real dejó de avanzar y el modelo, que no incluye el combate del fuego, sigue (con estos datos se
        ajustó el modelo). En las pasadas VIIRS y MODIS, que no se usaron para ajustar:{' '}
        {VALIDATION.pacing.test.map((x, k) => (
          <span key={`${x.time}-${x.fire}`}>
            {k > 0 ? ' · ' : ''}
            {x.time} {FIRE_ES[x.fire] ?? x.fire} {fmtLag(x.lagMin)}
          </span>
        ))}
        . Entre las 14:00 y las 16:30 el fuego real estuvo casi detenido a unos 6 km de Las Tablas y luego avanzó unos 100 m por
        minuto; el modelo no reproduce esa detención.
      </p>
      <p className="small">
        Llegada del frente oeste (simulada / satélite GOES-16 / reportada por prensa):{' '}
        {VALIDATION.anchors.map((a, k) => (
          <span key={a.name}>
            {k > 0 ? ' · ' : ''}
            {a.name} {a.model === 'never' ? 'no llega' : a.model} / {a.satellite === 'never' ? 'sin detección' : a.satellite} / {a.reported}
          </span>
        ))}
        . Calibrado sobre este mismo incendio: factores de combustible ajustados al ritmo satelital y una corrección de{' '}
        {VALIDATION.windDirCorrectionDeg}° a la dirección del viento de ERA5.
      </p>
    </>
  )
}

/** What the Eaton timeline is, above everything else. */
function EatonNote() {
  return (
    <div className="alert info timeline-note">
      <b>Incendio Eaton</b> (Altadena y Pasadena, California), 7 de enero de 2025 desde las 18:00 hasta el mediodía del 8, hora del Pacífico. Mismos
      datos abiertos y mismo modelo que en Viña del Mar, sin ajustes para este incendio: sirve para ver si el modelo se generaliza.
    </div>
  )
}

/** What the hypothetical Talca timeline is, above everything else. */
function TalcaNote() {
  return (
    <div className="alert info timeline-note">
      <b>Escenario hipotético en Talca</b> (región del Maule): no reproduce un incendio ocurrido. Usa la meteorología registrada de un día caluroso,
      seco y ventoso (8 de febrero de 2025, de 12:00 a 24:00), un punto de inicio elegido para la demostración en pastizal del valle, unos 10 km al suroeste del centro de
      la ciudad, y el mismo modelo calibrado solo con el incendio de Viña del Mar 2024, sin validación local. Aún sin bomberos. Sirve para explorar y
      planificar, no para predecir.
    </div>
  )
}

/** What the today timeline assumes, above everything else it changes. */
function TodayNote(p: Props) {
  const t0 = p.data.grid.t0
  if (p.data.timeline === TIMELINE.TODAY_TALCA)
    return (
      <div className="alert info timeline-note">
        <b>Escenario hipotético de hoy en Talca</b> (región del Maule), {minToDateLabel(t0, 0)}, las 24 horas: el pronóstico del tiempo de hoy para
        este punto y <b>ningún foco</b>: ajusta el reloj y agrega los focos en el mapa («Agregar ignición»); toca un foco para quitarlo. Usa el mismo
        modelo calibrado solo con el incendio de Viña del Mar 2024, sin validación local, y el combustible de ESA WorldCover 2021. Aún sin bomberos.
        Sirve para explorar y planificar, no para predecir.
      </div>
    )
  return (
    <div className="alert info timeline-note">
      <b>Escenario hipotético de hoy</b>, {minToDateLabel(t0, 0)}, las 24 horas: el pronóstico del tiempo de hoy para este punto (sin la corrección
      de viento calibrada para 2024), los mismos puntos de inicio del 2 feb 2024 a la misma hora del día y el combustible de antes de ese incendio:
      en el área quemada en 2024 supone la vegetación previa, no la actual. Sirve para comparar, no para predecir.
    </div>
  )
}

export function Panel(p: Props) {
  const today = isTodayTimeline(p.data.timeline)
  return (
    <>
      <Results {...p} />
      <div className="panel-scroll">
        {today && <TodayNote {...p} />}
        {p.data.timeline === TIMELINE.EATON_2025 && <EatonNote />}
        {p.data.timeline === TIMELINE.TALCA && <TalcaNote />}
        <RiskBlock {...p} />
        <ClimaSection {...p} />
        <FuegoSection {...p} />
        <CortafuegosSection {...p} />
        <PlanSection data={p.data} scenario={p.scenario} update={p.update} />
        <BrigadesSection
          data={p.data}
          scenario={p.scenario}
          update={p.update}
          out={p.brigadesOut}
          burnedHaEnd={p.summary?.burnedHaEnd ?? null}
          buildingsReached={p.summary?.buildingsReached ?? null}
          trappedHouseholds={p.summary?.trappedHouseholds ?? null}
        />
        <EvacuacionSection {...p} />
        {!today && p.data.event.observedFire && <ValidacionSection {...p} />}
      </div>
    </>
  )
}
