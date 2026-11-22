import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EVENTS, eventOfTimeline } from '../data/events'
import { makeMockDataset } from '../data/mock'
import { POPULATION_DAY, TIMELINE, type TimelineId } from '../engine/types'
import { buildWeatherSeries, noBrigades, type Scenario } from '../worker/scenario'
import { FirebreakEmberRange } from './FirebreakEmberRange'
import { LayersCard } from './LayersCard'
import type { LayerToggles } from './MapView'
import { Panel } from './Panel'
import { SourcesModal } from './SourcesModal'

const base = makeMockDataset()
const noop = () => {}
const layers: LayerToggles = {
  fuego: true, viviendas: true, calles: true, zonasSeguras: true, cortafuegos: true,
  firms: true, cicatriz: true, combustible: true, bomberos: true, poblacion: true, plan: true,
}
const scenario: Scenario = {
  weather: { mode: 'real', windFactor: 1, windDirOffsetDeg: 0, rhOffset: 0, tempOffsetC: 0, windKmh: 20, windFromDeg: 200, rh: 50, tempC: 25 },
  droughtFactor: 10, spotting: true, spotMetresPerKmh: 25,
  presetIgnitions: base.ignitions.map((g) => g.id), userIgnitions: [], firebreaks: [],
  alertMin: base.defaultAlertMin, cueShare: 0.65, cueRadiusM: 900, prepMedianMin: 10, footShare: 0.5,
  closedEdges: [], addedLinks: [], brigades: noBrigades(), planTiles: [], planSectors: [],
}
const series = buildWeatherSeries(base.weather, base.grid.t0, scenario.weather, base.windDirCorrectionDeg).series
const forbidden = /bomberos?|firefighters?|firefighting|combate\s+(?:del?\s+)?fuego|rescate/i

function props(timeline: TimelineId): Parameters<typeof Panel>[0] {
  return {
    data: { ...base, timeline, event: EVENTS[eventOfTimeline(timeline)] }, scenario,
    update: noop, resetScenario: noop, updateWeather: noop, clock: 360, tool: 'none', setTool: noop,
    fire: null, evac: null, brigadesOut: null, edge: null, burnedHaNow: 0,
    summary: { burnedHaEnd: 0, buildingsReached: 0, trappedHouseholds: 0, trappedPeople: 0, peopleReached: 0 },
    baseline: null, setBaseline: noop, emberRange: null, timings: null, busy: false, simError: null,
    rawSeries: series, appliedSeries: series, weatherNotes: [], firebreakWidth: 60, setFirebreakWidth: noop,
    layers, setLayer: noop, showRoutes: false, setShowRoutes: noop, linkStart: null, firmsShown: 0,
    people: { present: 0, residents: 0, awayAtFirstArrival: 0 }, awayNow: 0,
    populationDay: POPULATION_DAY.REAL, setPopulationDay: noop,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('frontend presentation scope', () => {
  it.each(Object.values(TIMELINE))('hides optional response controls and copy for %s', (timeline) => {
    const p = props(timeline)
    for (const enabled of [false, true]) {
      const html = renderToStaticMarkup(<Panel {...p} scenario={{ ...scenario, brigades: { ...scenario.brigades, enabled } }} />)
      expect(html.replace(/\s+/g, ' ')).not.toMatch(forbidden)
      expect(html).toContain('techo de exposición')
      expect(html).toContain('class="stat-sub population-note"')
    }
    expect(renderToStaticMarkup(<SourcesModal data={p.data} onClose={noop} />)).not.toMatch(forbidden)
  })

  it('does not expose the hidden map layer even with a legacy enabled toggle', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const html = renderToStaticMarkup(<LayersCard layers={layers} setLayer={noop} showRoutes={false} />)
    expect(html).not.toMatch(forbidden)
    expect(html).toContain('Capas y leyenda')
  })

  it('keeps the firebreak explanation focused on ember reach', () => {
    const html = renderToStaticMarkup(<FirebreakEmberRange range={{ rows: null, error: null }} cellM={60} own={25} />)
    expect(html).not.toMatch(forbidden)
    expect(html).toContain('Las pavesas cruzan un cortafuego')
  })
})
