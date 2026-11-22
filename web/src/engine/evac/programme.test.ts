// Community preparation programme (EvacInput.programme): programme households use their own preparation
// median and cue share. On the synthetic dataset, a run with a programme must be exactly the member-wise
// mix of two full runs (everyone default, everyone in the programme), and riskByAlert must agree with that
// mix computed from full runs at each alert time.
import { describe, expect, it } from 'vitest'
import { FUEL, type EvacParams, type EvacPrepared, type EvacProgramme } from '../types'
import { makeMockDataset } from '../../data/mock'
import { buildBelt, programmeFor, PLAN_PROGRAMME } from '../plan'
import { DEFAULT_EVAC_PARAMS, prepareEvac, simulateEvac } from './index'

const NO_EDITS = { closedEdges: [], addedLinks: [] }
const PROG = { prepMedianMin: PLAN_PROGRAMME.prepMedianMin, cueShare: PLAN_PROGRAMME.cueShare }

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

let cached: { prepared: EvacPrepared; arrival: Float32Array; programme: EvacProgramme; nB: number } | null = null

/** The synthetic dataset, a synthetic fire from the first synthetic ignition (50 m/min, noisy, out to 10 km)
 *  and a programme covering every other sector of the synthetic plan. */
function setup() {
  if (cached) return cached
  const d = makeMockDataset()
  const g = d.grid
  const prepared = prepareEvac(g, d.fuel, d.roads, d.buildings, { safeDistanceM: DEFAULT_EVAC_PARAMS.safeDistanceM })
  const ign = d.ignitions[0]
  const rand = rng(7)
  const arrival = new Float32Array(g.rows * g.cols).fill(Infinity)
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c
      if (d.fuel[i] === FUEL.NONE) continue
      const lon = g.lonMin + (c + 0.5) * g.dLon
      const lat = g.latMax - (r + 0.5) * g.dLat
      const dist = Math.hypot(((lon - ign.lon) / g.dLon) * g.cellM, ((lat - ign.lat) / g.dLat) * g.cellM)
      if (dist > 10_000) continue
      arrival[i] = 140 + dist / 50 + rand() * 10
    }
  const belt = buildBelt(g, d.fuel, d.buildings)
  const sectors = d.plan!.sectors.filter((_, k) => k % 2 === 0).map((s) => s.sector)
  const programme = programmeFor(belt, sectors)!
  cached = { prepared, arrival, programme, nB: d.buildings.length / 3 }
  return cached
}

const params = (p: Partial<EvacParams> = {}): EvacParams => ({ ...DEFAULT_EVAC_PARAMS, ...p })

describe('preparation programme in simulateEvac', () => {
  it('the setup exercises both groups, cued and uncued households', () => {
    const { prepared, arrival, programme, nB } = setup()
    let members = 0
    for (const m of programme.member) members += m
    expect(programme.member.length).toBe(nB)
    expect(members).toBeGreaterThan(0.1 * nB)
    expect(members).toBeLessThan(0.9 * nB)
    const r = simulateEvac({ prepared, arrivalMin: arrival, params: params({ alertMin: 270 }), edits: NO_EDITS })
    expect(r.buildingsReached).toBeGreaterThan(0.1 * nB)
    expect(r.buildingsCuedBeforeAlert).toBeGreaterThan(0)
    expect(r.buildingsCuedBeforeAlert).toBeLessThan(r.buildingsReached)
    expect(r.expectedTrappedHouseholds).toBeGreaterThan(10)
  })

  it('is the member-wise mix of two full runs (risk, total, status, flow)', () => {
    const { prepared, arrival, programme, nB } = setup()
    for (const p of [{ alertMin: 270 }, { alertMin: 240, footShare: 1 }, { alertMin: 300, footShare: 0, cueRadiusM: 400 }, { alertMin: 300, cueShare: 0 }]) {
      const run = (extra: Partial<EvacParams>, prog?: EvacProgramme) =>
        simulateEvac({ prepared, arrivalMin: arrival, params: params({ ...p, ...extra }), edits: NO_EDITS, programme: prog })
      const base = run({})
      const all = run(PROG)
      const mixed = run({}, programme)
      let sum = 0
      let differs = 0
      for (let b = 0; b < nB; b++) {
        const src = programme.member[b] ? all : base
        expect(Math.abs(mixed.householdRisk[b] - src.householdRisk[b])).toBeLessThan(1e-6)
        expect(mixed.householdStatus[b]).toBe(src.householdStatus[b])
        sum += src.householdRisk[b]
        if (programme.member[b] && all.householdRisk[b] < base.householdRisk[b] - 1e-6) differs++
      }
      // The programme matters here (otherwise the test would prove nothing) and never raises anyone's risk.
      expect(differs).toBeGreaterThan(0)
      for (let b = 0; b < nB; b++) expect(all.householdRisk[b]).toBeLessThanOrEqual(base.householdRisk[b] + 1e-7)
      expect(Math.abs(mixed.expectedTrappedHouseholds - sum)).toBeLessThan(1e-6 * Math.max(1, sum))
      expect(mixed.expectedTrappedHouseholds).toBeLessThan(base.expectedTrappedHouseholds)
      // Who leaves and by which streets does not depend on how fast they prepare.
      expect(mixed.edgeFlow).toEqual(base.edgeFlow)
      expect(all.edgeFlow).toEqual(base.edgeFlow)
      expect(mixed.buildingsReached).toBe(base.buildingsReached)
    }
  })

  it('riskByAlert agrees with the member-wise mix of full runs at each alert time', () => {
    const { prepared, arrival, programme, nB } = setup()
    const run = (p: Partial<EvacParams>, prog?: EvacProgramme) =>
      simulateEvac({ prepared, arrivalMin: arrival, params: params(p), edits: NO_EDITS, programme: prog })
    const mixed = run({ alertMin: 270 }, programme)
    const base = run({ alertMin: 270 })
    expect(mixed.riskByAlert.map((x) => x.alertMin)).toEqual(base.riskByAlert.map((x) => x.alertMin))
    for (let j = 0; j < base.riskByAlert.length; j++)
      expect(mixed.riskByAlert[j].expectedTrappedHouseholds).toBeLessThanOrEqual(base.riskByAlert[j].expectedTrappedHouseholds + 1e-9)
    for (let j = 1; j < mixed.riskByAlert.length; j++)
      expect(mixed.riskByAlert[j].expectedTrappedHouseholds).toBeGreaterThanOrEqual(mixed.riskByAlert[j - 1].expectedTrappedHouseholds - 1e-9)
    expect(mixed.riskByAlert[mixed.riskByAlert.length - 1].alertMin).toBe(360)
    let distinguishable = 0
    for (const alertMin of [0, 180, 240, 270, 300, 330, 360]) {
      const def = run({ alertMin })
      const prog = run({ alertMin, ...PROG })
      let full = 0
      for (let b = 0; b < nB; b++) full += (programme.member[b] ? prog : def).householdRisk[b]
      const tol = 0.002 * Math.max(10, full)
      const point = mixed.riskByAlert.find((x) => x.alertMin === alertMin)!.expectedTrappedHouseholds
      expect(Math.abs(point - full)).toBeLessThan(tol)
      // The tolerance is far tighter than the programme's effect (else the check would prove nothing).
      if (def.expectedTrappedHouseholds - full > 10 * tol) distinguishable++
    }
    expect(distinguishable).toBeGreaterThanOrEqual(3)
  })

  it('everyone in the programme equals a full run with the programme parameters, bit for bit', () => {
    const { prepared, arrival, nB } = setup()
    const everyone: EvacProgramme = { member: new Uint8Array(nB).fill(1), ...PROG }
    const a = simulateEvac({ prepared, arrivalMin: arrival, params: params({ alertMin: 270 }), edits: NO_EDITS, programme: everyone })
    const b = simulateEvac({ prepared, arrivalMin: arrival, params: params({ alertMin: 270, ...PROG }), edits: NO_EDITS })
    expect(a.householdRisk).toEqual(b.householdRisk)
    expect(a.householdStatus).toEqual(b.householdStatus)
    expect(a.expectedTrappedHouseholds).toBe(b.expectedTrappedHouseholds)
    expect(a.riskByAlert).toEqual(b.riskByAlert)
  })

  it('a programme with no members changes nothing, bit for bit', () => {
    const { prepared, arrival, nB } = setup()
    const nobody: EvacProgramme = { member: new Uint8Array(nB), ...PROG }
    for (const p of [{ alertMin: 270 }, { alertMin: 240, footShare: 1, cueRadiusM: 0 }]) {
      const a = simulateEvac({ prepared, arrivalMin: arrival, params: params(p), edits: NO_EDITS, programme: nobody })
      const b = simulateEvac({ prepared, arrivalMin: arrival, params: params(p), edits: NO_EDITS })
      expect(a.householdRisk).toEqual(b.householdRisk)
      expect(a.householdStatus).toEqual(b.householdStatus)
      expect(a.edgeFlow).toEqual(b.edgeFlow)
      expect(a.expectedTrappedHouseholds).toBe(b.expectedTrappedHouseholds)
      expect(a.riskByAlert).toEqual(b.riskByAlert)
      expect(a.buildingsCuedBeforeAlert).toBe(b.buildingsCuedBeforeAlert)
      expect(a.buildingsReached).toBe(b.buildingsReached)
    }
  })

  it('throws on an invalid programme', () => {
    const { prepared, arrival, nB } = setup()
    const go = (programme: unknown) =>
      simulateEvac({ prepared, arrivalMin: arrival, params: params(), edits: NO_EDITS, programme: programme as EvacProgramme })
    const member = new Uint8Array(nB)
    expect(() => go({ member: new Uint8Array(nB - 1), ...PROG })).toThrow(/programme\.member/)
    expect(() => go({ member: Array.from(member), ...PROG })).toThrow(/programme\.member/)
    expect(() => go({ member, ...PROG, prepMedianMin: 0 })).toThrow(/prepMedianMin/)
    expect(() => go({ member, ...PROG, prepMedianMin: NaN })).toThrow(/prepMedianMin/)
    expect(() => go({ member, ...PROG, prepMedianMin: Infinity })).toThrow(/prepMedianMin/)
    expect(() => go({ member, ...PROG, cueShare: 1.5 })).toThrow(/cueShare/)
    expect(() => go({ member, ...PROG, cueShare: -0.1 })).toThrow(/cueShare/)
    expect(() => go({ member, ...PROG, cueShare: NaN })).toThrow(/cueShare/)
  })
})
