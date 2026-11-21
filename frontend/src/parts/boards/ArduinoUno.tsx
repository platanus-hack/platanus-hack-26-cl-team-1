/**
 * Arduino Uno R3 — teal PCB seen from above. Header sockets, labels and the
 * PWM "~" marks are generated from the board profile (def.pins); everything
 * else is fixed art in grid units (board 28 × 21).
 */
import { memo, useMemo } from 'react';
import type { PartDef, PartSimState } from '@/contracts';
import type { PartRenderProps } from '../types';
import { boardPinViews, unoSilkLabel } from './board-data';
import { circlesPath, headerRuns, rectsPath, smdPaths, squaresPath, type Pt } from './layout';
import { BarrelJack, Crystal, Dip, ElectroCap, PieceDefs, PinBlock, Qfn, Soic8, Sot223, Tactile, UsbB } from './pieces';
import { IndicatorLed, SelectionHalo, SilkText, url, useSvgId } from './svg';
import { unoTraces } from './traces';

const OUTLINE = 'M0.5 0H26.4L27 0.6V5L28 6V19.5L27 20.5V21H0.5Q0 21 0 20.5V0.5Q0 0 0.5 0Z';
const HOLES: Pt[] = [
  { x: 6, y: 1 },
  { x: 5.6, y: 20 },
  { x: 27, y: 7.1 },
  { x: 27, y: 18 },
];
const HOLE_R = 0.6;
const PCB_D = OUTLINE + circlesPath(HOLES, HOLE_R);
const PADS_D = circlesPath(HOLES, 0.92) + circlesPath(HOLES, HOLE_R);

const LED_X = 11;
const LEDS = { L: { x: LED_X, y: 4.5 }, TX: { x: LED_X, y: 5.5 }, RX: { x: LED_X, y: 6.5 }, ON: { x: 18.9, y: 6.3 } };

const PASSIVES = smdPaths([
  { x: 12.5, y: 4.5 },
  { x: 12.5, y: 5.5 },
  { x: 12.5, y: 6.5 },
  { x: 9.1, y: 5.0, v: true },
  { x: 9.1, y: 6.4, v: true },
  { x: 5.4, y: 9.9 },
  { x: 8.3, y: 9.6 },
  { x: 10.4, y: 11.2, v: true },
  { x: 2.0, y: 13.6, big: true },
  { x: 3.6, y: 13.6 },
  { x: 9.9, y: 15.6, v: true },
  { x: 17.6, y: 6.3, v: true },
  { x: 24.6, y: 10.9 },
  { x: 24.6, y: 11.6 },
]);

interface ArtProps {
  def: PartDef;
  uid: string;
  thumbnail: boolean;
}

const UnoArt = memo(function UnoArt({ def, uid, thumbnail }: ArtProps) {
  const pins = useMemo(() => boardPinViews(def), [def]);
  const runs = useMemo(() => headerRuns(pins, (p) => p.header), [pins]);
  const sockets = useMemo(
    () => ({
      rim: squaresPath(pins, 0.62, 0.08),
      hole: squaresPath(pins, 0.42, 0.05),
      glint: rectsPath(pins.map((p) => ({ x: p.x - 0.13, y: p.y + 0.1, w: 0.26, h: 0.07 }))),
    }),
    [pins],
  );
  const midY = def.bounds.y + def.bounds.h / 2;
  const top = pins.filter((p) => p.y < midY);
  const bottom = pins.filter((p) => p.y >= midY);
  const digital = top.filter((p) => /^D\d+$/.test(p.id));
  const span = (list: typeof pins) => (list.length ? { a: Math.min(...list.map((p) => p.x)), b: Math.max(...list.map((p) => p.x)) } : null);
  const dig = span(digital);
  const pow = span(bottom.filter((p) => p.header === 'POWER'));
  const ana = span(bottom.filter((p) => p.header === 'ANALOG'));
  const topY = top[0]?.y ?? 1;
  const botY = bottom[0]?.y ?? 20;

  return (
    <g>
      <defs>
        <PieceDefs uid={uid} />
        <linearGradient id={`${uid}-pcb`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0aa0a8" />
          <stop offset="0.5" stopColor="#00878f" />
          <stop offset="1" stopColor="#006a71" />
        </linearGradient>
        <linearGradient id={`${uid}-hdr`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3c40" />
          <stop offset="0.18" stopColor="#202124" />
          <stop offset="1" stopColor="#0d0e10" />
        </linearGradient>
      </defs>

      {/* PCB */}
      <path d={PCB_D} fillRule="evenodd" fill={url(`${uid}-pcb`)} filter={url(`${uid}-shL`)} />
      <path d={OUTLINE} fill="none" stroke="#5fd0d5" strokeOpacity={0.35} strokeWidth={0.07} transform="translate(0.03 0.03)" />
      <path d={OUTLINE} fill="none" stroke="#004f55" strokeWidth={0.07} />
      {!thumbnail && <path d={unoTraces()} fill="none" stroke="#3cc4c9" strokeOpacity={0.42} strokeWidth={0.12} strokeLinecap="round" strokeLinejoin="round" />}
      <path d={PADS_D} fillRule="evenodd" fill="#d7dde2" stroke="#8d979f" strokeWidth={0.04} />

      {/* power & USB side */}
      <UsbB uid={uid} x={-1} y={3.5} w={5.7} h={4.8} />
      <BarrelJack uid={uid} x={-0.6} y={14.9} w={5.6} h={4.0} />
      <Tactile uid={uid} cx={2.6} cy={1.65} size={2.0} cap="#3a2f2a" />
      <ElectroCap uid={uid} cx={6.5} cy={12.9} r={0.95} />
      <ElectroCap uid={uid} cx={8.75} cy={12.9} r={0.95} />
      <Sot223 uid={uid} cx={7.6} cy={16.9} />
      <Qfn uid={uid} cx={7.1} cy={5.6} size={2} label="16U2" thumbnail={thumbnail} />
      <Crystal uid={uid} cx={7.0} cy={8.15} w={3.4} h={1.15} text="16.000" thumbnail={thumbnail} />
      <Soic8 uid={uid} cx={2.9} cy={11.3} />
      <rect x={1.0} y={9.1} width={1.6} height={0.85} rx={0.08} fill="#c8b04a" stroke="#7d6c22" strokeWidth={0.04} />

      {!thumbnail && (
        <g>
          <path d={PASSIVES.body} fill="#262729" />
          <path d={PASSIVES.caps} fill="#c9ced3" />
        </g>
      )}

      {/* MCU */}
      <Dip uid={uid} x0={12.5} perRow={14} rowTop={12.7} rowBottom={15.7} label="ATMEGA328P-PU" notchRight thumbnail={thumbnail} />
      <rect x={10.0} y={13.25} width={1.0} height={1.9} rx={0.1} fill="#d9c9a0" stroke="#8c7d54" strokeWidth={0.04} />
      <PinBlock uid={uid} x0={25.8} y0={8.4} cols={2} rows={3} />

      {/* headers (female) */}
      {runs.map((r) => (
        <g key={`${r.y}-${r.x0}`}>
          <rect x={r.x0 - 0.5} y={r.y - 0.5} width={r.x1 - r.x0 + 1} height={1} rx={0.1} fill={url(`${uid}-hdr`)} filter={url(`${uid}-sh`)} />
          <path d={`M${r.x0 - 0.38} ${r.y - 0.44}H${r.x1 + 0.38}`} stroke="#ffffff" strokeOpacity={0.16} strokeWidth={0.05} />
        </g>
      ))}
      <path d={sockets.rim} fill="#2a2b2e" />
      <path d={sockets.hole} fill="#030303" />
      {!thumbnail && <path d={sockets.glint} fill="#b9a46a" opacity={0.55} />}

      {/* silkscreen */}
      {!thumbnail && (
        <g>
          {top.map((p) => (
            <SilkText key={p.id} x={p.x} y={topY + 0.78} size={0.4} anchor="end" vertical center>
              {unoSilkLabel(p)}
            </SilkText>
          ))}
          {bottom.map((p) => (
            <SilkText key={p.id} x={p.x} y={botY - 0.78} size={0.4} anchor="start" vertical center>
              {unoSilkLabel(p)}
            </SilkText>
          ))}
          {dig && (
            <>
              <path d={`M${dig.a - 0.4} ${topY + 2.35}H${dig.b + 0.4}`} stroke="#f3f6f4" strokeWidth={0.06} />
              <SilkText x={(dig.a + dig.b) / 2} y={topY + 2.98} size={0.5} weight={700} spacing={0.06}>
                DIGITAL (PWM~)
              </SilkText>
            </>
          )}
          {pow && (
            <>
              <path d={`M${pow.a - 0.4} ${botY - 2.3}H${pow.b + 0.4}`} stroke="#f3f6f4" strokeWidth={0.06} />
              <SilkText x={(pow.a + pow.b) / 2} y={botY - 2.5} size={0.5} weight={700} spacing={0.06}>
                POWER
              </SilkText>
            </>
          )}
          {ana && (
            <>
              <path d={`M${ana.a - 0.4} ${botY - 2.3}H${ana.b + 0.4}`} stroke="#f3f6f4" strokeWidth={0.06} />
              <SilkText x={(ana.a + ana.b) / 2} y={botY - 2.5} size={0.5} weight={700} spacing={0.06}>
                ANALOG IN
              </SilkText>
            </>
          )}
          <SilkText x={2.6} y={3.12} size={0.36} weight={700}>
            RESET
          </SilkText>
          <SilkText x={25.45} y={9.9} size={0.36} weight={700} vertical center>
            ICSP
          </SilkText>
          <SilkText x={10.3} y={LEDS.L.y} size={0.36} anchor="end" center weight={700}>
            L
          </SilkText>
          <SilkText x={10.3} y={LEDS.TX.y} size={0.36} anchor="end" center weight={700}>
            TX
          </SilkText>
          <SilkText x={10.3} y={LEDS.RX.y} size={0.36} anchor="end" center weight={700}>
            RX
          </SilkText>
          <SilkText x={LEDS.ON.x} y={LEDS.ON.y - 0.75} size={0.36} weight={700}>
            ON
          </SilkText>
        </g>
      )}
      <SilkText x={16.4} y={10.55} size={2.4} weight={800} spacing={0.12} italic>
        UNO
      </SilkText>
      {!thumbnail && <rect x={14.1} y={10.95} width={4.7} height={0.09} fill="#f3f6f4" opacity={0.9} />}
      {/* TX / RX are always idle in the simulation */}
      <IndicatorLed id={`${uid}-tx`} x={LEDS.TX.x} y={LEDS.TX.y} color="#ffb547" level={0} />
      <IndicatorLed id={`${uid}-rx`} x={LEDS.RX.x} y={LEDS.RX.y} color="#ffb547" level={0} />
    </g>
  );
});

function UnoIndicators({ uid, onboard }: { uid: string; onboard: PartSimState['onboard'] }) {
  return (
    <g>
      <IndicatorLed id={`${uid}-on`} x={LEDS.ON.x} y={LEDS.ON.y} color="#3ddc97" level={onboard?.power ? 1 : 0} />
      <IndicatorLed id={`${uid}-l`} x={LEDS.L.x} y={LEDS.L.y} color="#ffa62b" level={onboard?.led ?? 0} />
    </g>
  );
}

function ArduinoUnoImpl({ part, def, sim, selected, thumbnail }: PartRenderProps) {
  const uid = useSvgId(part.id);
  return (
    <g>
      {selected && <SelectionHalo d={OUTLINE} />}
      <UnoArt def={def} uid={uid} thumbnail={!!thumbnail} />
      <UnoIndicators uid={uid} onboard={sim?.onboard} />
    </g>
  );
}

export const ArduinoUno = memo(ArduinoUnoImpl);
