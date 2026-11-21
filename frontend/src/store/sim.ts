/**
 * Simulation state (written by sim/runtime.ts, read by views).
 * The electrical solve is ALWAYS live; `program` tracks the block program.
 */
import { create } from 'zustand';
import type { CircuitResult, Id, PinDrive, PropValue } from '@/contracts';

export interface SerialLine {
  t: number; // sim ms
  text: string;
}

export interface SimState {
  live: boolean; // electrical simulation enabled
  program: 'stopped' | 'running' | 'paused';
  speed: number; // 1 = real time
  timeMs: number; // program sim time
  result: CircuitResult | null;
  drives: Record<string, PinDrive>;
  /** Runtime prop overrides: button pressed, knob position, light, switch position. */
  runtime: Record<Id, Record<string, PropValue>>;
  burned: Id[];
  serial: SerialLine[];
  activeBlockId: string | null;
  /** Servo angles commanded by the running program (degrees), by part id. */
  servoAngles: Record<Id, number>;
  /** ESP32-C6 onboard WS2812 colour (0..255 each) set by the program, null = off. */
  onboardRgb: [number, number, number] | null;
  error: string | null;

  setRuntime: (part: Id, key: string, value: PropValue) => void;
  clearRuntime: () => void;
  repair: (part?: Id) => void; // un-burn one / all parts
  clearSerial: () => void;
  setLive: (live: boolean) => void;
  setSpeed: (speed: number) => void;
  /** Bulk update used by the runtime. */
  patch: (p: Partial<Omit<SimState, 'patch'>>) => void;
}

export const useSim = create<SimState>((set, get) => ({
  live: true,
  program: 'stopped',
  speed: 1,
  timeMs: 0,
  result: null,
  drives: {},
  runtime: {},
  burned: [],
  serial: [],
  activeBlockId: null,
  onboardRgb: null,
  servoAngles: {},
  error: null,
  setRuntime: (part, key, value) => {
    const runtime = get().runtime;
    set({ runtime: { ...runtime, [part]: { ...(runtime[part] ?? {}), [key]: value } } });
  },
  clearRuntime: () => set({ runtime: {} }),
  repair: (part) => set({ burned: part ? get().burned.filter((b) => b !== part) : [] }),
  clearSerial: () => set({ serial: [] }),
  setLive: (live) => set({ live }),
  setSpeed: (speed) => set({ speed }),
  patch: (p) => set(p),
}));
