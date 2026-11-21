/**
 * Half-size breadboard (400 tie points), off-white moulded body seen from above.
 * Holes are drawn from def.pins (exact catalog coordinates) as three cached paths.
 */
import { memo, useMemo } from 'react';
import type { PartDef } from '@/contracts';
import { BB_CHANNEL_Y, BB_COLS, bbColX } from '@/catalog';
import type { PartRenderProps } from '../types';
import { breadboardPaths, columnLabels, railMarks, rowLabels } from './breadboard-geo';
import { SelectionHalo, SilkText, SoftShadow, url, useSvgId } from './svg';

const RED = '#e5484d';
const BLUE = '#3b82f6';
const INK = '#8d897e';

const COLS = columnLabels();
const ROWS = rowLabels();
const RAILS = railMarks();

interface ArtProps {
  def: PartDef;
  uid: string;
  thumbnail: boolean;
}

const BreadboardArt = memo(function BreadboardArt({ def, uid, thumbnail }: ArtProps) {
  const { x, y, w, h } = def.bounds;
  const paths = useMemo(() => breadboardPaths(def.pins), [def.pins]);
  const lineX0 = bbColX(1) - 0.55;
  const lineX1 = bbColX(BB_COLS) + 0.55;
  const ch = BB_CHANNEL_Y;
  const grooveTop = (RAILS[1]?.lineY ?? 2.6) + 0.55;
  const grooveBottom = (RAILS[2]?.lineY ?? 18.4) - 0.55;
  return (
    <g>
      <defs>
        <SoftShadow uid={uid} />
        <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8f7f2" />
          <stop offset="0.5" stopColor="#f1efe8" />
          <stop offset="1" stopColor="#e4e1d7" />
        </linearGradient>
        <linearGradient id={`${uid}-edge`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.07" />
          <stop offset="0.025" stopColor="#000" stopOpacity="0" />
          <stop offset="0.975" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.09" />
        </linearGradient>
        <linearGradient id={`${uid}-channel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9b4a7" />
          <stop offset="0.45" stopColor="#d3cfc4" />
          <stop offset="1" stopColor="#ebe8e0" />
        </linearGradient>
      </defs>

      {/* body + edge shading */}
      <rect x={x} y={y} width={w} height={h} rx={0.45} fill={url(`${uid}-body`)} filter={url(`${uid}-shL`)} />
      <rect x={x} y={y} width={w} height={h} rx={0.45} fill={url(`${uid}-edge`)} />
      <rect x={x + 0.06} y={y + 0.06} width={w - 0.12} height={h - 0.12} rx={0.4} fill="none" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={0.06} />
      <rect x={x} y={y} width={w} height={h} rx={0.45} fill="none" stroke="#bfbab0" strokeWidth={0.06} />

      {/* rail strips grooves */}
      <path d={`M${x + 0.3} ${grooveTop}H${x + w - 0.3}M${x + 0.3} ${grooveBottom}H${x + w - 0.3}`} stroke="#cfcabf" strokeWidth={0.07} />
      <path d={`M${x + 0.3} ${grooveTop + 0.07}H${x + w - 0.3}M${x + 0.3} ${grooveBottom + 0.07}H${x + w - 0.3}`} stroke="#ffffff" strokeOpacity={0.8} strokeWidth={0.05} />

      {/* centre channel */}
      <rect x={x + 0.2} y={ch - 0.42} width={w - 0.4} height={0.84} rx={0.12} fill={url(`${uid}-channel`)} />
      <path d={`M${x + 0.35} ${ch + 0.02}H${x + w - 0.35}`} stroke="#a9a496" strokeWidth={0.05} opacity={0.7} />

      {/* rail guide lines */}
      {RAILS.map((r) => (
        <path key={`l${r.y}`} d={`M${lineX0} ${r.lineY}H${lineX1}`} stroke={r.polarity === '+' ? RED : BLUE} strokeWidth={0.11} strokeLinecap="round" />
      ))}

      {/* holes */}
      <path d={paths.funnels} fill="#d9d5cb" />
      {!thumbnail && <path d={paths.lips} fill="#ffffff" opacity={0.75} />}
      <path d={paths.holes} fill="#2b2925" />

      {!thumbnail && (
        <g>
          {RAILS.map((r) =>
            [x + 0.85, x + w - 0.85].map((lx) => (
              <SilkText key={`${r.y}-${lx}`} x={lx} y={r.y} size={0.78} weight={700} center fill={r.polarity === '+' ? RED : BLUE}>
                {r.polarity === '+' ? '+' : '−'}
              </SilkText>
            )),
          )}
          {COLS.map((c) => (
            <SilkText key={`c${c.x}-${c.y}`} x={c.x} y={c.y} size={0.46} weight={600} center fill={INK} mono>
              {c.text}
            </SilkText>
          ))}
          {ROWS.map((r) => (
            <SilkText key={`r${r.x}-${r.y}`} x={r.x} y={r.y} size={0.5} weight={600} center fill={INK} mono>
              {r.text}
            </SilkText>
          ))}
        </g>
      )}
    </g>
  );
});

function BreadboardHalfImpl({ part, def, selected, thumbnail }: PartRenderProps) {
  const uid = useSvgId(part.id);
  const b = def.bounds;
  return (
    <g>
      {selected && <SelectionHalo rect={{ ...b, r: 0.45 }} />}
      <BreadboardArt def={def} uid={uid} thumbnail={!!thumbnail} />
    </g>
  );
}

export const BreadboardHalf = memo(BreadboardHalfImpl);
