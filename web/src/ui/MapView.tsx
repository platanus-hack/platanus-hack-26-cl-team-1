import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { CanvasSource, GeoJSONSource, Map as MlMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Dataset } from '../data/load'
import { gridBounds, gridCorners } from '../data/grid'
import { localToMin, minToHHMM } from '../data/time'
import type { BrigadesOut, EvacOut, FireOut } from '../worker/protocol'
import type { Scenario } from '../worker/scenario'
import { HOUSEHOLD } from '../engine/types'
import type { EdgeContact } from '../engine/fire/edge'
import { PLAN_TILE_CELLS, tileRing } from '../engine/plan'
import { drawFire, drawFuel, drawHillshade, drawPopulation, drawScar } from './overlays'
import type { Feature, FeatureCollection, LineString, SetDataArg } from './geo'
import { COARSE_QUERY } from './useMediaQuery'

export type Tool = 'none' | 'ignition' | 'firebreak' | 'closeRoad' | 'link'

const STATUS_LABEL: Record<number, string> = {
  [HOUSEHOLD.UNAFFECTED]: 'Sin amenaza',
  [HOUSEHOLD.SAFE]: 'Sale a tiempo',
  [HOUSEHOLD.AT_RISK]: 'En riesgo',
  [HOUSEHOLD.TRAPPED]: 'Salida cortada',
}

export interface LayerToggles {
  fuego: boolean
  viviendas: boolean
  calles: boolean
  zonasSeguras: boolean
  cortafuegos: boolean
  firms: boolean
  cicatriz: boolean
  combustible: boolean
  bomberos: boolean
  poblacion: boolean
  /** Plan de preparación: treated belt tiles and programme sectors. */
  plan: boolean
}

export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
/** Never used as data: a stand-in for "never" in GeoJSON properties (JSON has no Infinity). */
const NEVER = 1e9
/** Quantisation of the clock for vector layers (re-tiling on every frame would be wasteful). */
const CLOCK_STEP_MIN = 10

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#10141c' } }],
}

interface Props {
  data: Dataset
  fire: FireOut | null
  /** Outer-ring cells the fire reaches (src/engine/fire/edge.ts): drawn on the simulated area's outline. */
  edge: EdgeContact | null
  evac: EvacOut | null
  brigades: BrigadesOut | null
  safe: Uint8Array | null
  clock: number
  /** Share of residents at work or school at the clock's time (src/engine/population), for the population layer. */
  awayNow: number
  layers: LayerToggles
  showRoutes: boolean
  terrain3d: boolean
  /** No network map services: start on the hillshade computed from elevation.bin, no base map, no 3D. */
  offline: boolean
  scenario: Scenario
  tool: Tool
  onAddIgnition: (lon: number, lat: number) => void
  /** Removes an added fire start (Scenario.userIgnitions id). */
  onRemoveIgnition: (id: string) => void
  /** Turns a preset fire start (ignitions.json id) on or off. */
  onTogglePresetIgnition: (id: string, on: boolean) => void
  onFirebreak: (points: [number, number][]) => void
  onToggleEdge: (edge: number) => void
  onAddLink: (u: number, v: number) => void
  onLinkStart: (node: number | null) => void
  onNote: (key: string, note: string | null) => void
  /** Points of the firebreak being drawn, whenever it changes (the tool hint shows them and offers to save). */
  onDraft: (points: number) => void
  /** Incremented to save the firebreak being drawn (the "Guardar" button: touch screens have no double click or Enter). */
  finishFirebreak: number
  /** Pixels at the bottom of the map hidden by the phone layout's bottom sheet: the initial fit keeps the grid above it. */
  padBottom: number
}

function fc(features: Feature[]): SetDataArg {
  const out: FeatureCollection = { type: 'FeatureCollection', features }
  return out as unknown as SetDataArg
}

export function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const p = useRef(props)
  p.current = props
  const ready = useRef(false)
  const fallback = useRef(false)
  const draft = useRef<[number, number][]>([])
  /** Re-fits the grid to the map until the user moves it (set while the map exists). */
  const refitRef = useRef<(() => void) | null>(null)
  const linkStart = useRef<number | null>(null)
  const canvases = useRef({
    fire: document.createElement('canvas'),
    fuel: document.createElement('canvas'),
    scar: document.createElement('canvas'),
    hill: document.createElement('canvas'),
    pop: document.createElement('canvas'),
  })
  const roadGeoms = useRef<LineString[]>([])
  const popup = useRef<maplibregl.Popup | null>(null)
  /** Building indices currently drawn in bld-status (for the click popup). */
  const affected = useRef<number[]>([])

  // ---------------------------------------------------------------- updaters (read the latest props)
  const src = (id: string) => mapRef.current?.getSource(id) as GeoJSONSource | undefined

  function updateFire() {
    const map = mapRef.current
    if (!map || !ready.current) return
    const { data, fire, clock } = p.current
    drawFire(canvases.current.fire, data.grid, fire?.arrivalMin ?? null, fire?.rosMPerMin ?? null, clock)
    const s = map.getSource('fire') as CanvasSource | undefined
    if (s) {
      s.play()
      s.pause()
    }
  }

  /** The stretch of the simulated area's outline the fire reaches: one segment per outer-ring cell, on its outer
   *  side(s), with its arrival time (shown from that time on, like the rest of the clock-driven layers). */
  function updateEdge() {
    const { data, edge } = p.current
    const g = data.grid
    const [w, s, e, n] = gridBounds(g)
    const feats: Feature[] = []
    if (edge) {
      for (let k = 0; k < edge.cells.length; k++) {
        const cell = edge.cells[k]
        const r = Math.floor(cell / g.cols)
        const c = cell % g.cols
        const x0 = g.lonMin + c * g.dLon
        const x1 = x0 + g.dLon
        const y0 = g.latMax - r * g.dLat
        const y1 = y0 - g.dLat
        const segs: [number, number][][] = []
        if (r === 0) segs.push([[x0, n], [x1, n]])
        if (r === g.rows - 1) segs.push([[x0, s], [x1, s]])
        if (c === 0) segs.push([[w, y0], [w, y1]])
        if (c === g.cols - 1) segs.push([[e, y0], [e, y1]])
        for (const coordinates of segs) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { t: edge.times[k] } })
      }
    }
    src('domain-edge')?.setData(fc(feats))
  }

  function updatePopulation() {
    const map = mapRef.current
    if (!map || !ready.current) return
    const { data, awayNow } = p.current
    // No population layer for this event (EventDef.layers): the canvas stays blank and the panel says so.
    if (!data.population) return
    drawPopulation(canvases.current.pop, data.grid, data.population.home, data.population.work, awayNow)
    const s = map.getSource('pop') as CanvasSource | undefined
    if (s) {
      s.play()
      s.pause()
    }
  }

  function updateClockState() {
    const map = mapRef.current
    if (!map || !ready.current) return
    map.setGlobalStateProperty('clock', Math.floor(p.current.clock / CLOCK_STEP_MIN) * CLOCK_STEP_MIN)
    map.setGlobalStateProperty('routes', p.current.showRoutes)
  }

  function updateRoads() {
    const { data, evac, scenario } = p.current
    const closed = new Set(scenario.closedEdges)
    const feats: Feature[] = data.roads.edges.map((e, i) => ({
      type: 'Feature',
      id: i,
      geometry: roadGeoms.current[i],
      properties: {
        e: i,
        cls: e[3],
        f: evac ? evac.edgeFlow[i] : 0,
        t: evac && evac.edgeClosesMin[i] !== Infinity ? evac.edgeClosesMin[i] : NEVER,
        x: closed.has(i) ? 1 : 0,
      },
    }))
    src('roads')?.setData(fc(feats))
  }

  function updateLinks() {
    const { data, scenario } = p.current
    const n = data.roads.nodes
    const feats: Feature[] = scenario.addedLinks.map((l) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [n[l.u], n[l.v]] },
      properties: {},
    }))
    if (linkStart.current !== null)
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: n[linkStart.current] }, properties: { start: 1 } })
    src('links')?.setData(fc(feats))
  }

  /** One MultiPoint per household status (hundreds of thousands of Point features would be slow to build). */
  function updateBuildings() {
    const { data, evac } = p.current
    const b = data.buildings
    const byStatus: Record<number, [number, number][]> = { [HOUSEHOLD.SAFE]: [], [HOUSEHOLD.AT_RISK]: [], [HOUSEHOLD.TRAPPED]: [] }
    const idx: number[] = []
    if (evac) {
      const st = evac.householdStatus
      for (let k = 0; k < st.length; k++)
        if (st[k] !== HOUSEHOLD.UNAFFECTED) {
          byStatus[st[k]].push([b[k * 3], b[k * 3 + 1]])
          idx.push(k)
        }
    }
    affected.current = idx
    src('bld-status')?.setData(
      fc(Object.entries(byStatus).map(([s, pts]) => ({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: pts }, properties: { s: Number(s) } }))),
    )
  }

  function updateSafe() {
    const { data, safe } = p.current
    const pts: [number, number][] = []
    if (safe) for (let k = 0; k < safe.length; k++) if (safe[k]) pts.push(data.roads.nodes[k])
    src('safe')?.setData(fc([{ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: pts }, properties: {} }]))
  }

  function updateFirebreaks() {
    const { scenario } = p.current
    src('firebreaks')?.setData(
      fc(scenario.firebreaks.map((f) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: f.points }, properties: { w: f.widthM } }))),
    )
  }

  function updateDraft() {
    const pts = draft.current
    const feats: Feature[] = pts.map((q) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: q }, properties: {} }))
    if (pts.length >= 2) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} })
    src('draft')?.setData(fc(feats))
    p.current.onDraft(pts.length)
  }

  function updateIgnitions() {
    const { data, scenario } = p.current
    const on = new Set(scenario.presetIgnitions)
    const feats: Feature[] = data.ignitions.map((g) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [g.lon, g.lat] },
      properties: { id: g.id, on: on.has(g.id) ? 1 : 0, user: 0, t: localToMin(data.grid.t0, g.timeLocal) },
    }))
    for (const u of scenario.userIgnitions)
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [u.lon, u.lat] }, properties: { id: u.id, on: 1, user: 1, t: u.tMin } })
    src('ignitions')?.setData(fc(feats))
  }

  function updateBrigades() {
    // Road geometries are filled when the layers are set up; syncAll() reruns this then.
    if (!ready.current) return
    const { data, brigades, scenario } = p.current
    const on = scenario.brigades.enabled
    const out = on ? brigades : null
    const stations: Feature[] =
      on && data.brigades
      ? [
          ...data.brigades.stations.map((s): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { entry: 0 } })),
          ...data.brigades.reinforcements.flatMap((r) =>
            r.entries.map((e): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { entry: 1 } })),
          ),
        ]
      : []
    src('brig-stations')?.setData(fc(stations))
    const routeEdges = new Set<number>()
    const sites = new Map<number, number>()
    if (out)
      for (const u of out.units)
        if (u.status === 'deployed') {
          for (const e of u.path) routeEdges.add(e)
          sites.set(u.siteNode, (sites.get(u.siteNode) ?? 0) + 1)
        }
    const lines = (edges: Iterable<number>): Feature[] => [
      { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [...edges].map((e) => roadGeoms.current[e].coordinates) }, properties: {} },
    ]
    src('brig-routes')?.setData(fc(lines(routeEdges)))
    src('brig-cuts')?.setData(fc(lines(out ? out.cutEdges : [])))
    src('brig-sites')?.setData(
      fc([...sites].map(([n, k]): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: data.roads.nodes[n] }, properties: { n: k } }))),
    )
  }

  /** Plan de preparación: one polygon per chosen belt tile and per programme sector (tileRing). */
  function updatePlan() {
    if (!ready.current) return
    const { data, scenario } = p.current
    const poly = (t: number): Feature => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [tileRing(data.grid, PLAN_TILE_CELLS, t)] }, properties: {} })
    src('plan-tiles')?.setData(fc(scenario.planTiles.map(poly)))
    src('plan-sectors')?.setData(fc(scenario.planSectors.map(poly)))
  }

  function setVis(id: string, on: boolean) {
    const map = mapRef.current
    if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }

  function updateVisibility() {
    const L = p.current.layers
    setVis('fire', L.fuego)
    setVis('domain-edge', L.fuego)
    setVis('fuel', L.combustible)
    setVis('scar', L.cicatriz)
    setVis('pop', L.poblacion)
    setVis('roads', L.calles)
    setVis('roads-closed', L.calles)
    setVis('links', L.calles)
    setVis('links-pt', L.calles)
    setVis('bld-all', L.viviendas)
    setVis('bld-status', L.viviendas)
    for (const id of ['brig-cuts', 'brig-routes', 'brig-sites', 'brig-stations']) setVis(id, L.bomberos)
    setVis('safe', L.zonasSeguras)
    setVis('firebreaks', L.cortafuegos)
    setVis('firebreaks-casing', L.cortafuegos)
    setVis('firms', L.firms)
    for (const id of ['plan-tiles-fill', 'plan-tiles-line', 'plan-sectors-line']) setVis(id, L.plan)
  }

  function updateTerrain() {
    const map = mapRef.current
    if (!map || !ready.current || p.current.offline) return
    if (p.current.terrain3d) {
      map.setTerrain({ source: 'dem-terrain', exaggeration: 1.5 })
      map.easeTo({ pitch: 60, duration: 800 })
    } else {
      map.setTerrain(null)
      map.easeTo({ pitch: 0, duration: 600 })
    }
  }

  function syncAll() {
    updateClockState()
    updateFire()
    updateEdge()
    updatePopulation()
    updateRoads()
    updateLinks()
    updateBuildings()
    updateSafe()
    updateFirebreaks()
    updateDraft()
    updateIgnitions()
    updateBrigades()
    updatePlan()
    updateVisibility()
    updateTerrain()
  }

  // ---------------------------------------------------------------- layers
  function setupLayers(map: MlMap) {
    performance.mark('cf:style')
    const { data } = p.current
    const g = data.grid
    const corners = gridCorners(g)
    map.setGlobalStateProperty('clock', 0)
    map.setGlobalStateProperty('routes', false)
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id

    if (fallback.current) {
      drawHillshade(canvases.current.hill, g, data.elevation, data.fuel)
      map.addSource('hill', { type: 'canvas', canvas: canvases.current.hill, coordinates: corners, animate: false })
      map.addLayer({ id: 'hill', type: 'raster', source: 'hill', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } }, firstSymbol)
    }
    if (!p.current.offline) {
      map.addSource('dem-terrain', { type: 'raster-dem', tiles: [TERRARIUM], encoding: 'terrarium', tileSize: 256, maxzoom: 15 })
      map.addSource('dem-hillshade', { type: 'raster-dem', tiles: [TERRARIUM], encoding: 'terrarium', tileSize: 256, maxzoom: 15 })
      map.addLayer(
        {
          id: 'hillshade',
          type: 'hillshade',
          source: 'dem-hillshade',
          paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#1b2230', 'hillshade-highlight-color': '#ffffff' },
        },
        firstSymbol,
      )
    }

    drawFuel(canvases.current.fuel, g, data.fuel)
    map.addSource('fuel', { type: 'canvas', canvas: canvases.current.fuel, coordinates: corners, animate: false })
    map.addLayer({ id: 'fuel', type: 'raster', source: 'fuel', paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, firstSymbol)

    if (data.population) drawPopulation(canvases.current.pop, g, data.population.home, data.population.work, p.current.awayNow)
    map.addSource('pop', { type: 'canvas', canvas: canvases.current.pop, coordinates: corners, animate: false })
    map.addLayer({ id: 'pop', type: 'raster', source: 'pop', paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, firstSymbol)

    drawScar(canvases.current.scar, g, data.scar)
    map.addSource('scar', { type: 'canvas', canvas: canvases.current.scar, coordinates: corners, animate: false })

    drawFire(canvases.current.fire, g, null, null, 0)
    map.addSource('fire', { type: 'canvas', canvas: canvases.current.fire, coordinates: corners, animate: false })
    map.addLayer({ id: 'fire', type: 'raster', source: 'fire', paint: { 'raster-resampling': 'nearest', 'raster-opacity': 0.9, 'raster-fade-duration': 0 } }, firstSymbol)
    map.addLayer({ id: 'scar', type: 'raster', source: 'scar', paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, firstSymbol)

    const empty = fc([])
    for (const id of ['roads', 'links', 'bld-all', 'bld-status', 'safe', 'firebreaks', 'draft', 'ignitions', 'firms', 'brig-cuts', 'brig-routes', 'brig-sites', 'brig-stations', 'plan-tiles', 'plan-sectors', 'domain-edge'])
      map.addSource(id, { type: 'geojson', data: empty })
    // The simulated area (the grid): the base map goes on beyond it, the fire model does not.
    map.addSource('domain', {
      type: 'geojson',
      data: fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [...corners, corners[0]] }, properties: {} }]),
    })

    // Plan de preparación: the tile tint goes under the fire, the outlines under the streets.
    map.addLayer({ id: 'plan-tiles-fill', type: 'fill', source: 'plan-tiles', paint: { 'fill-color': '#a3e635', 'fill-opacity': 0.12 } }, 'fire')
    map.addLayer({ id: 'plan-tiles-line', type: 'line', source: 'plan-tiles', paint: { 'line-color': '#a3e635', 'line-width': 1.2, 'line-opacity': 0.8 } })
    map.addLayer({
      id: 'plan-sectors-line',
      type: 'line',
      source: 'plan-sectors',
      paint: { 'line-color': '#c4b5fd', 'line-width': 1.6, 'line-opacity': 0.9, 'line-dasharray': [2, 1.5] },
    })

    // MapLibre's tile workers may evaluate a layer before they receive the global state (null for a moment);
    // to-number keeps that first pass quiet, and the state change that follows re-evaluates every tile.
    const clock = ['to-number', ['global-state', 'clock'], 0] as const
    const closedByFire = ['<=', ['get', 't'], clock]
    const routed = ['all', ['==', ['global-state', 'routes'], true], ['>', ['get', 'f'], 0.5]]
    const clsW = ['match', ['get', 'cls'], 0, 2.2, 1, 1.8, 2, 1.5, 3, 1.2, 4, 0.8, 0.5]
    const flowW = ['case', routed, ['min', 7, ['*', 0.9, ['sqrt', ['get', 'f']]]], 0]
    map.addLayer({
      id: 'roads',
      type: 'line',
      source: 'roads',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'x'], 1],
          '#5a2a2a',
          closedByFire,
          '#4a4f5c',
          routed,
          ['interpolate', ['linear'], ['get', 'f'], 0.5, '#38bdf8', 20, '#0284c7', 150, '#1e3a8a'],
          '#5d6880',
        ] as never,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['+', ['*', 0.6, clsW], flowW], 16, ['+', ['*', 2.2, clsW], ['*', 1.6, flowW]]] as never,
        'line-opacity': ['case', closedByFire, 0.6, routed, 0.95, 0.5] as never,
      },
    })
    map.addLayer({
      id: 'roads-closed',
      type: 'line',
      source: 'roads',
      filter: ['==', ['get', 'x'], 1],
      paint: { 'line-color': '#ff4d4f', 'line-width': 3.5, 'line-dasharray': [1.5, 1.2] },
    })
    map.addLayer({
      id: 'links',
      type: 'line',
      source: 'links',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': '#38bdf8', 'line-width': 4, 'line-dasharray': [1, 0.8] },
    })
    map.addLayer({
      id: 'links-pt',
      type: 'circle',
      source: 'links',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 8, 'circle-color': 'rgba(56,189,248,0.25)', 'circle-stroke-color': '#38bdf8', 'circle-stroke-width': 2 },
    })
    // Firebreak width in metres at latitude ~33 S (metres per pixel = 131290 / 2^zoom), at least 3 px.
    const fbWidth = (extra: number) =>
      [
        'interpolate',
        ['exponential', 2],
        ['zoom'],
        9,
        ['+', extra, ['max', 3, ['*', ['get', 'w'], 512 / 131290]]],
        18,
        ['+', extra, ['max', 3, ['*', ['get', 'w'], 262144 / 131290]]],
      ] as never
    map.addLayer({
      id: 'firebreaks-casing',
      type: 'line',
      source: 'firebreaks',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2a1d04', 'line-opacity': 0.75, 'line-width': fbWidth(3) },
    })
    map.addLayer({
      id: 'firebreaks',
      type: 'line',
      source: 'firebreaks',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fbbf24', 'line-opacity': 0.95, 'line-width': fbWidth(0) },
    })
    const bldRadius = ['interpolate', ['linear'], ['zoom'], 12.5, 1.2, 15, 2.6, 17, 4.5] as never
    map.addLayer({
      id: 'bld-all',
      type: 'circle',
      source: 'bld-all',
      minzoom: 12.5,
      paint: { 'circle-radius': bldRadius, 'circle-color': '#8b93a1', 'circle-opacity': 0.55 },
    })
    map.addLayer({
      id: 'bld-status',
      type: 'circle',
      source: 'bld-status',
      minzoom: 10,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1, 13, 2, 15, 3, 17, 5] as never,
        'circle-color': ['match', ['get', 's'], HOUSEHOLD.SAFE, '#4ade80', HOUSEHOLD.AT_RISK, '#fbbf24', HOUSEHOLD.TRAPPED, '#ef4444', '#8b93a1'] as never,
        'circle-opacity': 0.9,
      },
    })
    map.addLayer({
      id: 'safe',
      type: 'circle',
      source: 'safe',
      minzoom: 10.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 15, 4] as never,
        'circle-color': '#22c55e',
        'circle-opacity': 0.35,
        'circle-stroke-color': '#86efac',
        'circle-stroke-width': 0.6,
      },
    })
    map.addLayer({
      id: 'firms',
      type: 'circle',
      source: 'firms',
      filter: ['<=', ['get', 't'], clock] as never,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5] as never,
        'circle-color': 'rgba(255, 64, 160, 0.2)',
        'circle-stroke-color': '#ff4fa3',
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.8,
      },
    })
    map.addLayer({
      id: 'draft-line',
      type: 'line',
      source: 'draft',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': '#f4d35e', 'line-width': 3, 'line-dasharray': [2, 1] },
    })
    map.addLayer({
      id: 'draft-pt',
      type: 'circle',
      source: 'draft',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 4.5, 'circle-color': '#f4d35e', 'circle-stroke-color': '#10141c', 'circle-stroke-width': 1.5 },
    })
    map.addLayer({
      id: 'ignitions',
      type: 'circle',
      source: 'ignitions',
      paint: {
        'circle-radius': 7,
        'circle-color': ['case', ['==', ['get', 'on'], 1], ['case', ['==', ['get', 'user'], 1], '#ff8c42', '#ff3d2e'], 'rgba(0,0,0,0)'] as never,
        'circle-stroke-color': ['case', ['==', ['get', 'on'], 1], '#ffffff', '#9aa4b5'] as never,
        'circle-stroke-width': 2,
      },
    })

    // Firefighters: historical cuts, unit routes, work sites, cuarteles and reinforcement entries.
    map.addLayer({ id: 'brig-cuts', type: 'line', source: 'brig-cuts', paint: { 'line-color': '#ef4444', 'line-width': 5, 'line-opacity': 0.85, 'line-dasharray': [1, 1] } })
    map.addLayer({ id: 'brig-routes', type: 'line', source: 'brig-routes', paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-opacity': 0.85 } })
    map.addLayer({
      id: 'brig-sites',
      type: 'circle',
      source: 'brig-sites',
      paint: { 'circle-radius': ['min', 14, ['+', 5, ['get', 'n']]] as never, 'circle-color': 'rgba(56, 189, 248, 0.25)', 'circle-stroke-color': '#38bdf8', 'circle-stroke-width': 2 },
    })
    map.addLayer({
      id: 'brig-stations',
      type: 'circle',
      source: 'brig-stations',
      paint: {
        'circle-radius': 5,
        'circle-color': ['case', ['==', ['get', 'entry'], 1], '#a78bfa', '#38bdf8'] as never,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    })

    // Outline of the simulated area, always on; the stretch the fire reaches, from its arrival time, in orange.
    // A light casing under a dark dash: visible on the light base map and on the dark offline hillshade.
    map.addLayer({ id: 'domain-casing', type: 'line', source: 'domain', paint: { 'line-color': '#f8fafc', 'line-width': 4, 'line-opacity': 0.7 } })
    map.addLayer({
      id: 'domain',
      type: 'line',
      source: 'domain',
      paint: { 'line-color': '#0f172a', 'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': [4, 3] },
    })
    map.addLayer({
      id: 'domain-edge',
      type: 'line',
      source: 'domain-edge',
      filter: ['<=', ['get', 't'], clock] as never,
      layout: { 'line-cap': 'square' },
      paint: { 'line-color': '#fb923c', 'line-width': 5, 'line-opacity': 0.95 },
    })

    // Static data
    roadGeoms.current = data.roads.edges.map((e, i) => ({
      type: 'LineString',
      coordinates: data.roads.geoms ? data.roads.geoms[i] : [data.roads.nodes[e[0]], data.roads.nodes[e[1]]],
    }))
    const b = data.buildings
    const all: [number, number][] = new Array(b.length / 3)
    for (let k = 0; k < all.length; k++) all[k] = [b[k * 3], b[k * 3 + 1]]
    src('bld-all')?.setData(fc([{ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: all }, properties: {} }]))
    src('firms')?.setData(
      fc(
        data.firms.map((f) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
          properties: { t: localToMin(data.grid.t0, f.timeLocal), sat: f.satellite, frp: f.frp },
        })),
      ),
    )
    ready.current = true
    syncAll()
    performance.mark('cf:setup')
  }

  // ---------------------------------------------------------------- map lifecycle
  useEffect(() => {
    if (!el.current) return
    const { data } = p.current
    const offline = p.current.offline
    fallback.current = offline
    if (offline) p.current.onNote('style', 'Modo sin conexión: sin mapa base ni 3D; el relieve se calcula con los datos de elevación.')
    // Leave room for the layers card (left) and the time bar (bottom) on wide screens; on phones, for the layers
    // button (top), the zoom buttons (right) and the bottom sheet over the map.
    const fitPadding = () =>
      window.innerWidth >= 900
        ? { top: 20, bottom: 110, left: 270, right: 20 }
        : { top: 52, bottom: p.current.padBottom + 12, left: 10, right: 48 }
    const map = new maplibregl.Map({
      container: el.current,
      style: offline ? FALLBACK_STYLE : BASE_STYLE_URL,
      bounds: gridBounds(data.grid),
      fitBoundsOptions: { padding: fitPadding() },
      maxPitch: 75,
      attributionControl: { compact: true },
      // MapLibre's own controls and the map region, in the app's language (keys: maplibre-gl default_locale)
      locale: {
        'Map.Title': 'Mapa del escenario',
        'NavigationControl.ZoomIn': 'Acercar',
        'NavigationControl.ZoomOut': 'Alejar',
        'NavigationControl.ResetBearing': 'Arrastra para rotar el mapa; clic para volver al norte',
        'AttributionControl.ToggleAttribution': 'Mostrar u ocultar la atribución',
        'Popup.Close': 'Cerrar',
      },
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map: MlMap }).__map = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    let styleOk = false
    const goFallback = (why: string) => {
      if (styleOk || fallback.current) return
      fallback.current = true
      p.current.onNote('style', `No se pudo cargar el mapa base (${why}). Se muestra un relieve calculado con los datos de elevación.`)
      map.setStyle(FALLBACK_STYLE)
    }
    const timer = window.setTimeout(() => goFallback('tiempo de espera agotado'), 10000)
    // The container can still be laid out (or hidden) when the map is built, which leaves a tiny canvas and a
    // country-wide zoom. Follow the container's size, and re-fit the grid until the user moves the map.
    let userMoved = false
    map.on('movestart', (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) userMoved = true
    })
    const refit = () => {
      map.resize()
      if (!userMoved) map.fitBounds(gridBounds(data.grid), { padding: fitPadding(), duration: 0 })
    }
    refitRef.current = refit
    const resizeObserver = new ResizeObserver(refit)
    resizeObserver.observe(el.current)
    map.on('style.load', () => {
      refit()
      styleOk = true
      window.clearTimeout(timer)
      ready.current = false
      setupLayers(map)
    })
    map.on('error', (e) => {
      const err = e as unknown as { error?: Error; sourceId?: string }
      const msg = err.error?.message ?? 'error desconocido'
      if (!styleOk) {
        goFallback(msg)
        return
      }
      if (err.sourceId === 'dem-terrain' || err.sourceId === 'dem-hillshade') {
        p.current.onNote('dem', 'No se pudo cargar parte del relieve (AWS Terrain Tiles).')
        return
      }
      console.error('Mapa:', err.sourceId ?? '', msg)
      if (err.sourceId) p.current.onNote('tiles', 'Parte del mapa base no se pudo cargar (revisa la conexión).')
    })

    map.on('click', (e: MapMouseEvent) => onClick(map, e))
    // A fire start can be clicked (to remove it) when no tool is on.
    map.on('mouseenter', 'ignitions', () => {
      if (p.current.tool === 'none') map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'ignitions', () => {
      if (p.current.tool === 'none') map.getCanvas().style.cursor = ''
    })
    map.on('dblclick', (e: MapMouseEvent) => {
      if (p.current.tool === 'firebreak') {
        e.preventDefault()
        finishFirebreak(map)
      }
    })
    return () => {
      window.clearTimeout(timer)
      resizeObserver.disconnect()
      refitRef.current = null
      ready.current = false
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.data])

  // ---------------------------------------------------------------- tools
  function nearestNode(lon: number, lat: number): number {
    const nodes = p.current.data.roads.nodes
    const kx = Math.cos((lat * Math.PI) / 180)
    let best = -1
    let bd = Infinity
    for (let i = 0; i < nodes.length; i++) {
      const dx = (nodes[i][0] - lon) * kx
      const dy = nodes[i][1] - lat
      const d = dx * dx + dy * dy
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  function finishFirebreak(map: MlMap) {
    // A double click also fires two clicks: drop consecutive points closer than 5 px.
    const pts: [number, number][] = []
    for (const q of draft.current) {
      const last = pts[pts.length - 1]
      if (last) {
        const a = map.project(last)
        const b = map.project(q)
        if (Math.hypot(a.x - b.x, a.y - b.y) < 5) continue
      }
      pts.push(q)
    }
    draft.current = []
    updateDraft()
    if (pts.length >= 2) p.current.onFirebreak(pts)
  }

  /** With no tool on, a click on a fire start opens a popup that removes it (an added one) or turns it off or on (a
   *  preset). Returns whether the click hit one. */
  function ignitionPopup(map: MlMap, e: MapMouseEvent, tol: number): boolean {
    if (!map.getLayer('ignitions')) return false
    const r = 9 * tol
    const hits = map.queryRenderedFeatures(
      [
        [e.point.x - r, e.point.y - r],
        [e.point.x + r, e.point.y + r],
      ],
      { layers: ['ignitions'] },
    )
    let best: (typeof hits)[number] | null = null
    let bd = Infinity
    for (const f of hits) {
      if (f.geometry.type !== 'Point') continue
      const q = map.project(f.geometry.coordinates as [number, number])
      const d = Math.hypot(q.x - e.point.x, q.y - e.point.y)
      if (d < bd) {
        bd = d
        best = f
      }
    }
    if (!best || best.geometry.type !== 'Point') return false
    const { id, on, user, t } = best.properties as { id: string; on: number; user: number; t: number }
    const { data } = p.current
    const preset = user ? null : data.ignitions.find((g) => g.id === id)
    const el = document.createElement('div')
    const title = document.createElement('div')
    title.className = 'pp-title'
    title.textContent = user ? 'Foco agregado' : (preset?.label ?? 'Foco predefinido')
    const row = document.createElement('div')
    row.className = 'pp-row'
    row.textContent = `Empieza a las ${minToHHMM(data.grid.t0, t)}${!user && !on ? ' · desactivado' : ''}`
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn small pp-action'
    btn.textContent = user ? 'Quitar foco' : on ? 'Desactivar foco' : 'Activar foco'
    btn.addEventListener('click', () => {
      popup.current?.remove()
      if (user) p.current.onRemoveIgnition(id)
      else p.current.onTogglePresetIgnition(id, !on)
    })
    el.append(title, row, btn)
    popup.current?.remove()
    popup.current = new maplibregl.Popup({ closeButton: true, className: 'household-popup', maxWidth: '260px' })
      .setLngLat(best.geometry.coordinates as [number, number])
      .setDOMContent(el)
      .addTo(map)
    return true
  }

  function onClick(map: MlMap, e: MapMouseEvent) {
    const { tool } = p.current
    // A fingertip lands 7-12 px from where it aims, and houses and streets are 1-2 px wide at the fitted zoom.
    const tol = window.matchMedia(COARSE_QUERY).matches ? 2.5 : 1
    const { lng, lat } = e.lngLat
    if (tool === 'none') {
      if (ignitionPopup(map, e, tol)) return
      // Household detail
      if (!map.getLayer('bld-status')) return
      const r = 5 * tol
      const hit = map.queryRenderedFeatures(
        [
          [e.point.x - r, e.point.y - r],
          [e.point.x + r, e.point.y + r],
        ],
        { layers: ['bld-status'] },
      )[0]
      if (!hit) return
      // Nearest threatened household to the click (the layer holds one MultiPoint per status).
      const { data, evac } = p.current
      if (!evac) return
      const b = data.buildings
      const kx = Math.cos((lat * Math.PI) / 180)
      let best = -1
      let bd = Infinity
      for (const k of affected.current) {
        const dx = (b[k * 3] - lng) * kx
        const dy = b[k * 3 + 1] - lat
        const d = dx * dx + dy * dy
        if (d < bd) {
          bd = d
          best = k
        }
      }
      if (best < 0) return
      const q = map.project([b[best * 3], b[best * 3 + 1]])
      if (Math.hypot(q.x - e.point.x, q.y - e.point.y) > 10 * tol) return
      const status = evac.householdStatus[best]
      const risk = evac.householdRisk[best]
      popup.current?.remove()
      popup.current = new maplibregl.Popup({ closeButton: true, className: 'household-popup', maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="pp-title">${STATUS_LABEL[status] ?? 'Vivienda'}</div>` +
            `<div class="pp-row">Probabilidad de no alcanzar a salir: <b>${Math.round(risk * 100)}&nbsp;%</b></div>` +
            `<div class="pp-note">Resultado de este escenario, no una predicción.</div>`,
        )
        .addTo(map)
    } else if (tool === 'ignition') {
      p.current.onAddIgnition(lng, lat)
    } else if (tool === 'firebreak') {
      draft.current = [...draft.current, [lng, lat]]
      updateDraft()
    } else if (tool === 'closeRoad') {
      const r = 8 * tol
      const feats = map.queryRenderedFeatures(
        [
          [e.point.x - r, e.point.y - r],
          [e.point.x + r, e.point.y + r],
        ],
        { layers: ['roads'] },
      )
      if (feats.length === 0) {
        p.current.onNote('tool', 'No hay una calle en ese punto: acerca el mapa y elige la calle.')
        return
      }
      // Pick the feature whose geometry passes closest to the click.
      let best = feats[0]
      let bd = Infinity
      for (const f of feats) {
        const g = f.geometry
        if (g.type !== 'LineString') continue
        for (const c of g.coordinates) {
          const q = map.project(c as [number, number])
          const d = Math.hypot(q.x - e.point.x, q.y - e.point.y)
          if (d < bd) {
            bd = d
            best = f
          }
        }
      }
      p.current.onNote('tool', null)
      p.current.onToggleEdge(best.properties.e as number)
    } else if (tool === 'link') {
      const node = nearestNode(lng, lat)
      if (node < 0) return
      const q = map.project(p.current.data.roads.nodes[node] as [number, number])
      if (Math.hypot(q.x - e.point.x, q.y - e.point.y) > 30) {
        p.current.onNote('tool', 'Elige un punto más cerca de una calle (acerca el mapa si hace falta).')
        return
      }
      p.current.onNote('tool', null)
      if (linkStart.current === null) {
        linkStart.current = node
        p.current.onLinkStart(node)
      } else {
        const u = linkStart.current
        linkStart.current = null
        p.current.onLinkStart(null)
        if (u !== node) p.current.onAddLink(u, node)
        else p.current.onNote('tool', 'Elige dos puntos distintos de la red de calles.')
      }
      updateLinks()
    }
  }

  // ---------------------------------------------------------------- prop -> map sync
  useEffect(updateFire, [props.fire, props.clock])
  useEffect(updateEdge, [props.edge])
  // The away share only changes during the morning and evening ramps: redraw when it moves by 0.5 points.
  useEffect(updatePopulation, [Math.round(props.awayNow * 200)])
  useEffect(updateClockState, [Math.floor(props.clock / CLOCK_STEP_MIN), props.showRoutes])
  useEffect(updateRoads, [props.evac, props.scenario.closedEdges])
  useEffect(updateBuildings, [props.evac])
  useEffect(updateSafe, [props.safe])
  useEffect(updateFirebreaks, [props.scenario.firebreaks])
  useEffect(updateIgnitions, [props.scenario.presetIgnitions, props.scenario.userIgnitions])
  useEffect(updateLinks, [props.scenario.addedLinks])
  useEffect(updateBrigades, [props.brigades, props.scenario.brigades.enabled])
  useEffect(updatePlan, [props.scenario.planTiles, props.scenario.planSectors])
  useEffect(updateVisibility, [props.layers])
  useEffect(updateTerrain, [props.terrain3d])
  // The sheet's height is known only after it lays out: fit the grid above it again (until the user moves the map).
  useEffect(() => refitRef.current?.(), [props.padBottom])
  // Declared before the tool effect below: "Guardar" saves the draft and leaves the tool in the same render, and
  // leaving the tool discards whatever draft is left.
  useEffect(() => {
    const map = mapRef.current
    if (map && props.finishFirebreak > 0) finishFirebreak(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.finishFirebreak])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = props.tool === 'none' ? '' : 'crosshair'
    if (props.tool === 'firebreak') map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
    if (props.tool !== 'firebreak' && draft.current.length) {
      draft.current = []
      updateDraft()
    }
    if (props.tool !== 'link' && linkStart.current !== null) {
      linkStart.current = null
      props.onLinkStart(null)
      updateLinks()
    }
    if (props.tool !== 'firebreak') return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') finishFirebreak(map)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tool])

  return <div ref={el} className="map" />
}
