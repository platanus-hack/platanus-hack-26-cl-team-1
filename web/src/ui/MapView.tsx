import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { CanvasSource, GeoJSONSource, Map as MlMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Dataset } from '../data/load'
import { gridBounds, gridCorners } from '../data/grid'
import { localToMin } from '../data/time'
import type { EvacOut, FireOut } from '../worker/protocol'
import type { Scenario } from '../worker/scenario'
import { HOUSEHOLD } from '../engine/types'
import { drawFire, drawFuel, drawHillshade, drawScar } from './overlays'
import type { Feature, FeatureCollection, LineString, SetDataArg } from './geo'

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
  evac: EvacOut | null
  safe: Uint8Array | null
  clock: number
  layers: LayerToggles
  showRoutes: boolean
  terrain3d: boolean
  /** No network map services: start on the hillshade computed from elevation.bin, no base map, no 3D. */
  offline: boolean
  scenario: Scenario
  tool: Tool
  onAddIgnition: (lon: number, lat: number) => void
  onFirebreak: (points: [number, number][]) => void
  onToggleEdge: (edge: number) => void
  onAddLink: (u: number, v: number) => void
  onLinkStart: (node: number | null) => void
  onNote: (key: string, note: string | null) => void
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
  const linkStart = useRef<number | null>(null)
  const canvases = useRef({
    fire: document.createElement('canvas'),
    fuel: document.createElement('canvas'),
    scar: document.createElement('canvas'),
    hill: document.createElement('canvas'),
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
  }

  function updateIgnitions() {
    const { data, scenario } = p.current
    const on = new Set(scenario.presetIgnitions)
    const feats: Feature[] = data.ignitions.map((g) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [g.lon, g.lat] },
      properties: { on: on.has(g.id) ? 1 : 0, t: localToMin(data.grid.t0, g.timeLocal) },
    }))
    for (const u of scenario.userIgnitions)
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [u.lon, u.lat] }, properties: { on: 1, user: 1, t: u.tMin } })
    src('ignitions')?.setData(fc(feats))
  }

  function setVis(id: string, on: boolean) {
    const map = mapRef.current
    if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }

  function updateVisibility() {
    const L = p.current.layers
    setVis('fire', L.fuego)
    setVis('fuel', L.combustible)
    setVis('scar', L.cicatriz)
    setVis('roads', L.calles)
    setVis('roads-closed', L.calles)
    setVis('links', L.calles)
    setVis('links-pt', L.calles)
    setVis('bld-all', L.viviendas)
    setVis('bld-status', L.viviendas)
    setVis('safe', L.zonasSeguras)
    setVis('firebreaks', L.cortafuegos)
    setVis('firebreaks-casing', L.cortafuegos)
    setVis('firms', L.firms)
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
    updateRoads()
    updateLinks()
    updateBuildings()
    updateSafe()
    updateFirebreaks()
    updateDraft()
    updateIgnitions()
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

    drawScar(canvases.current.scar, g, data.scar)
    map.addSource('scar', { type: 'canvas', canvas: canvases.current.scar, coordinates: corners, animate: false })

    drawFire(canvases.current.fire, g, null, null, 0)
    map.addSource('fire', { type: 'canvas', canvas: canvases.current.fire, coordinates: corners, animate: false })
    map.addLayer({ id: 'fire', type: 'raster', source: 'fire', paint: { 'raster-resampling': 'nearest', 'raster-opacity': 0.9, 'raster-fade-duration': 0 } }, firstSymbol)
    map.addLayer({ id: 'scar', type: 'raster', source: 'scar', paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, firstSymbol)

    const empty = fc([])
    for (const id of ['roads', 'links', 'bld-all', 'bld-status', 'safe', 'firebreaks', 'draft', 'ignitions', 'firms'])
      map.addSource(id, { type: 'geojson', data: empty })

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
    // leave room for the layers card (left) and the time bar (bottom) on wide screens
    const fitPadding = () => (window.innerWidth >= 900 ? { top: 20, bottom: 90, left: 270, right: 20 } : 10)
    const map = new maplibregl.Map({
      container: el.current,
      style: offline ? FALLBACK_STYLE : BASE_STYLE_URL,
      bounds: gridBounds(data.grid),
      fitBoundsOptions: { padding: fitPadding() },
      maxPitch: 75,
      attributionControl: { compact: true },
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
    map.on('dblclick', (e: MapMouseEvent) => {
      if (p.current.tool === 'firebreak') {
        e.preventDefault()
        finishFirebreak(map)
      }
    })
    return () => {
      window.clearTimeout(timer)
      resizeObserver.disconnect()
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

  function onClick(map: MlMap, e: MapMouseEvent) {
    const { tool } = p.current
    const { lng, lat } = e.lngLat
    if (tool === 'none') {
      // Household detail
      if (!map.getLayer('bld-status')) return
      const r = 5
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
      if (Math.hypot(q.x - e.point.x, q.y - e.point.y) > 10) return
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
      const r = 8
      const feats = map.queryRenderedFeatures(
        [
          [e.point.x - r, e.point.y - r],
          [e.point.x + r, e.point.y + r],
        ],
        { layers: ['roads'] },
      )
      if (feats.length === 0) {
        p.current.onNote('tool', 'No hay una calle bajo el clic: acerca el mapa y haz clic sobre la calle.')
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
        p.current.onNote('tool', 'Haz clic más cerca de una calle (acerca el mapa si hace falta).')
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
  useEffect(updateClockState, [Math.floor(props.clock / CLOCK_STEP_MIN), props.showRoutes])
  useEffect(updateRoads, [props.evac, props.scenario.closedEdges])
  useEffect(updateBuildings, [props.evac])
  useEffect(updateSafe, [props.safe])
  useEffect(updateFirebreaks, [props.scenario.firebreaks])
  useEffect(updateIgnitions, [props.scenario.presetIgnitions, props.scenario.userIgnitions])
  useEffect(updateLinks, [props.scenario.addedLinks])
  useEffect(updateVisibility, [props.layers])
  useEffect(updateTerrain, [props.terrain3d])
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
