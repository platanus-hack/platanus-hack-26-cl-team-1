// "Plan de preparación" panel section: measures decided before any fire (the belt around inhabited land and the
// community preparation programme), filled in the order plan.json ranks them, with the validation plan.json
// carries for the nearest budget. The worker applies the chosen tiles and sectors (src/engine/plan).
import { useMemo } from 'react'
import type { Dataset } from '../data/load'
import { fillBudget } from '../engine/plan'
import { PLAN_MEASURE, type PlanFile, type PlanMeasure, type PlanValidation } from '../engine/types'
import type { Scenario } from '../worker/scenario'
import { fmtInt, Section, Slider } from './controls'

/** Hectare budgets offered for the belt (the slider always ends at every tile the plan ranks). */
export const BELT_BUDGETS_HA = [0, 100, 300, 1000, 3000]
/** Household budgets offered for the programme (the slider always ends at every sector the plan ranks). */
export const PROGRAMME_BUDGETS = [0, 5000, 20000, 50000]

export interface BudgetStep<T> {
  /** Budget the step fills (hectares or households); for the last step, the total. */
  budget: number
  /** The last step: everything the plan ranks. */
  all: boolean
  items: T[]
  /** Cost actually used by the items. */
  used: number
}

const sameSet = <T,>(a: readonly T[], b: readonly T[]) => {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

/** Slider steps: each budget below the total filled in ranked order (fillBudget), then everything. A budget that
 *  picks the same items as the previous step is dropped (the slider would move without changing anything). */
export function budgetSteps<T>(ranked: readonly T[], cost: (x: T) => number, budgets: readonly number[]): BudgetStep<T>[] {
  const total = ranked.reduce((a, x) => a + cost(x), 0)
  const out: BudgetStep<T>[] = []
  const push = (s: BudgetStep<T>) => {
    const prev = out[out.length - 1]
    if (!prev || !sameSet(prev.items, s.items)) out.push(s)
  }
  for (const b of budgets) {
    if (b >= total) continue
    const items = fillBudget(ranked, cost, b)
    push({ budget: b, all: false, items, used: items.reduce((a, x) => a + cost(x), 0) })
  }
  push({ budget: total, all: true, items: [...ranked], used: total })
  return out
}

/** Index of the step whose items are exactly the chosen ones, -1 if none is. */
export function stepIndex<T>(steps: readonly BudgetStep<T>[], chosen: readonly T[]): number {
  return steps.findIndex((s) => sameSet(s.items, chosen))
}

/** Validated budgets within this ratio of the one in use are shown (labelled when not exact); farther ones are not. */
export const VALIDATION_MAX_RATIO = 1.5

/** The validated budget of a measure closest (in ratio) to the one in use, if within VALIDATION_MAX_RATIO; null
 *  with nothing in use, none validated, or none close enough. */
export function nearestValidation(v: readonly PlanValidation[], measure: PlanMeasure, used: number): PlanValidation | null {
  if (!(used > 0)) return null
  let best: PlanValidation | null = null
  let bd = Infinity
  for (const x of v) {
    if (x.measure !== measure || !(x.budget > 0)) continue
    const d = Math.abs(Math.log(x.budget / used))
    if (d < bd) {
      bd = d
      best = x
    }
  }
  return bd <= Math.log(VALIDATION_MAX_RATIO) ? best : null
}

/** A reduction in percent as a signed change: 12.3 -> "−12", 4.25 -> "−4,3", -1 -> "+1" (the plan made it worse). */
export function fmtCut(pct: number): string {
  const a = Math.abs(pct)
  const s = a.toLocaleString('es-CL', { maximumFractionDigits: a < 10 ? 1 : 0 })
  if (s === '0') return '0'
  return pct > 0 ? `−${s}` : `+${s}`
}

const fmtNum = (x: number, digits = 1) => x.toLocaleString('es-CL', { maximumFractionDigits: digits })

function Validation({ plan, measure, used, unit }: { plan: PlanFile; measure: PlanMeasure; used: number; unit: string }) {
  if (used <= 0) return null
  if (plan.validation.length === 0) return <div className="plan-val muted small">Plan sintético, sin validación.</div>
  const v = nearestValidation(plan.validation, measure, used)
  if (!v) {
    const budgets = plan.validation.filter((x) => x.measure === measure).map((x) => fmtInt(x.budget))
    return (
      <div className="plan-val muted small">
        Sin validación para este presupuesto{budgets.length > 0 ? ` (validados: ${budgets.join(', ')} ${unit})` : ''}.
      </div>
    )
  }
  const r = v.randomUnseenPct
  return (
    <div className="plan-val small">
      <div className="muted">
        Hogares con la salida cortada, con {fmtInt(v.budget)} {unit}
        {Math.abs(Math.log(v.budget / used)) > 0.1 ? ' (el presupuesto validado más cercano)' : ''}:
      </div>
      <div>
        En incendios simulados con el clima del 2 feb 2024 que el plan no vio: <b>{fmtCut(v.unseenPct)} %</b>{' '}
        <span className="muted">
          (al azar: {fmtCut(r[0])} a {fmtCut(r[2])} %)
        </span>
      </div>
      <div>
        2 feb 2024: <b>{fmtCut(v.feb2Pct)} %</b> <span className="muted">(con variaciones del viento: {fmtCut(v.feb2MeanPct)} % en promedio)</span>
      </div>
    </div>
  )
}

type PlanProps = { data: Dataset; scenario: Scenario; update: (patch: Partial<Scenario>) => void }

export function PlanSection(props: PlanProps) {
  if (!props.data.plan)
    return (
      <Section title="Plan de preparación">
        <p className="muted small">Aún no hay un plan de preparación calculado para este territorio. Por ahora solo existe para Viña del Mar, Quilpué y Villa Alemana.</p>
      </Section>
    )
  return <PlanBody {...props} plan={props.data.plan} />
}

function PlanBody({ data, scenario, update, plan }: PlanProps & { plan: PlanFile }) {
  const tileKm = fmtNum((plan.tileCells * data.grid.cellM) / 1000)
  const tileHa = useMemo(() => new Map(plan.tiles.map((t) => [t.tile, t.ha])), [plan])
  const sectorHh = useMemo(() => new Map(plan.sectors.map((s) => [s.sector, s.households])), [plan])
  const beltSteps = useMemo(
    () => budgetSteps(plan.tiles.map((t) => t.tile), (t) => tileHa.get(t)!, BELT_BUDGETS_HA),
    [plan, tileHa],
  )
  const progSteps = useMemo(
    () => budgetSteps(plan.sectors.map((s) => s.sector), (s) => sectorHh.get(s)!, PROGRAMME_BUDGETS),
    [plan, sectorHh],
  )
  const bi = stepIndex(beltSteps, scenario.planTiles)
  const pi = stepIndex(progSteps, scenario.planSectors)
  const usedHa = scenario.planTiles.reduce((a, t) => a + (tileHa.get(t) ?? 0), 0)
  const usedHh = scenario.planSectors.reduce((a, s) => a + (sectorHh.get(s) ?? 0), 0)
  const totalHa = beltSteps[beltSteps.length - 1].used
  const totalHh = progSteps[progSteps.length - 1].used
  const any = scenario.planTiles.length > 0 || scenario.planSectors.length > 0

  const beltLabel = (s: BudgetStep<number>) => (s.all ? `todas las celdas del plan (${fmtInt(s.used)} ha)` : s.budget === 0 ? 'ninguna' : `${fmtInt(s.budget)} ha`)
  const progLabel = (s: BudgetStep<number>) => (s.all ? `todos los sectores del plan (${fmtInt(s.used)} hogares)` : s.budget === 0 ? 'ninguno' : `${fmtInt(s.budget)} hogares`)

  return (
    <Section title="Plan de preparación">
      <p className="small plan-intro">
        Medidas que se deciden antes de cualquier incendio, sin saber dónde empezará el próximo. {plan.method}
      </p>
      {plan.validation.length === 0 && <div className="alert warn">Plan sintético, sin validación.</div>}

      <Slider
        label={`Franja de ${plan.beltWidthM} m sin vegetación alrededor de zonas habitadas`}
        value={Math.max(0, bi)}
        min={0}
        max={beltSteps.length - 1}
        step={1}
        disabled={beltSteps.length < 2}
        display={bi >= 0 ? beltLabel(beltSteps[bi]) : 'selección propia'}
        onChange={(k) => update({ planTiles: beltSteps[k].items })}
        hint={
          usedHa > 0 ? (
            <>
              Se tratan <b>{fmtInt(usedHa)} ha</b> en {fmtInt(scenario.planTiles.length)} celdas de {tileKm} km, de {fmtInt(totalHa)} ha en las celdas que el plan ordena (las que tuvieron efecto en los incendios de entrenamiento).
            </>
          ) : (
            `Sin franja. El plan ordena ${fmtInt(totalHa)} ha de franja, en celdas de ${tileKm} km.`
          )
        }
      />
      <Validation plan={plan} measure={PLAN_MEASURE.BELT} used={usedHa} unit="ha" />

      <Slider
        label="Programa de preparación comunitaria (simulacros, mochila de emergencia, salida acordada)"
        value={Math.max(0, pi)}
        min={0}
        max={progSteps.length - 1}
        step={1}
        disabled={progSteps.length < 2}
        display={pi >= 0 ? progLabel(progSteps[pi]) : 'selección propia'}
        onChange={(k) => update({ planSectors: progSteps[k].items })}
        hint={
          usedHh > 0 ? (
            <>
              <b>{fmtInt(usedHh)} hogares</b> en {fmtInt(scenario.planSectors.length)} sectores de {tileKm} km, de {fmtInt(totalHh)} en los sectores que el plan ordena.
            </>
          ) : (
            `Sin programa. Los sectores de ${tileKm} km se suman en el orden del plan.`
          )
        }
      />
      <Validation plan={plan} measure={PLAN_MEASURE.PROGRAMME} used={usedHh} unit="hogares" />

      <div className="base-row">
        <span className="muted small">Fija el escenario base antes de aplicar el plan para ver la diferencia en Resultados.</span>
        {any && (
          <button type="button" className="btn small ghost push-right" onClick={() => update({ planTiles: [], planSectors: [] })}>
            Quitar plan
          </button>
        )}
      </div>

      <details className="brig-cuerpo">
        <summary>
          <span>Supuestos</span>
        </summary>
        <ul className="small brig-params">
          <li>
            Programa: los hogares de los sectores elegidos tardan {fmtInt(Math.min(plan.programme.prepMedianMin, scenario.prepMedianMin))} min en
            prepararse (mediana; el resto, {fmtInt(scenario.prepMedianMin)} min) y el {Math.round(Math.max(plan.programme.cueShare, scenario.cueShare) * 100)} % sale al
            ver el fuego, brasas o a sus vecinos evacuar (el resto, {Math.round(scenario.cueShare * 100)} %). El programa nunca deja a un hogar más lento
            que lo fijado en Evacuación. Son supuestos para planificar, no efectos medidos.
          </li>
          <li>
            Franja: se elimina la vegetación en {plan.beltWidthM} m alrededor de las zonas con viviendas; las casas se quedan (donde hay casas dentro de
            la franja, la vegetación alrededor se maneja como zona urbana).
          </li>
          <li>
            Las cifras de validación son sin bomberos ni rescate; en Resultados, también, salvo que actives Bomberos. Son hogares con la salida
            cortada en este modelo, no muertes.
          </li>
        </ul>
      </details>
    </Section>
  )
}
