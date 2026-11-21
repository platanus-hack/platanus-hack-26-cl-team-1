/** Centre block: serial monitor with auto-scroll, timestamps and clear. */
import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Clock, SquareTerminal, Trash2 } from 'lucide-react';
import { projectBoard } from '@/catalog';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { formatStamp } from '@/sim/runtime';

const STAMPS_KEY = 'circuito-vivo:simpanel:timestamps';
const BOTTOM_SLACK_PX = 24;

function boardBaud(project: Parameters<typeof projectBoard>[0]): number | null {
  try {
    return projectBoard(project)?.profile.serial.baud ?? null;
  } catch {
    return null;
  }
}

function loadStamps(): boolean {
  try {
    return localStorage.getItem(STAMPS_KEY) === '1';
  } catch {
    return false;
  }
}

export function SerialMonitor() {
  const lines = useSim((s) => s.serial);
  const clearSerial = useSim((s) => s.clearSerial);
  const program = useSim((s) => s.program);
  const baud = useProject((s) => boardBaud(s.project));
  const [stamps, setStamps] = useState(loadStamps);
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const prevLines = useRef(lines);

  useLayoutEffect(() => {
    const el = scroller.current;
    const changed = prevLines.current !== lines;
    prevLines.current = lines;
    if (!el) return;
    if (follow) el.scrollTop = el.scrollHeight;
    else if (changed && lines.length > 0) setUnseen(true);
  }, [lines, follow, stamps]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX;
    if (atBottom !== follow) setFollow(atBottom);
    if (atBottom) setUnseen(false);
  };

  const jumpToEnd = () => {
    setFollow(true);
    setUnseen(false);
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const toggleStamps = () => {
    const next = !stamps;
    setStamps(next);
    try {
      localStorage.setItem(STAMPS_KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
  };

  return (
    <section className="simp-serial" aria-label="Monitor serie">
      <header className="simp-section-head">
        <SquareTerminal size={13} />
        <span className="simp-section-title">Monitor serie</span>
        {baud && <span className="simp-tag">{baud} baudios</span>}
        {lines.length > 0 && <span className="simp-tag is-dim">{lines.length} {lines.length === 1 ? 'línea' : 'líneas'}</span>}
        <span className="simp-spacer" />
        <button className={`simp-iconbtn is-sm ${stamps ? 'is-active' : ''}`} onClick={toggleStamps} aria-pressed={stamps} title={stamps ? 'Ocultar marcas de tiempo' : 'Mostrar marcas de tiempo'}>
          <Clock size={13} />
        </button>
        <button className="simp-iconbtn is-sm" onClick={clearSerial} disabled={lines.length === 0} title="Limpiar monitor" aria-label="Limpiar monitor">
          <Trash2 size={13} />
        </button>
      </header>
      <div className="simp-serial-body">
        <div className="simp-serial-scroll" ref={scroller} onScroll={onScroll} role="log" aria-live="off">
          {lines.length === 0 ? (
            <div className="simp-empty">
              <SquareTerminal size={20} strokeWidth={1.5} />
              <span>Usa el bloque «imprimir» para ver mensajes aquí</span>
              {program === 'stopped' && <span className="simp-empty-sub">Los mensajes aparecen cuando el programa se está ejecutando.</span>}
            </div>
          ) : (
            lines.map((l, i) => (
              <div className={`simp-line ${stamps ? 'has-stamp' : ''}`} key={i}>
                {stamps && <span className="simp-line-stamp">{formatStamp(l.t)}</span>}
                <span className="simp-line-text">{l.text === '' ? ' ' : l.text}</span>
              </div>
            ))
          )}
        </div>
        {!follow && unseen && (
          <button className="simp-jump" onClick={jumpToEnd}>
            <ArrowDown size={12} /> Nuevos mensajes
          </button>
        )}
        {!follow && !unseen && lines.length > 0 && (
          <button className="simp-jump is-quiet" onClick={jumpToEnd} title="Volver a seguir los mensajes nuevos">
            <ArrowDown size={12} /> Ir al final
          </button>
        )}
      </div>
    </section>
  );
}
