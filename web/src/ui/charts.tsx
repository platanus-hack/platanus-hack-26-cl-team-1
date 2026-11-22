// Small inline SVG charts for the panel.
import type { WeatherSeries } from '../engine/types'
import { minToHHMM } from '../data/time'
import { HORIZON_MIN } from '../worker/scenario'

const W = 320
const H = 120
const PAD = { l: 34, r: 28, t: 10, b: 20 }
const IW = W - PAD.l - PAD.r
const IH = H - PAD.t - PAD.b

function xOf(t: number) {
  return PAD.l + (t / HORIZON_MIN) * IW
}

function timeTicks(t0: string) {
  const ticks = []
  for (let t = 0; t <= HORIZON_MIN; t += 180) ticks.push({ t, label: minToHHMM(t0, t) })
  return ticks
}

/** Compact axis label: 12000 -> "12 mil". */
function axisLabel(v: number) {
  return v.toLocaleString('es-CL', { notation: 'compact', maximumFractionDigits: 1 })
}

function niceMax(v: number) {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

export function WeatherChart({ series, t0, clock }: { series: WeatherSeries; t0: string; clock: number }) {
  const pts: { t: number; wind: number; rh: number }[] = []
  for (let i = 0; i < series.samples.length; i++) {
    const t = series.t0Min + i * series.stepMin
    if (t < 0 || t > HORIZON_MIN) continue
    pts.push({ t, wind: series.samples[i].windKmh, rh: series.samples[i].rh })
  }
  if (series.samples.length === 1) {
    const s = series.samples[0]
    pts.push({ t: 0, wind: s.windKmh, rh: s.rh }, { t: HORIZON_MIN, wind: s.windKmh, rh: s.rh })
  }
  const wMax = niceMax(Math.max(10, ...pts.map((q) => q.wind)))
  const yW = (v: number) => PAD.t + IH - (v / wMax) * IH
  const yH = (v: number) => PAD.t + IH - (v / 100) * IH
  const path = (f: (q: (typeof pts)[number]) => number) => pts.map((q, i) => `${i ? 'L' : 'M'}${xOf(q.t).toFixed(1)},${f(q).toFixed(1)}`).join('')
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Viento y humedad por hora">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + IH * f} y2={PAD.t + IH * f} className="grid" />
      ))}
      {timeTicks(t0).map((k) => (
        <text key={k.t} x={xOf(k.t)} y={H - 5} className="tick" textAnchor="middle">
          {k.label}
        </text>
      ))}
      <text x={PAD.l - 4} y={PAD.t + 4} className="tick wind" textAnchor="end">{axisLabel(wMax)}</text>
      <text x={PAD.l - 4} y={PAD.t + IH} className="tick wind" textAnchor="end">0</text>
      <text x={W - PAD.r + 4} y={PAD.t + 4} className="tick rh">100</text>
      <text x={W - PAD.r + 4} y={PAD.t + IH} className="tick rh">0</text>
      <path d={path((q) => yH(q.rh))} className="line rh" />
      <path d={path((q) => yW(q.wind))} className="line wind" />
      <line x1={xOf(clock)} x2={xOf(clock)} y1={PAD.t} y2={PAD.t + IH} className="marker" />
    </svg>
  )
}

export function RiskChart({
  curve,
  alertMin,
  t0,
  onPick,
}: {
  curve: { alertMin: number; expectedTrappedHouseholds: number }[]
  alertMin: number
  t0: string
  /** Click on the chart: choose that alert time (minutes since t0, 5-minute steps). */
  onPick?: (alertMin: number) => void
}) {
  if (curve.length === 0) return <p className="muted small">Sin curva de riesgo (el motor de evacuación no la entregó).</p>
  const yMax = niceMax(Math.max(1, ...curve.map((c) => c.expectedTrappedHouseholds)))
  const y = (v: number) => PAD.t + IH - (v / yMax) * IH
  const d = curve.map((c, i) => `${i ? 'L' : 'M'}${xOf(c.alertMin).toFixed(1)},${y(c.expectedTrappedHouseholds).toFixed(1)}`).join('')
  const area = `${d}L${xOf(curve[curve.length - 1].alertMin).toFixed(1)},${PAD.t + IH}L${xOf(curve[0].alertMin).toFixed(1)},${PAD.t + IH}Z`
  return (
    <svg
      className={`chart${onPick ? ' pickable' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Hogares con la salida cortada según la hora de la alerta"
      onClick={(e) => {
        if (!onPick) return
        const r = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - r.left) / r.width) * W
        const t = ((x - PAD.l) / IW) * HORIZON_MIN
        // a click left or right of the plot area picks its first or last time
        onPick(Math.round(Math.min(HORIZON_MIN, Math.max(0, t)) / 5) * 5)
      }}
    >
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + IH * f} y2={PAD.t + IH * f} className="grid" />
      ))}
      {timeTicks(t0).map((k) => (
        <text key={k.t} x={xOf(k.t)} y={H - 5} className="tick" textAnchor="middle">
          {k.label}
        </text>
      ))}
      <text x={PAD.l - 4} y={PAD.t + 4} className="tick" textAnchor="end">{axisLabel(yMax)}</text>
      <text x={PAD.l - 4} y={PAD.t + IH} className="tick" textAnchor="end">0</text>
      <path d={area} className="area risk" />
      <path d={d} className="line risk" />
      <line x1={xOf(alertMin)} x2={xOf(alertMin)} y1={PAD.t} y2={PAD.t + IH} className="marker alert" />
    </svg>
  )
}
