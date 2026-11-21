/**
 * Rows of the "Pines" measurement table (pure): every board pin that is
 * driven as OUTPUT by the program or bound to a part.
 */
import type { Binding, BoardProfile, CircuitResult, Id, PartDef, PinDrive, PropValue } from '@/contracts';

export type PinRowMode = 'output' | 'pwm' | 'tone' | 'input' | 'input_pullup' | 'analog';

export interface PinRow {
  pin: string; // canonical board pin id
  label: string; // silkscreen label shown to the user
  parts: string[]; // labels of the bound parts
  mode: PinRowMode;
  modeLabel: string;
  /** Logic level (null when unknown, e.g. analog). */
  level: 0 | 1 | null;
  valueText: string;
  volts: number | null;
  currentA: number | null;
}

export const MODE_LABEL: Record<PinRowMode, string> = {
  output: 'SALIDA',
  pwm: 'PWM',
  tone: 'TONO',
  input: 'ENTRADA',
  input_pullup: 'PULL-UP',
  analog: 'ANALÓGICA',
};

const levelText = (l: 0 | 1 | null) => (l === null ? '—' : l ? 'ALTO' : 'BAJO');

export function buildPinRows(
  board: BoardProfile | null,
  bindings: Binding[],
  drives: Record<string, PinDrive>,
  result: CircuitResult | null,
  partLabels: ReadonlyMap<Id, string>,
): PinRow[] {
  const bound = new Map<string, Binding[]>();
  for (const b of bindings) {
    if (!b.boardPin) continue;
    const list = bound.get(b.boardPin) ?? [];
    list.push(b);
    bound.set(b.boardPin, list);
  }
  const pins = new Set<string>([...bound.keys()]);
  for (const [pin, d] of Object.entries(drives)) if (d.mode === 'output') pins.add(pin);

  const order = new Map((board?.pins ?? []).map((p, i) => [p.id, i]));
  const sorted = [...pins].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));

  return sorted.map((pin) => {
    const drive = drives[pin];
    const st = result?.boardPins[pin];
    const binds = bound.get(pin) ?? [];
    const analog = binds.some((b) => b.mode === 'ANALOG');
    const labels = [...new Set(binds.map((b) => partLabels.get(b.part) ?? b.part))];
    const boardPin = board?.pins.find((p) => p.id === pin);
    const label = boardPin ? (boardPin.label && boardPin.label !== pin ? boardPin.label : pin) : pin;
    const digital: 0 | 1 | null = st ? (st.digital ? 1 : 0) : null;

    let mode: PinRowMode;
    let level: 0 | 1 | null;
    let valueText: string;
    if (drive?.mode === 'output') {
      level = drive.level;
      if (drive.toneHz && drive.toneHz > 0) {
        mode = 'tone';
        valueText = `${Math.round(drive.toneHz)} Hz`;
      } else if (drive.duty !== undefined) {
        mode = 'pwm';
        valueText = `${Math.round(drive.duty * 100)} %`;
      } else {
        mode = 'output';
        valueText = levelText(level);
      }
    } else if (analog && drive?.mode !== 'input_pullup') {
      mode = 'analog';
      level = null;
      valueText = st?.adc !== undefined ? String(Math.round(st.adc)) : '—';
    } else {
      mode = drive?.mode === 'input_pullup' ? 'input_pullup' : 'input';
      level = digital;
      valueText = levelText(level);
    }
    return {
      pin,
      label,
      parts: labels,
      mode,
      modeLabel: MODE_LABEL[mode],
      level,
      valueText,
      volts: st ? st.volts : null,
      currentA: st ? st.currentA : null,
    };
  });
}

/** Runtime prop driven by the live control of an interactive part. */
export function actuatorKey(def: PartDef): string | null {
  const e = def.electrical;
  if (e.model === 'switch') return e.stateProp;
  if (e.model === 'potentiometer') return e.positionProp;
  if (e.model === 'ldr') return e.lightProp;
  return def.props.find((p) => p.runtime)?.key ?? null;
}

/** Effective runtime value: live override, else instance prop, else default. */
export function runtimeValue(
  overrides: Record<string, PropValue> | undefined,
  props: Record<string, PropValue>,
  def: PartDef,
  key: string,
): PropValue | undefined {
  if (overrides && key in overrides) return overrides[key];
  if (key in props) return props[key];
  return def.props.find((p) => p.key === key)?.default;
}
