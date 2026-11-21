import { useEffect, useState } from 'react';
import { Copy, Flame, Plug, RotateCw, SlidersHorizontal, Trash2, Zap } from 'lucide-react';
import { CATEGORY_LABELS, type Netlist, type PartDef, type PartInstance, type ProjectModel } from '@/contracts';
import { PartThumbnail } from '@/parts/PartThumbnail';
import { pinRef } from '@/lib/pinref';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { getBindings } from '@/store/derived';
import { deleteSelection, duplicateSelection, rotateSelection } from '../actions';
import { describePin, isBreadboard } from '../logic/partInfo';
import { safeNetlist } from '../canvas/overlays';
import { DesignProps, RuntimeProps } from './PropEditors';
import { LiveReadings } from './LiveReadings';
import { EducationCard } from './EducationCard';
import { Section } from './ui';

export function LabelInput({ part }: { part: PartInstance }) {
  const [value, setValue] = useState(part.label);
  useEffect(() => setValue(part.label), [part.label]);
  return (
    <input
      className="ins-label-input"
      value={value}
      maxLength={40}
      onChange={(e) => {
        setValue(e.target.value);
        const v = e.target.value.trim();
        if (v) useProject.getState().dispatch({ op: 'part.setLabel', id: part.id, label: v }, { label: 'Renombrar componente', mergeKey: `hw-label-${part.id}` });
      }}
      onBlur={() => setValue(part.label)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label="Nombre del componente"
    />
  );
}

/** Where a pin goes: named net, or the other parts it touches. */
export function pinConnection(project: ProjectModel, netlist: Netlist | null, ref: string): { text: string; connected: boolean } {
  const netId = netlist?.pinNet[ref];
  const net = netId ? netlist?.nets.find((n) => n.id === netId) : undefined;
  if (!net) return { text: 'Sin conectar', connected: false };
  const others = net.pins.filter((p) => p !== ref).map((p) => describePin(project, p));
  const parts = others.filter((o) => o.def && !isBreadboard(o.def));
  if (net.name && parts.length === 0) return { text: net.name, connected: true };
  if (parts.length) {
    const first = parts.slice(0, 2).map((o) => `${o.partLabel} · ${o.pinLabel}`).join(', ');
    const extra = parts.length > 2 ? ` +${parts.length - 2}` : '';
    return { text: `${net.name ? `${net.name} · ` : ''}${first}${extra}`, connected: true };
  }
  const holes = others.filter((o) => o.def && isBreadboard(o.def));
  if (holes.length) return { text: 'Solo en la protoboard', connected: false };
  return { text: 'Sin conectar', connected: false };
}

function Connections({ part, def }: { part: PartInstance; def: PartDef }) {
  const project = useProject((s) => s.project);
  const netlist = safeNetlist(project);
  let bindings: ReturnType<typeof getBindings> = [];
  try {
    bindings = getBindings(project).filter((b) => b.part === part.id);
  } catch {
    bindings = [];
  }
  const pins = def.pins.slice(0, 16);
  if (!pins.length) return null;
  return (
    <Section title="Conexiones" icon={<Plug size={13} />} collapsible>
      {bindings.length > 0 && (
        <div className="ins-bindings">
          {bindings.map((b, i) => (
            <span key={i} className={`chip ${b.boardPin ? 'ok' : 'warn'}`}>
              {b.channel ? `${b.channel.toUpperCase()}: ` : ''}
              {b.boardPin ? `Pin ${b.boardPin}${b.activeLow ? ' (activo en BAJO)' : ''}` : 'Sin pin de la placa'}
            </span>
          ))}
        </div>
      )}
      <ul className="ins-pins">
        {pins.map((p) => {
          const c = pinConnection(project, netlist, pinRef(part.id, p.id));
          return (
            <li key={p.id} className={c.connected ? 'is-connected' : ''}>
              <span className="ins-pin-dot" />
              <span className="ins-pin-name">
                {p.label}
                {p.hint && <em>{p.hint}</em>}
              </span>
              <span className="ins-pin-net">{c.text}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function PartInspector({ part, def }: { part: PartInstance; def: PartDef }) {
  const burnedStore = useSim((s) => s.burned.includes(part.id));
  const burnedSim = useSim((s) => !!s.result?.parts[part.id]?.burned);
  const burned = burnedStore || burnedSim;
  const hasDesign = def.props.some((p) => !p.runtime);
  const hasRuntime = def.props.some((p) => p.runtime);
  return (
    <div className="ins-stack">
      <div className="ins-hero">
        <div className="ins-hero-thumb">
          <PartThumbnail def={def} size={92} props={part.props} />
        </div>
        <div className="ins-hero-meta">
          <span className="ins-kicker">{CATEGORY_LABELS[def.category]}</span>
          <LabelInput part={part} />
          <span className="ins-hero-sub">
            {def.name} · <span className="mono">{part.id}</span>
          </span>
        </div>
      </div>
      <div className="ins-actions">
        <button className="btn sm" onClick={rotateSelection} title="Rotar 90° (R)">
          <RotateCw size={13} /> Rotar
        </button>
        <button className="btn sm" onClick={duplicateSelection} title="Duplicar (Ctrl+D)">
          <Copy size={13} /> Duplicar
        </button>
        <button className="btn sm danger" onClick={deleteSelection} title="Eliminar (Supr)">
          <Trash2 size={13} /> Eliminar
        </button>
      </div>

      {burned && (
        <div className="ins-burned">
          <Flame size={18} />
          <div>
            <strong>Este componente se quemó</strong>
            <p>Pasó demasiada corriente por él. Corrige el circuito (por ejemplo, agrega una resistencia) y reemplázalo.</p>
          </div>
          <button className="btn sm primary" onClick={() => useSim.getState().repair(part.id)}>
            Reemplazar
          </button>
        </div>
      )}

      {hasDesign && (
        <Section title="Propiedades" icon={<SlidersHorizontal size={13} />}>
          <DesignProps part={part} def={def} />
        </Section>
      )}
      {hasRuntime && (
        <Section title="Control en vivo" icon={<Zap size={13} />} right={<span className="chip info">Simulación</span>}>
          <RuntimeProps part={part} def={def} />
        </Section>
      )}
      <LiveReadings partId={part.id} def={def} />
      <Connections part={part} def={def} />
      <EducationCard def={def} />
    </div>
  );
}
