import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_FIRE_PARAMS } from './engine/fire'
import { DEFAULT_EVAC_PARAMS } from './engine/evac'
import type { Dataset } from './data/load'
import { loadRealDataset } from './data/load'
import { makeMockDataset } from './data/mock'
import { localToMin, minToHHMM } from './data/time'
import { SimClient } from './worker/client'
import type { BrigadesOut, EvacOut, FireOut } from './worker/protocol'
import type { FirebreakWidth, Scenario, WeatherSettings } from './worker/scenario'
import { buildWeatherSeries, countAtOrBefore, defaultBrigades, HORIZON_MIN, sampleAt, sortedArrivals } from './worker/scenario'
import { MapView } from './ui/MapView'
import type { LayerToggles, Tool } from './ui/MapView'
import { Panel } from './ui/Panel'
import type { Summary, Timings } from './ui/Panel'
import { Timebar } from './ui/Timebar'
import { LayersCard } from './ui/LayersCard'
import { SourcesModal } from './ui/SourcesModal'

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
  const raw = buildWeatherSeries(data.weather, data.grid.t0, NEUTRAL_WEATHER).series
  // Constant-mode defaults: the real conditions at 15:00 (3 h after t0), rounded to the sliders' steps.
  const s = sampleAt(raw, 180)
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
    alertMin: DEFAULT_EVAC_PARAMS.alertMin,
    cueShare: DEFAULT_EVAC_PARAMS.cueShare,
    cueRadiusM: DEFAULT_EVAC_PARAMS.cueRadiusM,
    prepMedianMin: DEFAULT_EVAC_PARAMS.prepMedianMin,
    footShare: DEFAULT_EVAC_PARAMS.footShare,
    closedEdges: [],
    addedLinks: [],
    brigades: defaultBrigades(data.brigades, data.grid.t0),
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
}

const TOOL_HINT: Record<Exclude<Tool, 'none'>, string> = {
  ignition: 'Haz clic en el mapa para agregar una ignición a las {t}.',
  firebreak: 'Haz clic para marcar puntos del cortafuego; doble clic o Enter para terminar.',
  closeRoad: 'Haz clic sobre una calle para cerrarla o volver a abrirla.',
  link: 'Haz clic en el primer punto de la red de calles y luego en el segundo para unirlos.',
}

let uid = 0
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${uid++}`

export default function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  useEffect(() => {
    const forceMock = new URLSearchParams(window.location.search).has('mock')
    ;(forceMock ? Promise.resolve(null) : loadRealDataset())
      .then((real) => {
        performance.mark('cf:data')
        setData(real ?? makeMockDataset())
      })
      .catch((e: unknown) => setFatal(e instanceof Error ? e.message : String(e)))
  }, [])
  if (fatal)
    return (
      <div className="fullscreen-msg">
        <h1>Cortafuego</h1>
        <div className="alert error">No se pudieron cargar los datos: {fatal}</div>
      </div>
    )
  if (!data)
    return (
      <div className="fullscreen-msg">
        <h1>Cortafuego</h1>
        <p className="muted">Cargando terreno, combustibles, edificaciones y calles…</p>
      </div>
    )
  return <Explorer data={data} />
}

/** ?offline=1 (or ?sin-conexion): no network map services (projector without internet). */
const OFFLINE = ['offline', 'sin-conexion'].some((k) => new URLSearchParams(window.location.search).has(k))

function Explorer({ data }: { data: Dataset }) {
  const t0 = data.grid.t0
  const [scenario, setScenario] = useState<Scenario>(() => defaultScenario(data))
  const [clock, setClock] = useState(6 * 60)
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
    c.init(data.synthetic)
    client.current = c
    return () => {
      c.dispose()
      client.current = null
    }
  }, [data])

  // Re-run on any scenario change, debounced.
  useEffect(() => {
    const id = window.setTimeout(() => client.current?.run(scenario), 250)
    return () => window.clearTimeout(id)
  }, [scenario])

  // ------------------------------------------------------------ weather (same functions the worker uses)
  const rawSeries = useMemo(() => buildWeatherSeries(data.weather, t0, NEUTRAL_WEATHER).series, [data, t0])
  const applied = useMemo(() => {
    try {
      return buildWeatherSeries(data.weather, t0, scenario.weather)
    } catch (e) {
      return { series: rawSeries, notes: [`Clima inválido: ${(e as Error).message}`] }
    }
  }, [data, t0, scenario.weather, rawSeries])

  // ------------------------------------------------------------ results
  const sorted = useMemo(() => (fire ? sortedArrivals(fire.arrivalMin) : null), [fire])
  const cellHa = (data.grid.cellM * data.grid.cellM) / 10000
  const burnedHaNow = sorted ? countAtOrBefore(sorted, clock) * cellHa : 0
  const summary: Summary | null =
    fire && evac
      ? {
          burnedHaEnd: fire.burnedCells * cellHa,
          buildingsReached: evac.buildingsReached,
          trappedHouseholds: Math.round(evac.expectedTrappedHouseholds),
          trappedPeople: Math.round(evac.expectedTrappedPeople),
        }
      : null
  const firmsShown = useMemo(() => data.firms.filter((f) => localToMin(t0, f.timeLocal) <= clock).length, [data, t0, clock])

  // ------------------------------------------------------------ playback
  const clockRef = useRef(clock)
  clockRef.current = clock
  useEffect(() => {
    if (!playing) return
    // play from the start again once at the end
    if (clockRef.current >= HORIZON_MIN) {
      clockRef.current = 0
      setClock(0)
    }
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const n = clockRef.current + ((now - last) / 1000) * speed
      last = now
      if (n >= HORIZON_MIN) {
        clockRef.current = HORIZON_MIN
        setClock(HORIZON_MIN)
        setPlaying(false)
        return
      }
      clockRef.current = n
      setClock(n)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed])

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
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Cortafuego</h1>
          <p>Explorador de escenarios del incendio del 2 de febrero de 2024 · Viña del Mar, Quilpué y Villa Alemana</p>
        </div>
        <button type="button" className="btn ghost" onClick={() => setShowSources(true)}>
          Fuentes y supuestos
        </button>
      </header>
      {data.synthetic && (
        <div className="banner">
          <b>Datos de prueba (sintéticos)</b> · Los datos reales aún no están disponibles; el territorio, el clima y los resultados son ficticios.
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
          <LayersCard layers={effectiveLayers} setLayer={setLayer} showRoutes={showRoutes} />
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
