import { useMemo } from 'react';
import { BatteryCharging, Cpu, Trash2 } from 'lucide-react';
import type { BoardPin, BoardProfile, PartDef, PartInstance } from '@/contracts';
import { canonicalBoardPin } from '@/catalog';
import { PartThumbnail } from '@/parts/PartThumbnail';
import { formatCurrent, formatVolts } from '@/lib/format';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { getBindings } from '@/store/derived';
import { deleteSelection } from '../actions';
import { LabelInput } from './PartInspector';
import { EducationCard } from './EducationCard';
import { Section } from './ui';

function usedBy(project: ReturnType<typeof useProject.getState>['project']): Map<string, string[]> {
  const m = new Map<string, string[]>();
  try {
    for (const b of getBindings(project)) {
      if (!b.boardPin) continue;
      const label = project.parts.find((p) => p.id === b.part)?.label ?? b.part;
      const arr = m.get(b.boardPin);
      if (arr) {
        if (!arr.includes(label)) arr.push(label);
      } else m.set(b.boardPin, [label]);
    }
  } catch {
    /* bindings not available yet */
  }
  return m;
}

function PinRow({ pin, profile, users }: { pin: BoardPin; profile: BoardProfile; users?: string[] }) {
  const canonical = canonicalBoardPin(profile, pin.id);
  const state = useSim((s) => s.result?.boardPins[canonical]);
  const isGpio = pin.kind === 'gpio';
  let value = '—';
  if (state) value = formatVolts(state.volts);
  else if (pin.kind === 'ground') value = '0 V';
  return (
    <li className={`ins-bpin is-${pin.kind}`}>
      <span className="ins-bpin-dot" />
      <span className="ins-bpin-label">
        {pin.label || pin.id}
        {pin.aliasOf && <em>= {pin.aliasOf}</em>}
      </span>
      <span className="ins-bpin-users">{users?.join(', ')}</span>
      <span className="ins-bpin-volts">{value}</span>
      {isGpio && state ? (
        <span className={`ins-bpin-digital${state.digital ? ' is-high' : ''}`}>{state.digital ? 'ALTO' : 'BAJO'}</span>
      ) : (
        <span className="ins-bpin-digital is-none" />
      )}
    </li>
  );
}

export function BoardInspector({ part, def, profile }: { part: PartInstance; def: PartDef; profile: BoardProfile }) {
  const project = useProject((s) => s.project);
  const supplies = useSim((s) => s.result?.supplies);
  const groups = useMemo(() => {
    const m = new Map<string, BoardPin[]>();
    for (const p of profile.pins) {
      if (p.kind === 'nc') continue;
      const arr = m.get(p.header);
      if (arr) arr.push(p);
      else m.set(p.header, [p]);
    }
    return [...m.entries()];
  }, [profile]);
  const users = useMemo(() => usedBy(project), [project]);
  const mySupplies = (supplies ?? []).filter((s) => s.part === part.id);
  return (
    <div className="ins-stack">
      <div className="ins-hero">
        <div className="ins-hero-thumb">
          <PartThumbnail def={def} size={92} />
        </div>
        <div className="ins-hero-meta">
          <span className="ins-kicker">Placa programable</span>
          <LabelInput part={part} />
          <span className="ins-hero-sub">
            {profile.name} · <span className="mono">{profile.mcu}</span>
          </span>
        </div>
      </div>
      <div className="ins-chips">
        <span className="chip info">Lógica {String(profile.logicVoltage).replace('.', ',')} V</span>
        <span className="chip">ADC {profile.adc.bits} bits</span>
        <span className="chip">Máx. {profile.pinCurrent.maxmA} mA por pin</span>
      </div>
      <div className="ins-actions">
        <button className="btn sm danger" onClick={deleteSelection}>
          <Trash2 size={13} /> Eliminar placa
        </button>
      </div>

      <Section title="Alimentación" icon={<BatteryCharging size={13} />}>
        {mySupplies.length ? (
          <ul className="ins-supplies">
            {mySupplies.map((s) => {
              const ratio = s.limitA ? Math.min(1, Math.abs(s.currentA) / s.limitA) : 0;
              return (
                <li key={s.id} className={s.overloaded ? 'is-over' : ''}>
                  <span className="ins-supply-name">{s.label}</span>
                  <span className="ins-supply-val">{formatCurrent(Math.abs(s.currentA))}{s.currentA < -1e-4 ? ' (al revés)' : ''}</span>
                  {s.limitA ? (
                    <span className="ins-metric-bar">
                      <span style={{ width: `${Math.round(ratio * 100)}%` }} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="ins-muted">Alimentada por USB ({profile.supply.usbVolts} V, hasta {profile.supply.usbMaxmA} mA).</p>
        )}
      </Section>

      <Section title="Pines" icon={<Cpu size={13} />} right={<span className="ins-muted mono">{profile.pins.length}</span>}>
        {groups.map(([header, pins]) => (
          <div key={header} className="ins-bgroup">
            <div className="ins-bgroup-title">{header}</div>
            <ul className="ins-bpins">
              {pins.map((p) => (
                <PinRow key={p.id} pin={p} profile={profile} users={users.get(canonicalBoardPin(profile, p.id))} />
              ))}
            </ul>
          </div>
        ))}
      </Section>
      <EducationCard def={def} />
    </div>
  );
}
