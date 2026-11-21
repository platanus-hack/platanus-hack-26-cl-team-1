/**
 * 1/4 W carbon-film resistor: beige dog-bone body with the 4 colour bands of
 * its resistance (see resistorBands), cylindrical shading, tinned leads.
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';
import { BAND_HEX, resistorBands } from './resistorBands';
import { num } from './util';

/** Dog-bone body: wider end caps, slimmer neck (centre x = 2). */
export const RESISTOR_BODY =
  'M 0.72 0 C 0.72 -0.32 0.8 -0.47 1.0 -0.47 L 1.16 -0.47 C 1.31 -0.47 1.35 -0.38 1.5 -0.38 L 2.5 -0.38 ' +
  'C 2.65 -0.38 2.69 -0.47 2.84 -0.47 L 3.0 -0.47 C 3.2 -0.47 3.28 -0.32 3.28 0 C 3.28 0.32 3.2 0.47 3.0 0.47 ' +
  'L 2.84 0.47 C 2.69 0.47 2.65 0.38 2.5 0.38 L 1.5 0.38 C 1.35 0.38 1.31 0.47 1.16 0.47 L 1.0 0.47 ' +
  'C 0.8 0.47 0.72 0.32 0.72 0 Z';

/** Band x positions (left edge) and width: digit, digit, multiplier, (gap), tolerance. */
const BAND_X = [0.96, 1.5, 1.86, 2.8];
const BAND_W = 0.2;

function ResistorImpl({ part, runtime, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const ohms = num(runtime.resistance, 220);
  const bands = resistorBands(ohms);
  const metallic = (c: string) => c === 'gold' || c === 'silver';

  return (
    <g className="cv-part cv-part-resistor">
      <defs>
        <ShadowFilter id={id('shadow')} dy={0.16} blur={0.14} />
        <clipPath id={id('clip')}>
          <path d={RESISTOR_BODY} />
        </clipPath>
        <linearGradient id={id('body')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f1dcb6" />
          <stop offset="0.45" stopColor="#dcbf8f" />
          <stop offset="1" stopColor="#a98a5c" />
        </linearGradient>
        <linearGradient id={id('shade')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.05} />
          <stop offset="0.18" stopColor="#ffffff" stopOpacity={0.55} />
          <stop offset="0.32" stopColor="#ffffff" stopOpacity={0.08} />
          <stop offset="0.65" stopColor="#000000" stopOpacity={0.0} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.42} />
        </linearGradient>
        <linearGradient id={id('gold')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset="0.35" stopColor="#d9b048" />
          <stop offset="0.7" stopColor="#a47a1c" />
          <stop offset="1" stopColor="#6e4f0c" />
        </linearGradient>
        <linearGradient id={id('silver')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor="#c8ced4" />
          <stop offset="1" stopColor="#7c858e" />
        </linearGradient>
      </defs>

      <Lead points={[[0.85, 0], [0, 0]]} pin="a" />
      <Lead points={[[3.15, 0], [4, 0]]} pin="b" />

      <path d={RESISTOR_BODY} fill={`url(#${id('body')})`} filter={`url(#${id('shadow')})`} />
      <g clipPath={`url(#${id('clip')})`}>
        {bands.length === 1 ? (
          <rect x={1.9} y={-0.6} width={BAND_W} height={1.2} fill={BAND_HEX.black} />
        ) : (
          bands.map((c, i) => (
            <rect
              key={i}
              x={BAND_X[i]}
              y={-0.6}
              width={BAND_W}
              height={1.2}
              fill={metallic(c) ? `url(#${id(c)})` : BAND_HEX[c]}
            />
          ))
        )}
        {!thumbnail && (
          <path d="M 1.5 -0.3 C 1.9 -0.27 2.2 -0.33 2.5 -0.3" fill="none" stroke="#000" strokeWidth={0.015} opacity={0.08} />
        )}
        <rect x={0.6} y={-0.6} width={2.8} height={1.2} fill={`url(#${id('shade')})`} />
      </g>
      <path d={RESISTOR_BODY} fill="none" stroke="#6d5534" strokeWidth={0.02} opacity={0.45} />
    </g>
  );
}

export const ResistorRenderer = memo(ResistorImpl);
