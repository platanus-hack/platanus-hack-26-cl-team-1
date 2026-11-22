// Small form controls shared by the panel.
import type { ReactNode } from 'react'

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <svg className="chev" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </summary>
      <div className="section-body">{children}</div>
    </details>
  )
}

export function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
  hint?: ReactNode
  disabled?: boolean
  extra?: ReactNode
}) {
  return (
    <div className={`field${props.disabled ? ' disabled' : ''}`}>
      <div className="field-head">
        <label>{props.label}</label>
        <span className="value">{props.display}</span>
      </div>
      <div className="field-row">
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          disabled={props.disabled}
          aria-label={props.label}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
        {props.extra}
      </div>
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  sub,
  title,
}: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  sub?: ReactNode
  title?: string
}) {
  return (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
      <span className="toggle-text">
        {label}
        {sub && <span className="sub">{sub}</span>}
      </span>
    </label>
  )
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']

/** Spanish compass label for a "from" direction in degrees. */
export function compassLabel(deg: number): string {
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
}

/** Small compass: the arrow points where the wind blows TO (from + 180). */
export function Compass({ fromDeg }: { fromDeg: number }) {
  const to = ((fromDeg + 180) * Math.PI) / 180
  const cx = 18
  const cy = 18
  const r = 12
  const hx = cx + Math.sin(to) * r
  const hy = cy - Math.cos(to) * r
  const tx = cx - Math.sin(to) * r
  const ty = cy + Math.cos(to) * r
  const a1 = to + Math.PI - 0.5
  const a2 = to + Math.PI + 0.5
  return (
    <svg className="compass" viewBox="0 0 36 36" aria-label={`Viento desde ${compassLabel(fromDeg)}`} role="img">
      <circle cx={cx} cy={cy} r={16} className="ring" />
      <text x={cx} y={7.5} textAnchor="middle" className="n">N</text>
      <line x1={tx} y1={ty} x2={hx} y2={hy} className="arrow" />
      <path d={`M${hx},${hy}L${hx + Math.sin(a1) * 5},${hy - Math.cos(a1) * 5}L${hx + Math.sin(a2) * 5},${hy - Math.cos(a2) * 5}Z`} className="head" />
    </svg>
  )
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('es-CL')
}

export function fmtSigned(n: number, digits = 0): string {
  const s = n.toLocaleString('es-CL', { maximumFractionDigits: digits, minimumFractionDigits: digits })
  return n > 0 ? `+${s}` : s
}
