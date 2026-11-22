// Whether embers cross the drawn firebreaks: the probabilistic-ember ensemble (worker/embers.ts, engine/fire/MODEL.md
// section 5), shown under the list of firebreaks. It leads with how many members cross, then the paired difference
// the lines make in households cut off and burned area, and says what the range does and does not cover.
import { FIRE_MODEL } from '../engine/fire'
import { minToHHMM } from '../data/time'
import { EMBER_MEMBERS, summariseEmbers, type EmberQuantiles, type EmberSummary } from '../worker/embers'
import type { EmbersMessage } from '../worker/protocol'
import { fmtInt } from './controls'
import { fmtCut } from './PlanSection'

/** What the panel shows: the worker's last ensemble message for the last result, and the last complete ensemble,
 *  kept (dimmed) while a new one is being computed. */
export interface EmberState {
  msg: EmbersMessage
  lastDone: EmbersMessage | null
}

/** The state after a new message for the current result. */
export function nextEmberState(prev: EmberState | null, msg: EmbersMessage): EmberState {
  const lastDone = msg.status === 'done' ? msg : msg.status === 'running' ? (prev?.lastDone ?? null) : null
  return { msg, lastDone }
}

/** Rounded, with -0 as 0 (so it never prints "-0"). */
const round0 = (x: number) => Math.round(x) + 0

/** The P10-P90 range of a paired difference (positive = fewer with the lines), worded for its signs. */
function spread(q: EmberQuantiles, n: number, unit: string, tail: string): string {
  const lo = round0(q.p10)
  const hi = round0(q.p90)
  if (lo === hi) return `igual en las ${n} simulaciones`
  if (lo >= 0) return `entre ${fmtInt(lo)} y ${fmtInt(hi)}${unit}${tail}`
  // 0 - x, not -x: -0 would print as "-0".
  if (hi <= 0) return `entre ${fmtInt(0 - hi)} y ${fmtInt(0 - lo)}${unit} más${tail}`
  return `entre ${fmtInt(0 - lo)}${unit} más y ${fmtInt(hi)}${unit} menos${tail}`
}

/** "526 menos", "12 más", "sin diferencia" for a paired difference. */
function change(x: number, unit: string): string {
  const r = round0(x)
  return r > 0 ? `${fmtInt(r)}${unit} menos` : r < 0 ? `${fmtInt(-r)}${unit} más` : 'sin diferencia'
}

function Outcome({ msg, t0, cellM }: { msg: EmbersMessage; t0: string; cellM: number }) {
  let sum: EmberSummary
  try {
    sum = summariseEmbers(msg.members, cellM)
  } catch (e) {
    // Shown where the numbers would be, instead of taking the whole panel down.
    return <div className="alert error">No se pudo calcular: {e instanceof Error ? e.message : String(e)}</div>
  }
  const n = sum.n
  const k = sum.crossed
  const r = sum.reached
  const crossing =
    k === n
      ? `En las ${n} simulaciones las pavesas cruzan las líneas.`
      : k > 0
        ? `Las pavesas cruzan las líneas en ${k} de ${n} simulaciones.`
        : r === 0
          ? `En ninguna de las ${n} simulaciones el fuego llega a las líneas antes del final.`
          : `En ninguna de las ${n} simulaciones las pavesas cruzan las líneas; el fuego las alcanza en ${r === n ? 'todas' : `${r} de ellas`}.`
  const firstCross = sum.firstCrossMin ? minToHHMM(t0, sum.firstCrossMin.p50) : null
  const reachedAt = sum.reachedMin ? minToHHMM(t0, sum.reachedMin.p50) : null
  const times =
    k > 0 && firstCross
      ? reachedAt
        ? `Primer foco al otro lado: ${firstCross}. El fuego toca la línea: ${reachedAt} (medianas).`
        : `Primer foco al otro lado: ${firstCross} (mediana).`
      : null
  // A percentage of under one household says nothing: shown only from 1 household cut off without the lines, and
  // never as "0 %" (a household or two out of thousands).
  const pctText = sum.savedPct !== null && sum.without.p50 >= 1 && round0(sum.saved.p50) !== 0 ? fmtCut(sum.savedPct.p50) : '0'
  const pct = pctText !== '0' ? ` (${pctText} %)` : ''
  const range = (x: EmberQuantiles) => `(${fmtInt(x.p10)}–${fmtInt(x.p90)})`
  return (
    <>
      <div>{crossing}</div>
      {times && <div>{times}</div>}
      <div>
        Hogares con la salida cortada: <b>{change(sum.saved.p50, '')}</b> con las líneas{pct}, {spread(sum.saved, n, '', ' según la simulación')}.
      </div>
      <div>
        Superficie quemada al final: {change(sum.haSaved.p50, ' ha')} ({spread(sum.haSaved, n, ' ha', '')}).
      </div>
      <div className="muted">
        Sin líneas: {fmtInt(sum.without.p50)} hogares {range(sum.without)}; con líneas: {fmtInt(sum.with.p50)} {range(sum.with)}. Percentiles 10 y 90 de{' '}
        {n} simulaciones. No incluyen bomberos y en ellas no toda pavesa enciende, por eso difieren del resultado principal.
      </div>
      {/* Only when the fire reached the lines: otherwise the reason nothing crossed is that it never got there. */}
      {k === 0 && r > 0 && (
        <div className="muted">
          Con viento bajo {fmtInt(FIRE_MODEL.spotMinWindKmh)} km/h, un frente lento o pavesas de poco alcance, el modelo no genera pavesas que crucen.
        </div>
      )}
    </>
  )
}

export function EmberEnsemble({ state, busy, spotting, t0, cellM }: { state: EmberState | null; busy: boolean; spotting: boolean; t0: string; cellM: number }) {
  let body
  if (!spotting) {
    body = <div className="muted">Sin pavesas (desactivadas o con alcance 0): el fuego solo avanza por superficie y el mapa ya muestra si las líneas lo detienen.</div>
  } else if (!state) {
    // No ensemble for the current run (none yet, or the run failed and the results show its error).
    return null
  } else if (state.msg.status === 'error') {
    body = <div className="alert error">No se pudo calcular: {state.msg.error}</div>
  } else {
    // 'off' with embers on comes from a run before the first line was drawn: the new run has not answered yet.
    const pending = state.msg.status !== 'done'
    const total = state.msg.status === 'off' ? EMBER_MEMBERS : state.msg.total
    const shown = state.msg.status === 'done' ? state.msg : state.lastDone
    const stale = pending || busy
    body = (
      <>
        {pending && (
          <div className="muted">
            Calculando {total} simulaciones con pavesas al azar
            {state.msg.status === 'running' ? ` (${state.msg.members.length} de ${total})` : ''}…
          </div>
        )}
        {shown && (
          <div className={`ember-outcome${stale ? ' stale' : ''}`} aria-busy={stale}>
            <Outcome msg={shown} t0={t0} cellM={cellM} />
          </div>
        )}
        <div className="muted">
          Cada simulación decide al azar dónde enciende cada pavesa, con el mismo azar con y sin las líneas: la diferencia se debe solo a ellas. La
          probabilidad de que una pavesa encienda baja con la humedad del pasto (Schroeder, 1969); cuántas pavesas lanza el fuego se calibró solo con el
          incendio de Viña del Mar de 2024. El rango refleja ese azar, no la incertidumbre del modelo ni del clima. Explora escenarios; no es una
          predicción.
        </div>
      </>
    )
  }
  return (
    <div className="plan-val small">
      <div>
        <b>¿Las pavesas cruzan estas líneas?</b>
      </div>
      {body}
    </div>
  )
}
