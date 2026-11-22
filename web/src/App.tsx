import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_FIRE_PARAMS } from './engine/fire'
import { DEFAULT_EVAC_PARAMS } from './engine/evac'
import { awayShare, peopleInBurnedArea } from './engine/population'
import { POPULATION_DAY, TIMELINE, type PopulationDay, type TimelineId } from './engine/types'
import type { Dataset } from './data/load'
import { loadRealDataset } from './data/load'
import { makeMockDataset } from './data/mock'
import { fetchForecast, santiagoDate, type Forecast } from './data/forecast'
import { EATON_2025_CHOICE, isTimelineId, TALCA_CHOICE, TIMELINE_OPTIONS, timelineDataset, VINA_2024_CHOICE, type TimelineChoice } from './data/timeline'
import { checkEvent, EVENTS, eventOfTimeline, type EventDef, type EventId } from './data/events'
import { localToMin, minToDateLabel, minToHHMM, wallClockMin } from './data/time'
import { SimClient } from './worker/client'
import type { BrigadesOut, EvacOut, FireOut } from './worker/protocol'
import type { FirebreakWidth, Scenario, WeatherSettings } from './worker/scenario'
import { buildWeatherSeries, countAtOrBefore, defaultBrigades, noBrigades, sampleAt, sortedArrivals } from './worker/scenario'
import { MapView } from './ui/MapView'
import type { LayerToggles, Tool } from './ui/MapView'
import { Panel } from './ui/Panel'
import type { Summary, Timings } from './ui/Panel'
import { Timebar } from './ui/Timebar'
import { LayersCard } from './ui/LayersCard'
import { SourcesModal } from './ui/SourcesModal'
import { Topbar } from './ui/Topbar'
import { StartupSplash } from './ui/StartupSplash'

const NEUTRAL_WEATHER: WeatherSettings = {
  mode: 'real',
  windFactor: 1,
  windDirOffsetDeg: 0,
  rhOffset: 0,
  tempOffsetC: 0,
  windKmh: 0,
  windFromDeg: 0,
  rh: 50,
  tempC: 20,
}

function defaultScenario(data: Dataset): Scenario {
  const raw = buildWeatherSeries(data.weather, data.grid.t0, NEUTRAL_WEATHER, data.windDirCorrectionDeg).series
  // Constant-mode defaults: the scenario's own conditions at 15:00 that day, rounded to the sliders' steps.
  const s = sampleAt(raw, localToMin(data.grid.t0, `${data.grid.t0.slice(0, 10)}T15:00`))
  return {
    weather: {
      ...NEUTRAL_WEATHER,
      windKmh: Math.round(s.windKmh),
      windFromDeg: (Math.round(s.windFromDeg / 5) * 5) % 360,
      rh: Math.min(100, Math.max(1, Math.round(s.rh))),
      tempC: Math.round(s.tempC * 2) / 2,
    },
    droughtFactor: DEFAULT_FIRE_PARAMS.droughtFactor,
    spotting: DEFAULT_FIRE_PARAMS.spotting,
    spotMetresPerKmh: DEFAULT_FIRE_PARAMS.spotMetresPerKmh,
    presetIgnitions: data.ignitions.map((g) => g.id),
    userIgnitions: [],
    firebreaks: [],
    alertMin: data.defaultAlertMin,
    cueShare: DEFAULT_EVAC_PARAMS.cueShare,
    cueRadiusM: DEFAULT_EVAC_PARAMS.cueRadiusM,
    prepMedianMin: DEFAULT_EVAC_PARAMS.prepMedianMin,
    footShare: data.event.evac.footShare.value,
    closedEdges: [],
    addedLinks: [],
    brigades: data.brigades ? defaultBrigades(data.brigades, data.grid.t0) : noBrigades(),
  }
}

const DEFAULT_LAYERS: LayerToggles = {
  fuego: true,
  viviendas: true,
  calles: true,
  zonasSeguras: true,
  cortafuegos: true,
  firms: true,
  cicatriz: false,
  combustible: false,
  bomberos: true,
  poblacion: false,
}

const TOOL_HINT: Record<Exclude<Tool, 'none'>, string> = {
  ignition: 'Haz clic en el mapa para agregar una ignición a las {t}.',
  firebreak: 'Haz clic para marcar puntos del cortafuego; doble clic o Enter para terminar.',
  closeRoad: 'Haz clic sobre una calle para cerrarla o volver a abrirla.',
  link: 'Haz clic en el primer punto de la red de calles y luego en el segundo para unirlos.',
}

let uid = 0
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${uid++}`

/** ?offline=1 (or ?sin-conexion): no network map services (projector without internet). */
const OFFLINE = ['offline', 'sin-conexion'].some((k) => new URLSearchParams(window.location.search).has(k))

/** URL parameter that picks the scenario (?escenario=hoy | vina-2024), so a link opens the one shared. */
const TIMELINE_PARAM = 'escenario'

/** The app opens on the scenario that starts today. Offline (projector) mode cannot download the forecast, so it
 *  opens on the 2024 fire unless the link asks for another one. */
function initialTimeline(): TimelineId {
  const v = new URLSearchParams(window.location.search).get(TIMELINE_PARAM)
  if (isTimelineId(v)) return v
  return OFFLINE ? TIMELINE.VINA_2024 : TIMELINE.TODAY
}

/** A ?escenario value that names no scenario: shown to the user, not silently replaced. */
function unknownTimelineParam(): string | null {
  const v = new URLSearchParams(window.location.search).get(TIMELINE_PARAM)
  return v !== null && !isTimelineId(v) ? v : null
}

function setTimelineParam(t: TimelineId) {
  const url = new URL(window.location.href)
  url.searchParams.set(TIMELINE_PARAM, t)
  window.history.replaceState(null, '', url)
}

const timelineLabel = (t: TimelineId) => TIMELINE_OPTIONS.find((o) => o.value === t)?.label ?? t

/** "de 00:00 a 24:00": the timeline's window on the wall clock (an end at midnight reads 24:00). */
function windowLabel(data: Dataset): string {
  const end = minToHHMM(data.grid.t0, data.horizonMin)
  return `de ${minToHHMM(data.grid.t0, 0)} a ${end === '00:00' ? '24:00' : end}`
}

function subtitleFor(data: Dataset | null, timeline: TimelineId): string {
  if (timeline === TIMELINE.VINA_2024) return 'Explorador de escenarios del incendio del 2 de febrero de 2024'
  if (timeline === TIMELINE.EATON_2025) return 'Explorador de escenarios del incendio Eaton del 7 de enero de 2025 · Altadena y Pasadena, California'
  if (timeline === TIMELINE.TALCA) return 'Escenario hipotético en Talca (Maule) con el tiempo de un día caluroso de referencia, 8 de febrero de 2025'
  const day = data ? ` (${minToDateLabel(data.grid.t0, 0)}, ${windowLabel(data)})` : ''
  return `Escenario de hoy${day} con el pronóstico del tiempo`
}

type ForecastState = { status: 'loading' } | { status: 'ok'; forecast: Forecast } | { status: 'error'; message: string }

export default function App() {
  /** Baked datasets by event, each loaded the first time a timeline needs it (src/data/events.ts). */
  const [bases, setBases] = useState<Partial<Record<EventId, Dataset>>>({})
  const [fatal, setFatal] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineId>(initialTimeline)
  const [badParam, setBadParam] = useState<string | null>(unknownTimelineParam)
  /** null until the today timeline is first shown (and again after "Reintentar"). */
  const [forecast, setForecast] = useState<ForecastState | null>(null)
  const eventId = eventOfTimeline(timeline)
  const base = bases[eventId] ?? null
  useEffect(() => {
    if (bases[eventId]) return
    const forceMock = new URLSearchParams(window.location.search).has('mock')
    let event: EventDef
    try {
      event = checkEvent(EVENTS[eventId])
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e))
      return
    }
    let live = true
    ;(forceMock ? Promise.resolve(null) : loadRealDataset(event))
      .then((real) => {
        performance.mark('cf:data')
        // The synthetic set stands in for Viña's files only; another event without data is an error.
        if (!real && !forceMock && event.id !== TIMELINE.VINA_2024) throw new Error(`no están los datos de "${event.id}" en /data/${event.dir} (grid.json)`)
        if (live) setBases((b) => ({ ...b, [eventId]: real ?? makeMockDataset() }))
      })
      .catch((e: unknown) => live && setFatal(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [eventId, bases])
  // The forecast is downloaded the first time the today timeline is shown, and again if it is shown on a later
  // date than the one downloaded (a tab left open past midnight).
  useEffect(() => {
    if (timeline !== TIMELINE.TODAY) return
    const stale = forecast?.status === 'ok' && forecast.forecast.date !== santiagoDate(new Date())
    if (forecast !== null && !stale) return
    setForecast({ status: 'loading' })
    fetchForecast()
      .then((f) => setForecast({ status: 'ok', forecast: f }))
      .catch((e: unknown) => setForecast({ status: 'error', message: e instanceof Error ? e.message : String(e) }))
  }, [timeline, forecast])
  const pickTimeline = useCallback((t: TimelineId) => {
    setTimeline(t)
    setBadParam(null)
    setTimelineParam(t)
  }, [])
  // An unknown ?escenario: the address bar shows the scenario actually open (the notice says what happened).
  useEffect(() => {
    if (unknownTimelineParam() !== null) setTimelineParam(timeline)
  }, [timeline])
  const notice = badParam
    ? `El enlace pide el escenario «${badParam}», que no existe (opciones: ${TIMELINE_OPTIONS.map((o) => o.value).join(', ')}); se muestra «${timelineLabel(timeline)}».`
    : null

  const okForecast = forecast?.status === 'ok' ? forecast.forecast : null
  const choice = useMemo<TimelineChoice | null>(() => {
    if (timeline === TIMELINE.VINA_2024) return VINA_2024_CHOICE
    if (timeline === TIMELINE.EATON_2025) return EATON_2025_CHOICE
    if (timeline === TIMELINE.TALCA) return TALCA_CHOICE
    return okForecast ? { id: TIMELINE.TODAY, forecast: okForecast } : null
  }, [timeline, okForecast])
  const view = useMemo(() => {
    if (!base || !choice) return null
    try {
      return { data: timelineDataset(base, choice), error: null }
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [base, choice])

  const topbar = (onSources?: () => void) => (
    <Topbar subtitle={subtitleFor(view?.data ?? null, timeline)} timeline={timeline} onTimeline={pickTimeline} offline={OFFLINE} onSources={onSources} />
  )
  const error = view?.error ?? (forecast?.status === 'error' ? forecast.message : null)
  let content: ReactNode
  if (fatal) {
    content = (
      <div className="fullscreen-msg">
        <h1>Cortafuego</h1>
        <div className="alert error">No se pudieron cargar los datos: {fatal}</div>
      </div>
    )
  } else if (!base) {
    content = (
      <div className="fullscreen-msg">
        <h1>Cortafuego</h1>
        <p className="muted">Cargando terreno, combustibles, edificaciones y calles…</p>
      </div>
    )
  } else if (!view || !view.data || !choice) {
    content = (
      <div className="app">
        {topbar()}
        {notice && <div className="banner">{notice}</div>}
        <div className="timeline-msg">
          {error ? (
            <>
              <div className="alert error">No se pudo preparar el escenario desde hoy: {error}</div>
              <div className="row">
                <button type="button" className="btn" onClick={() => setForecast(null)}>
                  Reintentar
                </button>
                <button type="button" className="btn ghost" onClick={() => pickTimeline(TIMELINE.VINA_2024)}>
                  Ver el incendio del 2 feb 2024
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Descargando el pronóstico del tiempo de hoy (Open-Meteo)…</p>
          )}
        </div>
      </div>
    )
  } else {
    // A new timeline (or a new day's forecast) remounts the explorer: a fresh scenario, clock, map and worker.
    content = <Explorer key={`${view.data.timeline} ${view.data.grid.t0}`} data={view.data} choice={choice} topbar={topbar} notice={notice} />
  }
  const ready = Boolean(base && view?.data && choice)
  return (
    <StartupSplash
      ready={ready}
      failed={Boolean(fatal || (base && !ready && error))}
      message={!base
        ? 'Cargando terreno, vegetación, edificaciones y calles…'
        : ready ? 'Preparando el escenario…' : 'Descargando el pronóstico del tiempo de hoy…'}
    >
      {content}
    </StartupSplash>
  )
}

function Explorer({
  data,
  choice,
  topbar,
  notice,
}: {
  data: Dataset
  choice: TimelineChoice
  topbar: (onSources: () => void) => ReactNode
  /** Shown in the banner row (e.g. an unknown ?escenario in the link). */
  notice: string | null
}) {
  const t0 = data.grid.t0
  const horizon = data.horizonMin
  const [scenario, setScenario] = useState<Scenario>(() => defaultScenario(data))
  // The clock opens at the default alert time (18:00), when the fire is well under way in the 2024 replay.
  const [clock, setClock] = useState(() => Math.min(data.defaultAlertMin, data.horizonMin))
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(15)
  const [terrain3d, setTerrain3d] = useState(false)
  const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYERS)
  const [showRoutes, setShowRoutes] = useState(false)
  const [tool, setTool] = useState<Tool>('none')
  const [firebreakWidth, setFirebreakWidth] = useState<FirebreakWidth>(60)
  const [linkStart, setLinkStart] = useState<number | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [showSources, setShowSources] = useState(false)

  const [fire, setFire] = useState<FireOut | null>(null)
  const [evac, setEvac] = useState<EvacOut | null>(null)
  const [brigadesOut, setBrigadesOut] = useState<BrigadesOut | null>(null)
  const [safe, setSafe] = useState<Uint8Array | null>(null)
  // true until the first result arrives (the worker first prepares the street graph)
  const [busy, setBusy] = useState(true)
  const [simError, setSimError] = useState<string | null>(null)
  const [timings, setTimings] = useState<Timings | null>(null)
  const [baseline, setBaseline] = useState<Summary | null>(null)
  /** Which day the population model assumes (who is home, who is at work or school). UI-only: the worker's
   *  fire and evacuation do not depend on it. */
  const [populationDay, setPopulationDay] = useState<PopulationDay>(POPULATION_DAY.REAL)

  const update = useCallback((patch: Partial<Scenario>) => setScenario((s) => ({ ...s, ...patch })), [])
  const updateWeather = useCallback((patch: Partial<WeatherSettings>) => setScenario((s) => ({ ...s, weather: { ...s.weather, ...patch } })), [])
  const setLayer = useCallback((k: keyof LayerToggles, v: boolean) => setLayers((l) => ({ ...l, [k]: v })), [])
  const onNote = useCallback((key: string, note: string | null) => {
    setNotes((n) => {
      const next = { ...n }
      if (note) next[key] = note
      else delete next[key]
      return next
    })
  }, [])

  // ------------------------------------------------------------ simulation worker
  const client = useRef<SimClient | null>(null)
  const scenarioRef = useRef(scenario)
  scenarioRef.current = scenario
  useEffect(() => {
    const c = new SimClient({
      onReady: () => performance.mark('cf:ready'),
      onResult: (r, roundTripMs) => {
        performance.mark('cf:result')
        // The worker loads its own copy of the files: refuse results that do not match what the map shows.
        const mismatch =
          (r.fire && r.fire.arrivalMin.length !== data.grid.rows * data.grid.cols) ||
          r.evac.householdStatus.length !== data.buildings.length / 3 ||
          r.evac.edgeFlow.length !== data.roads.edges.length ||
          r.safeNodes.length !== data.roads.nodes.length
        if (mismatch) {
          setSimError('Los datos del simulador no coinciden con los del mapa (¿se regeneraron los archivos?). Recarga la página.')
          return
        }
        if (r.fire) setFire(r.fire)
        setEvac(r.evac)
        setBrigadesOut(r.brigades ?? null)
        setSafe(r.safeNodes)
        setSimError(null)
        setTimings((prev) => ({ fireMs: r.fire ? r.fire.elapsedMs : (prev?.fireMs ?? null), fireRerun: !!r.fire, evacMs: r.evac.elapsedMs, roundTripMs }))
      },
      onError: (m) => setSimError(m),
      onBusy: setBusy,
    })
    c.init(data.synthetic, choice)
    // A new worker starts with the current scenario (the debounced effect below only fires on changes).
    c.run(scenarioRef.current)
    client.current = c
    return () => {
      c.dispose()
      client.current = null
    }
  }, [data, choice])

  // Re-run on any scenario change, debounced.
  useEffect(() => {
    const id = window.setTimeout(() => client.current?.run(scenario), 250)
    return () => window.clearTimeout(id)
  }, [scenario])

  // ------------------------------------------------------------ weather (same functions the worker uses)
  const rawSeries = useMemo(() => buildWeatherSeries(data.weather, t0, NEUTRAL_WEATHER, data.windDirCorrectionDeg).series, [data, t0])
  const applied = useMemo(() => {
    try {
      return buildWeatherSeries(data.weather, t0, scenario.weather, data.windDirCorrectionDeg)
    } catch (e) {
      return { series: rawSeries, notes: [`Clima inválido: ${(e as Error).message}`] }
    }
  }, [data, t0, scenario.weather, rawSeries])

  // ------------------------------------------------------------ results
  const sorted = useMemo(() => (fire ? sortedArrivals(fire.arrivalMin) : null), [fire])
  const cellHa = (data.grid.cellM * data.grid.cellM) / 10000
  const burnedHaNow = sorted ? countAtOrBefore(sorted, clock) * cellHa : 0
  // Where people are, by time of day (src/engine/population): each burned cell counted at its arrival time.
  const wall0 = useMemo(() => wallClockMin(t0), [t0])
  const people = useMemo(
    () => (fire && data.population ? peopleInBurnedArea(fire.arrivalMin, data.population.home, data.population.work, wall0, data.event.presence.params, populationDay) : null),
    [fire, data, wall0, populationDay],
  )
  const awayNow = awayShare(wall0 + Math.floor(clock), data.event.presence.params, populationDay)
  const summary: Summary | null =
    fire && evac && (people || !data.population)
      ? {
          burnedHaEnd: fire.burnedCells * cellHa,
          buildingsReached: evac.buildingsReached,
          trappedHouseholds: Math.round(evac.expectedTrappedHouseholds),
          trappedPeople: Math.round(evac.expectedTrappedPeople),
          peopleReached: people ? Math.round(people.present) : null,
        }
      : null
  const firmsShown = useMemo(() => data.firms.filter((f) => localToMin(t0, f.timeLocal) <= clock).length, [data, t0, clock])

  // ------------------------------------------------------------ playback
  const clockRef = useRef(clock)
  clockRef.current = clock
  useEffect(() => {
    if (!playing) return
    // play from the start again once at the end
    if (clockRef.current >= horizon) {
      clockRef.current = 0
      setClock(0)
    }
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const n = clockRef.current + ((now - last) / 1000) * speed
      last = now
      if (n >= horizon) {
        clockRef.current = horizon
        setClock(horizon)
        setPlaying(false)
        return
      }
      clockRef.current = n
      setClock(n)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, horizon])

  // ------------------------------------------------------------ tools
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTool('none')
      // Space plays/pauses unless a control has focus (sliders, buttons and selects use Space themselves).
      const el = e.target as HTMLElement | null
      if (e.key === ' ' && !(el && el.closest('input, button, select, textarea, summary, dialog'))) {
        e.preventDefault()
        setPlaying((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => onNote('tool', null), [tool, onNote])

  // Layers this scenario has no data for: FIRMS in the today timeline, the scar where no fire was observed
  // (EventDef.observedFire), population and firefighters where the event does not ship them (EventDef.layers).
  const hiddenLayers = useMemo(
    () => [
      ...(data.firms.length === 0 ? (['firms'] as const) : []),
      ...(data.event.observedFire ? [] : (['cicatriz'] as const)),
      ...(data.population ? [] : (['poblacion'] as const)),
      ...(data.brigades ? [] : (['bomberos'] as const)),
    ],
    [data],
  )
  const effectiveLayers = useMemo(
    // the street tools and the evacuation routes need the street layer on
    () => (tool === 'closeRoad' || tool === 'link' || showRoutes ? { ...layers, calles: true } : layers),
    [layers, tool, showRoutes],
  )

  const widthRef = useRef(firebreakWidth)
  widthRef.current = firebreakWidth
  const onAddIgnition = useCallback((lon: number, lat: number) => {
    setScenario((s) => ({ ...s, userIgnitions: [...s.userIgnitions, { id: newId('ig'), lon, lat, tMin: Math.round(clockRef.current) }] }))
    setTool('none')
  }, [])
  const onFirebreak = useCallback((points: [number, number][]) => {
    setScenario((s) => ({ ...s, firebreaks: [...s.firebreaks, { id: newId('fb'), points, widthM: widthRef.current }] }))
  }, [])
  const onToggleEdge = useCallback((edge: number) => {
    setScenario((s) => ({
      ...s,
      closedEdges: s.closedEdges.includes(edge) ? s.closedEdges.filter((x) => x !== edge) : [...s.closedEdges, edge],
    }))
  }, [])
  const onAddLink = useCallback((u: number, v: number) => {
    setScenario((s) => ({ ...s, addedLinks: [...s.addedLinks, { u, v }] }))
  }, [])

  const hint = tool === 'none' ? null : TOOL_HINT[tool].replace('{t}', minToHHMM(t0, clock))
  const linkHint = tool === 'link' && linkStart !== null ? ' Primer punto elegido: ahora el segundo.' : ''

  const resetScenario = useCallback(() => {
    setScenario(defaultScenario(data))
    setPopulationDay(POPULATION_DAY.REAL)
    setTool('none')
  }, [data])

  const panelProps = {
    data,
    scenario,
    update,
    resetScenario,
    updateWeather,
    clock,
    tool,
    setTool,
    fire,
    evac,
    brigadesOut,
    burnedHaNow,
    summary,
    baseline,
    setBaseline,
    timings,
    busy,
    simError,
    rawSeries,
    appliedSeries: applied.series,
    weatherNotes: applied.notes,
    firebreakWidth,
    setFirebreakWidth,
    layers,
    setLayer,
    showRoutes,
    setShowRoutes,
    linkStart,
    firmsShown,
    people,
    awayNow,
    populationDay,
    setPopulationDay,
  }

  return (
    <div className="app">
      {topbar(() => setShowSources(true))}
      {(data.synthetic || notice) && (
        <div className="banner">
          {data.synthetic && (
            <>
              <b>Datos de prueba (sintéticos)</b> · Los datos reales aún no están disponibles; el territorio, el clima y los resultados son ficticios.
            </>
          )}
          {data.synthetic && notice && ' · '}
          {notice}
        </div>
      )}
      <main className="main">
        <div className={`mapwrap${tool !== 'none' ? ' tool-on' : ''}`}>
          <MapView
            data={data}
            fire={fire}
            evac={evac}
            brigades={brigadesOut}
            safe={safe}
            clock={clock}
            awayNow={awayNow}
            layers={effectiveLayers}
            showRoutes={showRoutes}
            terrain3d={terrain3d}
            offline={OFFLINE}
            scenario={scenario}
            tool={tool}
            onAddIgnition={onAddIgnition}
            onFirebreak={onFirebreak}
            onToggleEdge={onToggleEdge}
            onAddLink={onAddLink}
            onLinkStart={setLinkStart}
            onNote={onNote}
          />
          <LayersCard layers={effectiveLayers} setLayer={setLayer} showRoutes={showRoutes} hide={hiddenLayers} />
          <div className="map-notes">
            {hint && (
              <div className="tool-hint" role="status">
                <span>
                  {hint}
                  {linkHint}
                </span>
                <button type="button" className="btn small" onClick={() => setTool('none')}>
                  Terminar (Esc)
                </button>
              </div>
            )}
            {Object.entries(notes).map(([k, n]) => (
              <div key={k} className="map-note" role="status">
                {n}
              </div>
            ))}
          </div>
          <Timebar
            t0={t0}
            clock={clock}
            setClock={setClock}
            playing={playing}
            setPlaying={setPlaying}
            speed={speed}
            setSpeed={setSpeed}
            terrain3d={terrain3d}
            setTerrain3d={setTerrain3d}
            terrainAvailable={!OFFLINE}
            alertMin={scenario.alertMin}
            horizonMin={horizon}
          />
        </div>
        <aside className="panel" aria-label="Controles del escenario">
          <Panel {...panelProps} />
        </aside>
      </main>
      {showSources && <SourcesModal data={data} onClose={() => setShowSources(false)} />}
    </div>
  )
}
