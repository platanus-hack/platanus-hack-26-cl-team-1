import type { PartRenderProps } from './types';

/** Used when no renderer is registered for a type (should not happen in production). */
export function FallbackRenderer({ def }: PartRenderProps) {
  const b = def.bounds;
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={0.4} fill="#1B222B" stroke="#4CC2FF" strokeWidth={0.08} />
      <text x={b.x + b.w / 2} y={b.y + b.h / 2} fontSize={0.8} fill="#E6EDF3" textAnchor="middle" dominantBaseline="middle" fontFamily="Inter">
        {def.name}
      </text>
      {def.pins.slice(0, 60).map((p) => (
        <circle key={p.id} cx={p.x} cy={p.y} r={0.18} fill="#c9a227" />
      ))}
    </g>
  );
}
