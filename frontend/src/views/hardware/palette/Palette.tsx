import { memo, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ChevronsLeft, ChevronsRight, Search, X } from 'lucide-react';
import { CATEGORY_LABELS, type PartCategory, type PartDef } from '@/contracts';
import { filterDefs } from '../logic/search';
import { allPartDefs, findPartDef } from '@/catalog';
import { PartThumbnail } from '@/parts/PartThumbnail';
import { useProject } from '@/store/project';
import { useHW } from '../state';
import { addPart, clientToWorld } from '../actions';
import { isBoard } from '../logic/partInfo';
import { useUI } from '@/store/ui';
import './palette.css';

const CATEGORY_ORDER: PartCategory[] = ['boards', 'prototyping', 'power', 'output', 'input', 'passive', 'semiconductor'];

/** Start a pointer drag from a palette card; a click (no movement) adds at the viewport centre. */
function startCardDrag(e: RPointerEvent, type: string) {
  if (e.button !== 0) return;
  e.preventDefault();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let dragging = false;
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    dragging = true;
    useHW.getState().set({ paletteDrag: { type, clientX: ev.clientX, clientY: ev.clientY } });
  };
  const finish = (ev: PointerEvent, cancelled: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', esc);
    const hw = useHW.getState();
    hw.set({ paletteDrag: null, ghost: null });
    if (cancelled) return;
    if (!dragging) {
      addPart(type);
      return;
    }
    if (useUI.getState().hardwareMode === 'schematic') {
      addPart(type);
      return;
    }
    const world = clientToWorld(ev.clientX, ev.clientY);
    if (world) addPart(type, world);
  };
  const up = (ev: PointerEvent) => finish(ev, false);
  const cancel = (ev: PointerEvent) => finish(ev, true);
  const esc = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') finish(new PointerEvent('pointercancel'), true);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', esc);
}

const PaletteCard = memo(function PaletteCard({ def, compact, blocked }: { def: PartDef; compact: boolean; blocked: boolean }) {
  return (
    <button
      className={`pal-card${compact ? ' is-compact' : ''}${blocked ? ' is-blocked' : ''}`}
      onPointerDown={(e) => startCardDrag(e, def.type)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          addPart(def.type);
        }
      }}
      title={blocked ? 'Ya hay una placa en el proyecto' : `${def.name}: ${def.description}`}
      aria-label={`Agregar ${def.name}`}
    >
      <span className="pal-thumb">
        <PartThumbnail def={def} size={compact ? 34 : 56} />
      </span>
      {!compact && (
        <span className="pal-text">
          <span className="pal-name">
            {def.name}
            {def.kitQty && def.kitQty > 1 ? <span className="pal-qty">×{def.kitQty}</span> : null}
          </span>
          <span className="pal-desc">{def.description}</span>
        </span>
      )}
    </button>
  );
});

export function Palette() {
  const [query, setQuery] = useState('');
  const collapsed = useHW((s) => s.paletteCollapsed);
  const hasBoard = useProject((s) => s.project.parts.some((p) => isBoard(findPartDef(p.type))));
  const inputRef = useRef<HTMLInputElement>(null);
  const defs = useMemo(() => allPartDefs(), []);
  const filtered = useMemo(() => filterDefs(defs, query), [defs, query]);
  const groups = useMemo(() => {
    const m = new Map<PartCategory, PartDef[]>();
    for (const d of filtered) {
      const arr = m.get(d.category);
      if (arr) arr.push(d);
      else m.set(d.category, [d]);
    }
    const order = [...CATEGORY_ORDER, ...[...m.keys()].filter((k) => !CATEGORY_ORDER.includes(k))];
    return order.filter((c) => m.has(c)).map((c) => ({ category: c, defs: m.get(c)! }));
  }, [filtered]);

  const toggle = () => useHW.getState().set({ paletteCollapsed: !collapsed });

  if (collapsed) {
    return (
      <aside className="pal pal--collapsed" aria-label="Componentes">
        <button className="pal-collapse" onClick={toggle} aria-label="Mostrar componentes" title="Mostrar componentes">
          <ChevronsRight size={16} />
        </button>
        <div className="pal-rail">
          {defs.map((d) => (
            <PaletteCard key={d.type} def={d} compact blocked={hasBoard && isBoard(d)} />
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="pal" aria-label="Componentes">
      <header className="pal-header">
        <span className="pal-title">Componentes</span>
        <span className="pal-count">{defs.length}</span>
        <button className="pal-collapse" onClick={toggle} aria-label="Ocultar componentes" title="Ocultar panel">
          <ChevronsLeft size={16} />
        </button>
      </header>
      <div className="pal-search">
        <Search size={14} className="pal-search-icon" />
        <input
          ref={inputRef}
          className="pal-search-input"
          placeholder="Buscar componente…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('');
              inputRef.current?.blur();
            } else if (e.key === 'Enter' && filtered.length) addPart(filtered[0].type);
          }}
          aria-label="Buscar componente"
        />
        {query && (
          <button className="pal-search-clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
            <X size={12} />
          </button>
        )}
      </div>
      <div className="pal-scroll">
        {groups.length === 0 && (
          <div className="pal-empty">
            Sin resultados para <b>“{query}”</b>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.category} className="pal-group">
            <h3 className="pal-group-title">
              <span>{CATEGORY_LABELS[g.category]}</span>
              <span className="pal-group-count">{g.defs.length}</span>
            </h3>
            <div className="pal-list">
              {g.defs.map((d) => (
                <PaletteCard key={d.type} def={d} compact={false} blocked={hasBoard && isBoard(d)} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <footer className="pal-footer">Arrastra al lienzo o haz clic para agregar</footer>
    </aside>
  );
}

/** Floating thumbnail that follows the cursor while dragging from the palette outside the canvas. */
export function PaletteDragLayer() {
  const drag = useHW((s) => s.paletteDrag);
  const overCanvas = useHW((s) => s.ghost !== null);
  if (!drag || overCanvas) return null;
  const def = findPartDef(drag.type);
  if (!def) return null;
  return (
    <div className="pal-drag" style={{ left: drag.clientX, top: drag.clientY }}>
      <PartThumbnail def={def} size={64} />
      <span>{def.name}</span>
    </div>
  );
}
