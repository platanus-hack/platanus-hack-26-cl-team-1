/**
 * ESP32-C6-DevKitC-1 — black PCB seen from above (board 22 × 10, PCB y 0.5..10.5).
 * J1 (y=1) and J3 (y=10) male headers come from the board profile (pin 1 = 3V3 on the right).
 */
import { memo, useMemo } from 'react';
import type { PartDef, PartSimState } from '@/contracts';
import type { PartRenderProps } from '../types';
import { boardPinViews } from './board-data';
import { headerRuns, ledColor, rectsPath, smdPaths, type Rect } from './layout';
import { EspModule, MODULE } from './esp-module';
import { GoldPins, PieceDefs, Qfn, Sot223, Tactile, UsbC } from './pieces';
import { IndicatorLed, SelectionHalo, SilkText, url, useSvgId } from './svg';
import { espTraces } from './traces';

const RGB = { x: 9.9, y: 5.55, size: 1.25 };
const PWR = { x: 6.2, y: 5.6 };
const USB_TOP = { x: -0.45, y: 1.85, w: 2.8, h: 2.9 };
const USB_BOT = { x: -0.45, y: 6.25, w: 2.8, h: 2.9 };

const PASSIVES = smdPaths([
  { x: 0.9, y: 5.5 },
  { x: 1.9, y: 5.5 },
  { x: 9.3, y: 2.75 },
  { x: 9.3, y: 6.5, v: true },
  { x: 6.0, y: 7.3, v: true },
  { x: 9.6, y: 7.95 },
  { x: 9.9, y: 7.0 },
  { x: 6.1, y: 2.95 },
]);

interface ArtProps {
  def: PartDef;
  uid: string;
  thumbnail: boolean;
}

const EspArt = memo(function EspArt({ def, uid, thumbnail }: ArtProps) {
  const { x, y, w, h } = def.bounds;
  const pins = useMemo(() => boardPinViews(def), [def]);
  const runs = useMemo(() => headerRuns(pins, (p) => p.header), [pins]);
  const dividers = useMemo(() => {
    const cells: Rect[] = [];
    for (const r of runs) for (let px = r.x0; px < r.x1; px++) cells.push({ x: px + 0.48, y: r.y - 0.44, w: 0.04, h: 0.88 });
    return rectsPath(cells);
  }, [runs]);
  const midY = y + h / 2;
  const pin1 = pins.find((p) => p.id === '3V3');
  const j1 = runs.find((r) => r.y < midY);
  const j3 = runs.find((r) => r.y >= midY);

  return (
    <g>
      <defs>
        <PieceDefs uid={uid} />
        <linearGradient id={`${uid}-pcb`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#23262c" />
          <stop offset="0.55" stopColor="#15171b" />
          <stop offset="1" stopColor="#0c0d10" />
        </linearGradient>
      </defs>

      {/* PCB */}
      <rect x={x} y={y} width={w} height={h} rx={0.45} fill={url(`${uid}-pcb`)} filter={url(`${uid}-shL`)} />
      <rect x={x + 0.04} y={y + 0.04} width={w - 0.08} height={h - 0.08} rx={0.42} fill="none" stroke="#ffffff" strokeOpacity={0.08} strokeWidth={0.06} />
      <rect x={x} y={y} width={w} height={h} rx={0.45} fill="none" stroke="#3a3f47" strokeWidth={0.07} />

      {!thumbnail && <path d={espTraces()} fill="none" stroke="#30353d" strokeWidth={0.12} strokeLinecap="round" strokeLinejoin="round" />}

      {/* USB side */}
      <UsbC uid={uid} {...USB_TOP} />
      <UsbC uid={uid} {...USB_BOT} />
      <Tactile uid={uid} cx={4.4} cy={3.65} size={1.6} />
      <Tactile uid={uid} cx={4.4} cy={7.35} size={1.6} />
      <Qfn uid={uid} cx={7.5} cy={3.9} size={1.8} label="CP2102N" thumbnail={thumbnail} />
      <Sot223 uid={uid} cx={7.5} cy={7.4} />
      {!thumbnail && (
        <g>
          <path d={PASSIVES.body} fill="#3b3226" />
          <path d={PASSIVES.caps} fill="#c9ced3" />
        </g>
      )}

      {/* RGB LED package (WS2812), lens drawn by the indicator layer */}
      <rect x={RGB.x - RGB.size / 2} y={RGB.y - RGB.size / 2} width={RGB.size} height={RGB.size} rx={0.1} fill="#eceee9" stroke="#9aa0a6" strokeWidth={0.04} filter={url(`${uid}-sh`)} />

      <EspModule uid={uid} thumbnail={thumbnail} />

      {/* headers (male): black plastic + gold pins */}
      {runs.map((r) => (
        <g key={`${r.y}-${r.x0}`}>
          <rect x={r.x0 - 0.5} y={r.y - 0.5} width={r.x1 - r.x0 + 1} height={1} rx={0.08} fill={url(`${uid}-plastic`)} stroke="#41454c" strokeWidth={0.04} filter={url(`${uid}-sh`)} />
          <path d={`M${r.x0 - 0.4} ${r.y - 0.44}H${r.x1 + 0.4}`} stroke="#ffffff" strokeOpacity={0.14} strokeWidth={0.05} />
        </g>
      ))}
      <path d={dividers} fill="#000" opacity={0.6} />
      <GoldPins points={pins} size={0.38} />

      {/* silkscreen */}
      {!thumbnail && (
        <g>
          {pins.map((p) => (
            <SilkText key={p.id} x={p.x} y={p.y < midY ? p.y + 0.98 : p.y - 0.98} size={0.4} center weight={700}>
              {p.label}
            </SilkText>
          ))}
          {j1 && (
            <SilkText x={j1.x0 - 1.15} y={j1.y} size={0.38} center weight={700} opacity={0.8}>
              J1
            </SilkText>
          )}
          {j3 && (
            <SilkText x={j3.x0 - 1.15} y={j3.y} size={0.38} center weight={700} opacity={0.8}>
              J3
            </SilkText>
          )}
          {pin1 && <circle cx={pin1.x + 0.72} cy={pin1.y + 0.95} r={0.11} fill="#f3f6f4" />}
          <SilkText x={2.78} y={USB_TOP.y + USB_TOP.h / 2} size={0.32} vertical center anchor="middle" weight={700}>
            UART
          </SilkText>
          <SilkText x={2.78} y={USB_BOT.y + USB_BOT.h / 2} size={0.32} vertical center anchor="middle" weight={700}>
            USB
          </SilkText>
          <SilkText x={4.4} y={4.98} size={0.34} weight={700}>
            BOOT
          </SilkText>
          <SilkText x={4.4} y={6.3} size={0.34} weight={700}>
            RST
          </SilkText>
          <SilkText x={PWR.x + 0.62} y={PWR.y} size={0.32} anchor="start" center weight={700}>
            PWR
          </SilkText>
          <SilkText x={RGB.x} y={RGB.y - 1.05} size={0.32} center weight={700}>
            RGB
          </SilkText>
          <SilkText x={MODULE.x - 0.55} y={5.5} size={0.36} vertical center anchor="middle" weight={600} opacity={0.75} spacing={0.04}>
            ESP32-C6-DevKitC-1
          </SilkText>
        </g>
      )}
    </g>
  );
});

function EspIndicators({ uid, onboard }: { uid: string; onboard: PartSimState['onboard'] }) {
  const c = ledColor(onboard?.rgb);
  const s = RGB.size;
  return (
    <g>
      <IndicatorLed id={`${uid}-pwr`} x={PWR.x} y={PWR.y} color="#ff4d4f" level={onboard?.power ? 1 : 0} halo={1.4} />
      {c && (
        <>
          <defs>
            <radialGradient id={`${uid}-rgbglow`}>
              <stop offset="0" stopColor={c.hex} stopOpacity={0.95 * c.level} />
              <stop offset="0.3" stopColor={c.hex} stopOpacity={0.5 * c.level} />
              <stop offset="1" stopColor={c.hex} stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={RGB.x} cy={RGB.y} r={2.2 + 1.4 * c.level} fill={url(`${uid}-rgbglow`)} />
        </>
      )}
      <circle cx={RGB.x} cy={RGB.y} r={s * 0.36} fill={c ? c.hex : '#f6f7f3'} stroke="#b9bdb6" strokeWidth={0.04} />
      {c ? (
        <circle cx={RGB.x} cy={RGB.y} r={s * 0.2} fill="#ffffff" opacity={0.55 + 0.4 * c.level} />
      ) : (
        <path d={`M${RGB.x - 0.16} ${RGB.y - 0.1}h0.12v0.12h-0.12zM${RGB.x + 0.04} ${RGB.y - 0.1}h0.12v0.12h-0.12zM${RGB.x - 0.06} ${RGB.y + 0.06}h0.12v0.12h-0.12z`} fill="#c4a35a" />
      )}
    </g>
  );
}

function Esp32C6DevKitImpl({ part, def, sim, selected, thumbnail }: PartRenderProps) {
  const uid = useSvgId(part.id);
  const b = def.bounds;
  return (
    <g>
      {selected && <SelectionHalo rect={{ ...b, r: 0.45 }} />}
      <EspArt def={def} uid={uid} thumbnail={!!thumbnail} />
      <EspIndicators uid={uid} onboard={sim?.onboard} />
    </g>
  );
}

export const Esp32C6DevKit = memo(Esp32C6DevKitImpl);
