import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Cpu } from 'lucide-react';
import { projectBoard } from '@/catalog';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { BlocklyEditor } from './BlocklyEditor';
import { CodePanel } from './CodePanel';
import { Splitter } from './Splitter';
import './SoftwareView.css';

const WIDTH_KEY = 'circuito-vivo:software:code-width';
const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 320;
const MAX_WIDTH = 780;
/** Room the block editor keeps: toolbox (~132px) + an open flyout (~320px). */
const EDITOR_MIN = 460;

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH ? v : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function NoBoard() {
  const showView = useUI((s) => s.showView);
  return (
    <div className="sw-empty">
      <div className="sw-empty-art" aria-hidden>
        <span className="sw-empty-ring" />
        <Cpu size={30} />
      </div>
      <h3>Todavía no hay una placa</h3>
      <p>
        Los bloques se convierten en código para una placa. Agrega un <b>Arduino Uno</b> o una <b>ESP32-C6</b> en la vista Hardware y aquí verás el código
        generado, listo para compilar y cargar.
      </p>
      <button type="button" className="btn primary" onClick={() => showView('hardware')}>
        <ArrowLeft size={15} />
        Ir a Hardware
      </button>
    </div>
  );
}

/** Software view: Blockly editor (left) + generated C++ and compile panel (right). */
export function SoftwareView() {
  const hasBoard = useProject((s) => projectBoard(s.project) !== null);
  /** The width the user chose (persisted). What is shown is capped by the space available. */
  const [width, setWidth] = useState(readWidth);
  const rootRef = useRef<HTMLDivElement>(null);
  const [rootWidth, setRootWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setRootWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setRootWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxWidth = rootWidth === null ? MAX_WIDTH : Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rootWidth - EDITOR_MIN));
  const shownWidth = Math.min(width, maxWidth);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
      } catch {
        /* private mode */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [width]);

  const onWidth = useCallback((w: number) => setWidth(w), []);

  return (
    <div className="sw-root" ref={rootRef}>
      <BlocklyEditor />
      <Splitter width={shownWidth} min={MIN_WIDTH} max={maxWidth} defaultWidth={DEFAULT_WIDTH} onChange={onWidth} />
      <aside className="sw-side" style={{ width: shownWidth }}>
        {hasBoard ? <CodePanel /> : <NoBoard />}
      </aside>
    </div>
  );
}
