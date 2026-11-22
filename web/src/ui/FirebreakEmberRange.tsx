// The drawn firebreaks' effect under several ember settings (worker/emberRange.ts, D-034), shown under the list of
// firebreaks: whether a 30-120 m line holds depends mostly on how far embers fly, a knob calibrated only on Viña 2024.
import { DEFAULT_FIRE_PARAMS } from '../engine/fire'
import { linesCutPct, type EmberRangeRow, type EmberSetting } from '../worker/emberRange'
import { fmtInt } from './controls'
import { fmtCut } from './PlanSection'

/** The worker's last ember range: rows null while it is being computed (or after an error). */
export interface EmberRangeState {
  rows: EmberRangeRow[] | null
  error: string | null
}

function settingLabel(e: EmberSetting, own: EmberSetting): string {
  const name = e === null ? 'Sin pavesas' : `${e} m por km/h`
  const tags = [e === own ? 'la de este escenario' : null, e === DEFAULT_FIRE_PARAMS.spotMetresPerKmh ? 'calibrada en Viña' : null].filter(Boolean)
  return tags.length > 0 ? `${name} (${tags.join(', ')})` : name
}

/** `own`: the scenario's ember setting (null = embers off); its row matches the main result without firefighters. */
export function FirebreakEmberRange({ range, cellM, own }: { range: EmberRangeState | null; cellM: number; own: EmberSetting }) {
  if (!range) return null
  const ha = (cells: number) => fmtInt((cells * cellM * cellM) / 1e4)
  // The headline is the spread over ember distances; the embers-off row (when the scenario has them off) is listed only.
  const pcts = range.rows?.filter((r) => r.spotMetresPerKmh !== null).map(linesCutPct).filter((x): x is number => x !== null) ?? []
  return (
    <div className="plan-val small">
      <div className="muted">Efecto de los cortafuegos dibujados según cuán lejos lleguen las pavesas:</div>
      {range.error ? (
        <div className="alert error">No se pudo calcular: {range.error}</div>
      ) : !range.rows ? (
        <div className="muted">Calculando con otras distancias de pavesas…</div>
      ) : (
        <>
          {pcts.length > 0 && (
            <div>
              Reducción de hogares con la salida cortada, con pavesas:{' '}
              <b>
                {Math.min(...pcts) === Math.max(...pcts) ? `${fmtCut(pcts[0])} %` : `entre ${fmtCut(Math.min(...pcts))} y ${fmtCut(Math.max(...pcts))} %`}
              </b>
            </div>
          )}
          <ul className="brig-params">
            {range.rows.map((r) => {
              const pct = linesCutPct(r)
              return (
                <li key={String(r.spotMetresPerKmh)}>
                  {settingLabel(r.spotMetresPerKmh, own)}: <b>{pct === null ? 'sin hogares cortados' : `${fmtCut(pct)} %`}</b>{' '}
                  <span className="muted">
                    ({fmtInt(r.without.households)} → {fmtInt(r.with.households)} hogares, {ha(r.without.burnedCells)} → {ha(r.with.burnedCells)} ha)
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <div className="muted">
        Las pavesas cruzan un cortafuego más angosto que la distancia a la que llegan. 12, 15 y 25 m por km/h son las distancias que se
        probaron al calibrar el modelo con el incendio de Viña del Mar del 2 feb 2024; no se han comprobado en otros territorios.
      </div>
    </div>
  )
}
