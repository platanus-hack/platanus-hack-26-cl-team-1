import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

interface Props {
  /** Current width of the panel to the RIGHT of the splitter (px). */
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  onChange: (width: number) => void;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Vertical splitter resizing the right column (drag, arrow keys, double-click resets). */
export function Splitter({ width, min, max, defaultWidth, onChange }: Props) {
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      drag.current = { startX: e.clientX, startW: width };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.classList.add('sw-resizing');
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      onChange(clamp(drag.current.startW + (drag.current.startX - e.clientX), min, max));
    },
    [min, max, onChange],
  );

  const end = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove('sw-resizing');
  }, []);

  return (
    <div
      className="sw-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Cambiar el ancho del panel de código"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Arrastra para cambiar el ancho · doble clic para restablecer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(defaultWidth)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onChange(clamp(width + 24, min, max));
        else if (e.key === 'ArrowRight') onChange(clamp(width - 24, min, max));
        else return;
        e.preventDefault();
      }}
    >
      <span className="sw-splitter-grip" />
    </div>
  );
}
