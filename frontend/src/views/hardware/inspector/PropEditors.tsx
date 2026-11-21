import { Hand } from 'lucide-react';
import type { PartDef, PartInstance, PropDef, PropValue } from '@/contracts';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { formatOhms } from '@/lib/format';
import { effectiveProp } from '../logic/partInfo';
import { Toggle } from './ui';

/** Colour-like enum props rendered as swatches (values map to theme wire colours). */
const SWATCH_KEYS = new Set(['color', 'cap', 'colour']);
const SWATCH_VAR: Record<string, string> = {
  red: 'var(--wire-red)',
  green: 'var(--wire-green)',
  yellow: 'var(--wire-yellow)',
  blue: 'var(--wire-blue)',
  white: 'var(--wire-white)',
  black: 'var(--wire-black)',
  orange: 'var(--wire-orange)',
  purple: 'var(--wire-purple)',
};

export const isSwatchProp = (p: PropDef) =>
  p.type === 'enum' && SWATCH_KEYS.has(p.key) && (p.options ?? []).every((o) => typeof o.value === 'string' && o.value in SWATCH_VAR);

function formatNumber(p: PropDef, v: number): string {
  if (p.unit === 'Ω') return formatOhms(v);
  const n = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(v);
  return p.unit ? `${n} ${p.unit}` : n;
}

interface EditorProps {
  prop: PropDef;
  value: PropValue | undefined;
  onChange: (v: PropValue, continuous?: boolean) => void;
}

function PropEditor({ prop, value, onChange }: EditorProps) {
  if (prop.type === 'enum') {
    const options = prop.options ?? [];
    if (isSwatchProp(prop)) {
      return (
        <div className="ins-swatches" role="radiogroup" aria-label={prop.label}>
          {options.map((o) => (
            <button
              key={String(o.value)}
              role="radio"
              aria-checked={value === o.value}
              className={`ins-swatch${value === o.value ? ' is-active' : ''}`}
              style={{ ['--sw' as string]: SWATCH_VAR[String(o.value)] }}
              onClick={() => onChange(o.value)}
              title={o.label}
            />
          ))}
          <span className="ins-swatch-label">{options.find((o) => o.value === value)?.label ?? ''}</span>
        </div>
      );
    }
    if (options.length <= 3) {
      return (
        <div className="ins-seg">
          {options.map((o) => (
            <button key={String(o.value)} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      );
    }
    return (
      <select
        className="ins-select"
        value={String(value ?? '')}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
        aria-label={prop.label}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === 'number') {
    const min = prop.min ?? 0;
    const max = prop.max ?? 100;
    const n = typeof value === 'number' ? value : Number(prop.default) || 0;
    const pct = max > min ? ((n - min) / (max - min)) * 100 : 0;
    return (
      <div className="ins-slider">
        <input
          type="range"
          className="hw-range"
          min={min}
          max={max}
          step={prop.step ?? 1}
          value={n}
          style={{ ['--hw-range-pct' as string]: `${pct}%` }}
          onChange={(e) => onChange(Number(e.target.value), true)}
          aria-label={prop.label}
        />
        <span className="ins-slider-value">{formatNumber(prop, n)}</span>
      </div>
    );
  }
  return <Toggle checked={value === true} onChange={(v) => onChange(v)} label={prop.label} />;
}

/** Hold-to-press button for runtime booleans (pulsador). */
function HoldButton({ pressed, onChange }: { pressed: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`ins-hold${pressed ? ' is-pressed' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onChange(true);
      }}
      onPointerUp={() => onChange(false)}
      onPointerCancel={() => onChange(false)}
    >
      <Hand size={14} />
      {pressed ? 'Presionado' : 'Mantén para presionar'}
    </button>
  );
}

/** Persisted (non-runtime) props: edited through part.setProps. */
export function DesignProps({ part, def }: { part: PartInstance; def: PartDef }) {
  const props = def.props.filter((p) => !p.runtime);
  if (!props.length) return null;
  return (
    <div className="ins-props">
      {props.map((p) => (
        <div key={p.key} className="ins-prop">
          <span className="ins-prop-label">{p.label}</span>
          <PropEditor
            prop={p}
            value={effectiveProp(part, def, undefined, p.key)}
            onChange={(v, continuous) =>
              useProject.getState().dispatch(
                { op: 'part.setProps', id: part.id, props: { [p.key]: v } },
                { label: `Cambiar ${p.label.toLowerCase()}`, mergeKey: continuous ? `hw-prop-${part.id}-${p.key}` : undefined },
              )
            }
          />
        </div>
      ))}
    </div>
  );
}

/** Runtime props (pressed, position, light…): edit the live sim, not the project. */
export function RuntimeProps({ part, def }: { part: PartInstance; def: PartDef }) {
  const rt = useSim((s) => s.runtime[part.id]);
  const props = def.props.filter((p) => p.runtime);
  if (!props.length) return null;
  const set = (key: string, v: PropValue) => useSim.getState().setRuntime(part.id, key, v);
  return (
    <div className="ins-props">
      {props.map((p) => {
        const value = effectiveProp(part, def, rt, p.key);
        return (
          <div key={p.key} className="ins-prop">
            <span className="ins-prop-label">{p.label}</span>
            {p.type === 'boolean' && def.interactive === 'press' ? (
              <HoldButton pressed={value === true} onChange={(v) => set(p.key, v)} />
            ) : (
              <PropEditor prop={p} value={value} onChange={(v) => set(p.key, v)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
