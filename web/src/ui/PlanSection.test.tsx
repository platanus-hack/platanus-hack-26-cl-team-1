import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { makeMockDataset } from '../data/mock'
import { PLAN_MEASURE, type PlanValidation } from '../engine/types'
import type { Scenario } from '../worker/scenario'
import { budgetSteps, fmtCut, nearestValidation, PlanSection, stepIndex } from './PlanSection'

const cost = new Map([
  [10, 60],
  [11, 50],
  [12, 200],
  [13, 30],
])
const ranked = [10, 11, 12, 13]
const c = (t: number) => cost.get(t)!

describe('budgetSteps', () => {
  it('fills each budget in ranked order and ends with everything', () => {
    const s = budgetSteps(ranked, c, [0, 100, 300, 1000])
    expect(s.map((x) => x.items)).toEqual([[], [10, 13], [10, 11, 13], [10, 11, 12, 13]])
    expect(s.map((x) => x.used)).toEqual([0, 90, 140, 340])
    expect(s[s.length - 1]).toMatchObject({ all: true, budget: 340 })
    expect(s.slice(0, -1).every((x) => !x.all)).toBe(true)
  })

  it('drops budgets that pick the same items as the previous step', () => {
    // 20 ha cannot fit any tile: same as 0.
    const s = budgetSteps(ranked, c, [0, 20, 100])
    expect(s.map((x) => x.budget)).toEqual([0, 100, 340])
  })

  it('has a single step when nothing is ranked', () => {
    const s = budgetSteps<number>([], c, [0, 100])
    expect(s).toEqual([{ budget: 0, all: true, items: [], used: 0 }])
  })

  it('finds the step of the chosen items in any order, -1 if none', () => {
    const s = budgetSteps(ranked, c, [0, 100, 300])
    expect(stepIndex(s, [])).toBe(0)
    expect(stepIndex(s, [13, 10])).toBe(1)
    expect(stepIndex(s, [12])).toBe(-1)
  })
})

describe('nearestValidation', () => {
  const v = (measure: PlanValidation['measure'], budget: number): PlanValidation => ({
    measure,
    budget,
    unseenPct: 1,
    randomUnseenPct: [0, 0, 0],
    feb2Pct: 0,
    feb2MeanPct: 0,
  })
  const all = [v(PLAN_MEASURE.BELT, 100), v(PLAN_MEASURE.BELT, 1000), v(PLAN_MEASURE.PROGRAMME, 20000)]

  it('picks the closest budget of the same measure, in ratio', () => {
    expect(nearestValidation(all, PLAN_MEASURE.BELT, 130)?.budget).toBe(100)
    expect(nearestValidation(all, PLAN_MEASURE.BELT, 800)?.budget).toBe(1000)
    expect(nearestValidation(all, PLAN_MEASURE.PROGRAMME, 18000)?.budget).toBe(20000)
  })

  it('shows no validation for a budget far from every validated one', () => {
    expect(nearestValidation(all, PLAN_MEASURE.BELT, 400)).toBeNull()
    expect(nearestValidation(all, PLAN_MEASURE.BELT, 3000)).toBeNull()
    expect(nearestValidation(all, PLAN_MEASURE.PROGRAMME, 5000)).toBeNull()
  })

  it('returns null with nothing in use or nothing validated', () => {
    expect(nearestValidation(all, PLAN_MEASURE.BELT, 0)).toBeNull()
    expect(nearestValidation([], PLAN_MEASURE.BELT, 100)).toBeNull()
  })
})

describe('fmtCut', () => {
  it('shows a reduction as a minus sign and a rise as a plus sign', () => {
    expect(fmtCut(23.4)).toBe('−23')
    expect(fmtCut(4.25)).toMatch(/^−4,[23]$/)
    expect(fmtCut(-1)).toBe('+1')
    expect(fmtCut(0.01)).toBe('0')
  })
})

describe('PlanSection', () => {
  const data = makeMockDataset()
  const scenario = (planTiles: number[], planSectors: number[]) =>
    ({ planTiles, planSectors, prepMedianMin: 10, cueShare: 0.65 }) as unknown as Scenario
  const render = (s: Scenario) => renderToStaticMarkup(<PlanSection data={data} scenario={s} update={() => {}} />)

  it('renders the budgets, the assumptions and the synthetic-plan warning, without a remove button when empty', () => {
    const html = render(scenario([], []))
    expect(html).toContain('Plan de preparación')
    expect(html).toContain('Plan sintético, sin validación')
    expect(html).toContain('Programa de preparación comunitaria')
    expect(html).toContain('el resto, 10 min')
    expect(html).not.toContain('Quitar plan')
  })

  it('shows the hectares and households in use and the remove button', () => {
    const t = data.plan!.tiles[0]
    const s = data.plan!.sectors[0]
    const html = render(scenario([t.tile], [s.sector]))
    expect(html).toContain('Quitar plan')
    expect(html).toContain('Se tratan')
    expect(html).toContain(`${Math.round(s.households).toLocaleString('es-CL')} hogares`)
  })
})
