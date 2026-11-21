import { CircuitBoard, Copy, Keyboard, Lightbulb, MousePointerClick, RotateCw, Trash2 } from 'lucide-react';
import type { Id } from '@/contracts';
import { findPartDef, projectBoard } from '@/catalog';
import { PartThumbnail } from '@/parts/PartThumbnail';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { useHW } from '../state';
import { addStarter, deleteSelection, duplicateSelection, rotateSelection } from '../actions';
import { isBoard, isBreadboard } from '../logic/partInfo';
import { Metric, Section } from './ui';

const SHORTCUTS: Array<[string, string]> = [
  ['V', 'Seleccionar'],
  ['W', 'Dibujar cable'],
  ['R', 'Rotar'],
  ['Supr', 'Eliminar'],
  ['Ctrl D', 'Duplicar'],
  ['Espacio', 'Arrastrar la vista'],
  ['Rueda', 'Zoom'],
  ['0', 'Ajustar a la vista'],
];

export function ProjectOverview() {
  const project = useProject((s) => s.project);
  const issues = useHW((s) => s.issues);
  const board = projectBoard(project);
  const components = project.parts.filter((p) => {
    const d = findPartDef(p.type);
    return d && !isBoard(d) && !isBreadboard(d);
  }).length;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const boardDef = board ? findPartDef(board.part.type) : undefined;
  return (
    <div className="ins-stack">
      <div className="ins-overview-head">
        <span className="ins-kicker">Proyecto</span>
        <h2 className="ins-overview-title">{project.name}</h2>
        {project.meta.description && <p className="ins-muted">{project.meta.description}</p>}
      </div>

      {board && boardDef ? (
        <button className="ins-board-card" onClick={() => useUI.getState().select({ parts: [board.part.id] })}>
          <PartThumbnail def={boardDef} size={54} />
          <span className="ins-board-text">
            <strong>{board.profile.name}</strong>
            <span>
              {board.profile.mcu} · {String(board.profile.logicVoltage).replace('.', ',')} V
            </span>
          </span>
          <CircuitBoard size={16} className="ins-board-icon" />
        </button>
      ) : (
        <div className="ins-noboard">
          <strong>Sin placa</strong>
          <p>Agrega un Arduino Uno o un ESP32-C6 para poder programar tu circuito.</p>
          {project.parts.length === 0 && (
            <div className="ins-noboard-actions">
              <button className="btn sm primary" onClick={() => addStarter('uno')}>
                Arduino Uno
              </button>
              <button className="btn sm" onClick={() => addStarter('esp32c6')}>
                ESP32-C6
              </button>
            </div>
          )}
        </div>
      )}

      <div className="ins-metrics ins-metrics--3">
        <Metric label="Componentes" value={components} />
        <Metric label="Cables" value={project.wires.length} />
        <Metric
          label="Revisión"
          value={errors + warnings === 0 ? 'OK' : errors + warnings}
          tone={errors ? 'danger' : warnings ? 'warning' : 'accent'}
          sub={errors ? `${errors} error${errors > 1 ? 'es' : ''}` : warnings ? `${warnings} aviso${warnings > 1 ? 's' : ''}` : 'Todo en orden'}
        />
      </div>

      <div className="ins-cta">
        <MousePointerClick size={16} />
        <span>Arrastra componentes desde la izquierda y conéctalos con cables.</span>
      </div>

      <Section title="Consejos" icon={<Lightbulb size={13} />}>
        <ul className="ins-tips">
          <li>Pasa el mouse sobre un agujero de la protoboard: se ilumina toda la tira conectada.</li>
          <li>Los LED siempre necesitan una resistencia en serie (220 Ω es un buen valor).</li>
          <li>Usa cable rojo para + y negro para GND: se colorean solos.</li>
          <li>Haz clic sobre botones e interruptores para usarlos mientras simulas.</li>
        </ul>
      </Section>

      <Section title="Atajos" icon={<Keyboard size={13} />} collapsible defaultOpen={false}>
        <ul className="ins-shortcuts">
          {SHORTCUTS.map(([k, label]) => (
            <li key={k}>
              <span className="kbd">{k}</span>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export function MultiInspector({ parts, wires }: { parts: Id[]; wires: Id[] }) {
  const project = useProject((s) => s.project);
  const items = parts
    .map((id) => project.parts.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, 12);
  const total = parts.length + wires.length;
  return (
    <div className="ins-stack">
      <div className="ins-overview-head">
        <span className="ins-kicker">Selección múltiple</span>
        <h2 className="ins-overview-title">{total} elementos</h2>
        <p className="ins-muted">
          {parts.length} componente{parts.length === 1 ? '' : 's'} · {wires.length} cable{wires.length === 1 ? '' : 's'}
        </p>
      </div>
      {items.length > 0 && (
        <div className="ins-multi-grid">
          {items.map((p) => {
            const d = findPartDef(p.type);
            return (
              <button key={p.id} className="ins-multi-item" onClick={() => useUI.getState().select({ parts: [p.id] })} title={p.label}>
                {d && <PartThumbnail def={d} size={40} props={p.props} />}
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="ins-actions">
        {parts.length > 0 && (
          <>
            <button className="btn sm" onClick={rotateSelection}>
              <RotateCw size={13} /> Rotar
            </button>
            <button className="btn sm" onClick={duplicateSelection}>
              <Copy size={13} /> Duplicar
            </button>
          </>
        )}
        <button className="btn sm danger" onClick={deleteSelection}>
          <Trash2 size={13} /> Eliminar
        </button>
      </div>
    </div>
  );
}
