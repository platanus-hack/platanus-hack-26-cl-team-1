import { ArrowDown, Palette, Spline, Trash2, Zap } from 'lucide-react';
import type { Wire } from '@/contracts';
import { formatCurrent } from '@/lib/format';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { deleteSelection } from '../actions';
import { describePin } from '../logic/partInfo';
import { WIRE_COLORS, wireColorLabel } from '../logic/wireColor';
import { safeNetlist } from '../canvas/overlays';
import { Section } from './ui';

function Endpoint({ refStr, role }: { refStr: string; role: string }) {
  const project = useProject((s) => s.project);
  const info = describePin(project, refStr);
  const netlist = safeNetlist(project);
  const netId = netlist?.pinNet[refStr];
  const net = netId ? netlist?.nets.find((n) => n.id === netId) : undefined;
  const fresh = useSim((s) => (s.result && s.result.project === project ? s.result : null));
  const v = fresh?.pinVoltages[refStr];
  return (
    <div className="ins-endpoint">
      <span className="ins-endpoint-role">{role}</span>
      <span className="ins-endpoint-main">
        <strong>{info.partLabel}</strong> · {info.pinLabel}
      </span>
      <span className="ins-endpoint-meta">
        {net?.name && <span className="chip info">{net.name}</span>}
        {v !== undefined && <span className="mono">{v.toFixed(2).replace('.', ',')} V</span>}
      </span>
    </div>
  );
}

export function WireInspector({ wire }: { wire: Wire }) {
  const current = useSim((s) => s.result?.wireCurrents[wire.id]);
  const setColor = (color: Wire['color']) =>
    useProject.getState().dispatch({ op: 'wire.update', id: wire.id, patch: { color } }, { label: 'Cambiar color del cable' });
  const straighten = () =>
    useProject.getState().dispatch({ op: 'wire.update', id: wire.id, patch: { waypoints: [] } }, { label: 'Enderezar cable' });
  const amps = current ?? 0;
  const flowing = Math.abs(amps) > 0.05e-3;
  return (
    <div className="ins-stack">
      <div className={`ins-hero ins-hero--wire hw-wire--${wire.color}`}>
        <svg viewBox="0 0 92 56" className="ins-wire-art" aria-hidden>
          <path d="M8 44 C 30 52, 58 6, 84 12" className="ins-wire-art-outline" />
          <path d="M8 44 C 30 52, 58 6, 84 12" className="ins-wire-art-core" />
          <circle cx="8" cy="44" r="4" className="ins-wire-art-tip" />
          <circle cx="84" cy="12" r="4" className="ins-wire-art-tip" />
        </svg>
        <div className="ins-hero-meta">
          <span className="ins-kicker">Cable</span>
          <span className="ins-hero-title">Cable {wireColorLabel(wire.color).toLowerCase()}</span>
          <span className="ins-hero-sub mono">{wire.id}</span>
        </div>
      </div>

      <Section title="Color" icon={<Palette size={13} />}>
        <div className="ins-swatches">
          {WIRE_COLORS.map((c) => (
            <button
              key={c.value}
              className={`ins-swatch hw-wire--${c.value}${wire.color === c.value ? ' is-active' : ''}`}
              style={{ ['--sw' as string]: `var(--wire-${c.value})` }}
              onClick={() => setColor(c.value)}
              title={c.label}
              aria-label={c.label}
            />
          ))}
        </div>
        <p className="ins-muted">Convención: rojo para + (alimentación), negro para GND.</p>
      </Section>

      <Section title="Conecta" icon={<Spline size={13} />}>
        <div className="ins-endpoints">
          <Endpoint refStr={wire.from} role="Desde" />
          <ArrowDown size={14} className="ins-endpoint-arrow" />
          <Endpoint refStr={wire.to} role="Hasta" />
        </div>
      </Section>

      <Section title="Corriente" icon={<Zap size={13} />}>
        <div className={`ins-current${flowing ? ' is-flowing' : ''}`}>
          <span className="ins-current-value">{current === undefined ? '—' : formatCurrent(Math.abs(amps))}</span>
          <span className="ins-current-sub">
            {flowing ? (amps > 0 ? 'Fluye de “Desde” a “Hasta”' : 'Fluye de “Hasta” a “Desde”') : 'No circula corriente por este cable'}
          </span>
        </div>
      </Section>

      <div className="ins-actions">
        {wire.waypoints && wire.waypoints.length > 0 && (
          <button className="btn sm" onClick={straighten} title="Quitar los puntos de quiebre">
            <Spline size={13} /> Enderezar
          </button>
        )}
        <button className="btn sm danger" onClick={deleteSelection}>
          <Trash2 size={13} /> Eliminar cable
        </button>
      </div>
      <p className="ins-hint">Doble clic sobre el cable agrega un punto de quiebre; arrástralo para darle forma.</p>
    </div>
  );
}
