/** Live controls for interactive parts (buttons, slide switches, knobs, light sensors). */
import { useMemo, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Hand, RotateCw, Sun } from 'lucide-react';
import type { PartDef, PartInstance, PropValue } from '@/contracts';
import { findPartDef } from '@/catalog';
import { useSim } from '@/store/sim';
import { actuatorKey, runtimeValue } from './pinRows';

interface Item {
  part: PartInstance;
  def: PartDef;
  key: string;
}

type Setter = (value: PropValue) => void;

function PressControl({ label, pressed, set }: { label: string; pressed: boolean; set: Setter }) {
  const press = (v: boolean) => {
    if (v !== pressed) set(v);
  };
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture not supported */
    }
    press(true);
  };
  const isKey = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter';
  return (
    <button
      type="button"
      className={`simp-press ${pressed ? 'is-down' : ''}`}
      onPointerDown={onDown}
      onPointerUp={() => press(false)}
      onPointerCancel={() => press(false)}
      onLostPointerCapture={() => press(false)}
      onKeyDown={(e) => {
        if (isKey(e) && !e.repeat) {
          e.preventDefault();
          press(true);
        }
      }}
      onKeyUp={(e) => isKey(e) && press(false)}
      onBlur={() => press(false)}
      aria-pressed={pressed}
      title="Mantén presionado para simular que aprietas el botón"
    >
      <span className="simp-press-cap" aria-hidden>
        <Hand size={12} />
      </span>
      <span className="simp-ctrl-name">{label}</span>
      <span className="simp-ctrl-state">{pressed ? 'Presionado' : 'Mantener'}</span>
    </button>
  );
}

function ToggleControl({ label, def, propKey, value, set }: { label: string; def: PartDef; propKey: string; value: PropValue | undefined; set: Setter }) {
  const opts = def.props.find((p) => p.key === propKey)?.options ?? [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ];
  return (
    <div className="simp-ctrl">
      <span className="simp-ctrl-name">{label}</span>
      <div className="simp-seg" role="radiogroup" aria-label={label}>
        {opts.map((o) => (
          <button key={String(o.value)} role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-active' : ''} onClick={() => value !== o.value && set(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SliderControl({ label, kind, def, propKey, value, set }: { label: string; kind: 'knob' | 'light'; def: PartDef; propKey: string; value: PropValue | undefined; set: Setter }) {
  const prop = def.props.find((p) => p.key === propKey);
  const min = prop?.min ?? 0;
  const max = prop?.max ?? 100;
  const v = typeof value === 'number' && Number.isFinite(value) ? value : Number(prop?.default ?? 50);
  const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
  return (
    <label className={`simp-ctrl simp-slider is-${kind}`}>
      <span className="simp-ctrl-icon" aria-hidden>
        {kind === 'light' ? <Sun size={12} /> : <RotateCw size={12} />}
      </span>
      <span className="simp-ctrl-name">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={prop?.step ?? 1}
        value={v}
        onChange={(e) => set(Number(e.target.value))}
        style={{ '--simp-fill': `${pct}%` } as CSSProperties}
        aria-label={`${label}: ${kind === 'light' ? 'luz' : 'posición'}`}
      />
      <span className="simp-ctrl-val">{Math.round(v)}%</span>
    </label>
  );
}

export function LiveControls({ parts }: { parts: PartInstance[] }) {
  const runtime = useSim((s) => s.runtime);
  const setRuntime = useSim((s) => s.setRuntime);
  const items = useMemo<Item[]>(
    () =>
      parts.flatMap((part) => {
        const def = findPartDef(part.type);
        if (!def?.interactive) return [];
        const key = actuatorKey(def);
        return key ? [{ part, def, key }] : [];
      }),
    [parts],
  );
  if (items.length === 0) return null;

  return (
    <div className="simp-group">
      <div className="simp-group-label">Controles</div>
      <div className="simp-controls">
        {items.map(({ part, def, key }) => {
          const value = runtimeValue(runtime[part.id], part.props, def, key);
          const set: Setter = (v) => setRuntime(part.id, key, v);
          const label = part.label || part.id;
          switch (def.interactive) {
            case 'press':
              return <PressControl key={part.id} label={label} pressed={value === true} set={set} />;
            case 'toggle':
              return <ToggleControl key={part.id} label={label} def={def} propKey={key} value={value} set={set} />;
            case 'knob':
            case 'light':
              return <SliderControl key={part.id} label={label} kind={def.interactive} def={def} propKey={key} value={value} set={set} />;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
