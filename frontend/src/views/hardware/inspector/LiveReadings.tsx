import { useShallow } from 'zustand/react/shallow';
import { Activity } from 'lucide-react';
import type { PartDef, PartSimState } from '@/contracts';
import { formatCurrent, formatVolts } from '@/lib/format';
import { useSim } from '@/store/sim';
import { Metric, Section, EmptyNote } from './ui';

const pct = (v: number) => `${Math.round(v * 100)} %`;
const fmtW = (w: number) => (Math.abs(w) >= 1 ? `${w.toFixed(2).replace('.', ',')} W` : `${Math.round(w * 1000)} mW`);

/** Readings that make sense for this electrical model. */
export function readingsFor(def: PartDef, s: PartSimState): Array<{ label: string; value: string; tone?: 'accent' | 'warning' | 'danger' | 'blue' | 'violet'; bar?: number; sub?: string }> {
  const out: Array<{ label: string; value: string; tone?: 'accent' | 'warning' | 'danger' | 'blue' | 'violet'; bar?: number; sub?: string }> = [];
  const model = def.electrical.model;
  if (model === 'mcu' || model === 'bus' || model === 'none') return out;
  out.push({ label: 'Voltaje', value: formatVolts(s.voltage), tone: 'blue' });
  out.push({ label: 'Corriente', value: formatCurrent(Math.abs(s.currentA)), tone: s.overloaded ? 'danger' : 'accent' });
  if (s.powerW !== undefined && Math.abs(s.powerW) >= 1e-4) out.push({ label: 'Potencia', value: fmtW(Math.abs(s.powerW)) });
  if (s.brightness !== undefined) out.push({ label: 'Brillo', value: pct(s.brightness), bar: s.brightness, tone: 'warning' });
  if (s.rgb) out.push({ label: 'Color RGB', value: s.rgb.map((c) => Math.round(c * 255)).join(' · '), tone: 'violet' });
  if (s.speed !== undefined) out.push({ label: 'Velocidad', value: pct(Math.abs(s.speed)), bar: Math.abs(s.speed), sub: s.speed < 0 ? 'Sentido inverso' : s.speed > 0 ? 'Sentido directo' : undefined });
  if (s.angle !== undefined) out.push({ label: 'Ángulo', value: `${Math.round(s.angle)}°`, bar: s.angle / 180 });
  if (s.region) out.push({ label: 'Región', value: s.region, tone: 'violet' });
  if (s.sounding !== undefined) out.push({ label: 'Sonido', value: s.sounding ? (s.toneHz ? `${Math.round(s.toneHz)} Hz` : 'Sonando') : 'En silencio', tone: s.sounding ? 'accent' : undefined });
  if (s.powered !== undefined && model === 'servo') out.push({ label: 'Alimentación', value: s.powered ? 'Sí' : 'No', tone: s.powered ? 'accent' : 'warning' });
  return out;
}

export function LiveReadings({ partId, def }: { partId: string; def: PartDef }) {
  const s = useSim(useShallow((st) => st.result?.parts[partId]));
  const live = useSim((st) => st.live);
  const rows = s ? readingsFor(def, s) : [];
  if (def.electrical.model === 'bus' || def.electrical.model === 'none') return null;
  return (
    <Section
      title="Lecturas en vivo"
      icon={<Activity size={13} />}
      right={live ? <span className="ins-live-dot" aria-label="En vivo" /> : undefined}
    >
      {!s ? (
        <EmptyNote>Aún no hay mediciones: conecta el componente para ver su voltaje y corriente.</EmptyNote>
      ) : (
        <>
          <div className="ins-metrics">
            {rows.map((r) => (
              <Metric key={r.label} label={r.label} value={r.value} tone={r.tone} bar={r.bar} sub={r.sub} />
            ))}
          </div>
          {(s.overloaded || s.reversed) && (
            <div className="ins-flags">
              {s.overloaded && <span className="chip err">Sobrecarga: supera sus límites</span>}
              {s.reversed && <span className="chip warn">Polarizado al revés</span>}
            </div>
          )}
        </>
      )}
    </Section>
  );
}
