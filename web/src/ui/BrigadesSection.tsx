// "Bomberos" panel section: firefighting on/off, trucks per company and type, dispatch and reinforcement times,
// the historical road cut, the comparison against the same scenario without firefighters, and every supuesto.
import type { Dataset } from '../data/load'
import { minToHHMM } from '../data/time'
import { FIREFIGHT_MODEL } from '../engine/brigade/model'
import type { UnitStatus } from '../engine/brigade'
import { UNIT_COUNT, UNIT_LABEL_ES, UNIT_SHORT_ES, type UnitType } from '../engine/types'
import type { BrigadesOut } from '../worker/protocol'
import type { BrigadeScenario, Scenario } from '../worker/scenario'
import { defaultBrigades, HORIZON_MIN } from '../worker/scenario'
import { fmtInt, fmtSigned, Section, Slider, Toggle } from './controls'

interface Props {
  data: Dataset
  scenario: Scenario
  update: (patch: Partial<Scenario>) => void
  out: BrigadesOut | null
  /** The current (defended) results. */
  burnedHaEnd: number | null
  buildingsReached: number | null
  trappedHouseholds: number | null
}

const TYPES = Array.from({ length: UNIT_COUNT }, (_, k) => k as UnitType)
const STATUS_ES: Record<UnitStatus, string> = {
  deployed: 'trabajando',
  late: 'llegan cuando ya se quemó',
  no_access: 'sin acceso por calles abiertas',
  idle: 'sin sector amenazado',
}

function Supuesto({ source }: { source: string | null }) {
  return source === null ? (
    <span className="tag warn" title="Sin fuente: valor supuesto, editable">
      supuesto
    </span>
  ) : (
    <span className="tag" title={source}>
      fuente
    </span>
  )
}

function Stepper({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <input
      className="stepper"
      type="number"
      min={0}
      max={99}
      step={1}
      value={value}
      aria-label={label}
      onChange={(e) => {
        const v = Math.round(Number(e.target.value))
        if (Number.isFinite(v) && v >= 0) onChange(Math.min(99, v))
      }}
    />
  )
}

function Diff({ now, base, unit = '' }: { now: number; base: number; unit?: string }) {
  const d = Math.round(now - base)
  return <span className={`delta ${d === 0 ? 'zero' : d > 0 ? 'up' : 'down'}`}>{d === 0 ? 'sin cambio' : `${fmtSigned(d)}${unit}`}</span>
}

export function BrigadesSection(p: Props) {
  const file = p.data.brigades
  const t0 = p.data.grid.t0
  const b = p.scenario.brigades
  const set = (patch: Partial<BrigadeScenario>) => p.update({ brigades: { ...b, ...patch } })
  const scaleAll = (k: number) =>
    set({
      units: Object.fromEntries(Object.entries(b.units).map(([id, u]) => [id, u.map((x) => Math.round(x * k))])),
      reinforcementUnits: Object.fromEntries(Object.entries(b.reinforcementUnits).map(([id, u]) => [id, u.map((x) => Math.round(x * k))])),
    })
  const setUnit = (id: string, k: number, v: number) => set({ units: { ...b.units, [id]: b.units[id].map((x, j) => (j === k ? v : x)) } })
  const setReinf = (id: string, k: number, v: number) =>
    set({ reinforcementUnits: { ...b.reinforcementUnits, [id]: b.reinforcementUnits[id].map((x, j) => (j === k ? v : x)) } })
  const total = (us: number[][]) => us.reduce((a, u) => a + u.reduce((x, y) => x + y, 0), 0)
  const cellHa = (p.data.grid.cellM * p.data.grid.cellM) / 10000
  const out = b.enabled ? p.out : null
  const count = (s: UnitStatus) => out?.units.filter((u) => u.status === s).length ?? 0
  const originLabel = new Map<string, string>([
    ...file.stations.map((s) => [s.id, `${s.company} de ${s.cuerpo}`] as [string, string]),
    ...file.reinforcements.map((r) => [r.id, r.label] as [string, string]),
  ])
  const stranded = out?.units.filter((u) => u.status === 'no_access' || u.status === 'late') ?? []
  const params = [
    ...TYPES.filter((k) => FIREFIGHT_MODEL.tankL[k].value > 0).map((k) => FIREFIGHT_MODEL.tankL[k]),
    FIREFIGHT_MODEL.flowLPerMin,
    FIREFIGHT_MODEL.bombaRadiusM,
    FIREFIGHT_MODEL.forestalRadiusM,
    FIREFIGHT_MODEL.directAttackMaxKwM,
    FIREFIGHT_MODEL.rescuePerHour,
    FIREFIGHT_MODEL.rescueRadiusM,
  ]

  return (
    <Section title="Bomberos" defaultOpen={false}>
      <Toggle
        label="Simular el trabajo de bomberos"
        checked={b.enabled}
        onChange={(v) => set({ enabled: v })}
        sub="Apagado es el escenario calibrado contra la cicatriz real, que ya incluye, sin separarlo, lo que se hizo ese día. Encendido, cada carro sale de su cuartel, va por calles abiertas al sector más amenazado al que llega antes que el fuego y lo defiende mientras le dura el agua."
      />
      {b.enabled && (
        <>
          {out ? (
            <div className="brig-results">
              <div className="muted small">Comparado con el mismo escenario sin bomberos:</div>
              <div className="brig-grid">
                <span>Superficie quemada</span>
                <b>{fmtInt(out.base.burnedCells * cellHa)} → {p.burnedHaEnd !== null ? fmtInt(p.burnedHaEnd) : '—'} ha</b>
                {p.burnedHaEnd !== null && <Diff now={p.burnedHaEnd} base={out.base.burnedCells * cellHa} unit=" ha" />}
                <span>Edificaciones alcanzadas</span>
                <b>{fmtInt(out.base.buildingsReached)} → {p.buildingsReached !== null ? fmtInt(p.buildingsReached) : '—'}</b>
                {p.buildingsReached !== null && <Diff now={p.buildingsReached} base={out.base.buildingsReached} />}
                <span>Hogares con la salida cortada</span>
                <b>{fmtInt(out.base.expectedTrappedHouseholds)} → {p.trappedHouseholds !== null ? fmtInt(p.trappedHouseholds) : '—'}</b>
                {p.trappedHouseholds !== null && <Diff now={p.trappedHouseholds} base={out.base.expectedTrappedHouseholds} />}
              </div>
              <div className="small">
                {fmtInt(out.units.length)} carros: {fmtInt(count('deployed'))} trabajando
                {count('late') > 0 && <> · {fmtInt(count('late'))} llegan tarde</>}
                {count('no_access') > 0 && <> · <b className="warn-text">{fmtInt(count('no_access'))} sin acceso</b></>}
                {count('idle') > 0 && <> · {fmtInt(count('idle'))} sin sector</>}. {fmtInt(out.defendedCells)} celdas de 60 m defendidas
                {out.rescuedExpected >= 0.5 && <>; ≈ {fmtInt(out.rescuedExpected)} hogares rescatados</>}.
              </div>
              {stranded.length > 0 && (
                <details className="brig-stranded">
                  <summary className="small">Carros que no llegan a tiempo ({stranded.length})</summary>
                  <ul className="small">
                    {stranded.slice(0, 40).map((u, i) => (
                      <li key={i}>
                        {originLabel.get(u.origin)}: {UNIT_LABEL_ES[u.type]}, sale {minToHHMM(t0, u.departMin)}, {STATUS_ES[u.status]}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <div className="muted small">Calculando…</div>
          )}

          <div className="base-row">
            <button type="button" className="btn small" onClick={() => scaleAll(0.5)}>
              Mitad
            </button>
            <button type="button" className="btn small" onClick={() => scaleAll(2)}>
              Doble
            </button>
            <button type="button" className="btn small ghost push-right" onClick={() => set({ ...defaultBrigades(file, t0), enabled: true })}>
              Restaurar
            </button>
          </div>

          {file.cuts.map((c) => (
            <Toggle
              key={c.id}
              label={`Corte histórico: ${c.label} desde las ${c.fromLocal.slice(11, 16)}`}
              checked={b.historicalCuts}
              onChange={(v) => set({ historicalCuts: v })}
              title={c.source}
              sub={c.toLocal === null ? 'Sin hora de reapertura con fuente: se deja cortada hasta el final.' : undefined}
            />
          ))}

          <div className="muted small">
            Carros por compañía: {TYPES.map((k) => `${UNIT_SHORT_ES[k]} = ${UNIT_LABEL_ES[k]}`).join(' · ')}.
          </div>
          {file.dispatch.map((d) => {
            const st = file.stations.filter((s) => s.cuerpo === d.cuerpo)
            return (
              <details key={d.cuerpo} className="brig-cuerpo">
                <summary>
                  <span>{d.cuerpo}</span>
                  <span className="muted small">
                    {st.length} compañías · {fmtInt(total(st.map((s) => b.units[s.id])))} carros · salen {minToHHMM(t0, b.dispatchMin[d.cuerpo])}
                  </span>
                </summary>
                <Slider
                  label="Hora de salida"
                  value={b.dispatchMin[d.cuerpo]}
                  min={0}
                  max={HORIZON_MIN}
                  step={10}
                  display={minToHHMM(t0, b.dispatchMin[d.cuerpo])}
                  onChange={(v) => set({ dispatchMin: { ...b.dispatchMin, [d.cuerpo]: v } })}
                  extra={<Supuesto source={d.source} />}
                />
                <table className="brig-table">
                  <thead>
                    <tr>
                      <th />
                      {TYPES.map((k) => (
                        <th key={k} title={UNIT_LABEL_ES[k]}>
                          {UNIT_SHORT_ES[k]}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {st.map((s) => (
                      <tr key={s.id}>
                        <td title={s.locationSource}>{s.company}</td>
                        {TYPES.map((k) => (
                          <td key={k}>
                            <Stepper value={b.units[s.id][k]} label={`${s.company} de ${s.cuerpo}: ${UNIT_LABEL_ES[k]}`} onChange={(v) => setUnit(s.id, k, v)} />
                          </td>
                        ))}
                        <td>
                          <Supuesto source={s.unitsSource} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )
          })}

          {file.reinforcements.map((r) => (
            <details key={r.id} className="brig-cuerpo">
              <summary>
                <span>{r.label}</span>
                <span className="muted small">
                  {fmtInt(total([b.reinforcementUnits[r.id]]))} carros · llegan {minToHHMM(t0, b.reinforcementMin[r.id])}
                </span>
              </summary>
              <Slider
                label="Llegada al borde del mapa"
                value={b.reinforcementMin[r.id]}
                min={0}
                max={HORIZON_MIN}
                step={10}
                display={minToHHMM(t0, b.reinforcementMin[r.id])}
                onChange={(v) => set({ reinforcementMin: { ...b.reinforcementMin, [r.id]: v } })}
                extra={<Supuesto source={r.arrivalSource} />}
              />
              <table className="brig-table">
                <tbody>
                  <tr>
                    {TYPES.map((k) => (
                      <td key={k}>
                        <span className="muted small">{UNIT_SHORT_ES[k]} </span>
                        <Stepper value={b.reinforcementUnits[r.id][k]} label={`${r.label}: ${UNIT_LABEL_ES[k]}`} onChange={(v) => setReinf(r.id, k, v)} />
                      </td>
                    ))}
                    <td>
                      <Supuesto source={r.source} />
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="hint">
                Entran por: {r.entries.map((e) => `${e.label}${e.delayMin > 0 ? ` (+${e.delayMin} min, supuesto)` : ''}`).join('; ')}.
              </div>
            </details>
          ))}

          <details className="brig-cuerpo">
            <summary>
              <span>Supuestos y fuentes del modelo</span>
            </summary>
            <ul className="small brig-params">
              {params.map((x) => (
                <li key={x.labelEs}>
                  {x.labelEs}: <b>{fmtInt(x.value)} {x.unit}</b> <Supuesto source={x.source} />
                </li>
              ))}
              <li>Velocidad de los carros: la de un auto en flujo libre según el tipo de calle, sin congestión ni sirenas (supuesto).</li>
              <li>Sin grifos: el agua es la del estanque y la de los aljibes del mismo sector (la SISS informó falta de agua por sobredemanda).</li>
              <li>
                Las rutas se calculan con el fuego sin bomberos: una calle que los bomberos salvaron igual figura cortada. Las calles cerradas con
                "Cerrar calle" solo afectan a la evacuación.
              </li>
              <li>Cuarteles: OpenStreetMap. Las compañías sin inventario con fuente parten con 1 carro bomba (supuesto).</li>
            </ul>
          </details>
        </>
      )}
    </Section>
  )
}
