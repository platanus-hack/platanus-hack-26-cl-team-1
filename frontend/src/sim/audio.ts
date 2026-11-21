/**
 * Buzzer audio: one WebAudio square oscillator per sounding buzzer.
 * The AudioContext is created lazily after a user gesture (browser policy).
 * Global mute flag persisted in localStorage.
 */
import { create } from 'zustand';
import type { CircuitResult, Id } from '@/contracts';

const MUTE_KEY = 'circuito-vivo:sim:muted';
const GAIN = 0.04;
const ATTACK_S = 0.015;
const RELEASE_S = 0.05;
const MAX_VOICES = 4;

function loadMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Tiny store so the UI re-renders when the mute flag changes. */
export const useAudioPrefs = create<{ muted: boolean }>(() => ({ muted: loadMuted() }));
export const useMuted = (): boolean => useAudioPrefs((s) => s.muted);
export const isMuted = (): boolean => useAudioPrefs.getState().muted;

export function setMuted(muted: boolean): void {
  useAudioPrefs.setState({ muted });
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode */
  }
  syncAudio(lastWanted);
}

/** Buzzers that should sound right now: part id → Hz (pure). */
export function wantedTones(result: CircuitResult | null): Map<Id, number> {
  const out = new Map<Id, number>();
  if (!result) return out;
  for (const [id, st] of Object.entries(result.parts)) {
    if (out.size >= MAX_VOICES) break;
    const hz = st.toneHz ?? 0;
    if (st.sounding && !st.burned && Number.isFinite(hz) && hz > 0) out.set(id, Math.min(20000, Math.max(20, hz)));
  }
  return out;
}

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  hz: number;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const voices = new Map<Id, Voice>();
let lastWanted = new Map<Id, number>();

type AudioCtor = typeof AudioContext;

/** Create/resume the AudioContext. Call from a user gesture (click, key). */
export function unlockAudio(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!ctx) {
      const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume().then(() => syncAudio(lastWanted)).catch(() => undefined);
    else syncAudio(lastWanted);
  } catch {
    ctx = null;
    master = null;
  }
}

export const audioUnlocked = (): boolean => !!ctx && ctx.state === 'running';

function startVoice(id: Id, hz: number): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(hz, t);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(GAIN, t + ATTACK_S);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  voices.set(id, { osc, gain, hz });
}

function releaseVoice(id: Id): void {
  const v = voices.get(id);
  voices.delete(id);
  if (!v || !ctx) return;
  try {
    const t = ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + RELEASE_S);
    v.osc.stop(t + RELEASE_S + 0.02);
    v.osc.onended = () => {
      v.osc.disconnect();
      v.gain.disconnect();
    };
  } catch {
    /* already stopped */
  }
}

/** True while the page is in a background tab (requestAnimationFrame is paused there). */
const pageHidden = (): boolean => typeof document !== 'undefined' && document.hidden === true;

/** Make the playing voices match `wanted` (cheap when nothing changed). */
export function syncAudio(wanted: Map<Id, number>): void {
  lastWanted = wanted;
  if (!ctx || isMuted() || ctx.state !== 'running' || pageHidden()) {
    for (const id of [...voices.keys()]) releaseVoice(id);
    return;
  }
  for (const id of [...voices.keys()]) if (!wanted.has(id)) releaseVoice(id);
  for (const [id, hz] of wanted) {
    const v = voices.get(id);
    if (!v) startVoice(id, hz);
    else if (v.hz !== hz) {
      v.osc.frequency.setTargetAtTime(hz, ctx.currentTime, 0.004);
      v.hz = hz;
    }
  }
}

export const silenceAudio = (): void => syncAudio(new Map());

/*
 * Background tab: the sim frame loop (requestAnimationFrame) stops, so nobody
 * would ever release a tone that was sounding — a buzzer pattern would turn
 * into a continuous beep while the teacher shows another tab. Silence on hide;
 * on return the runtime's next frame decides what should sound.
 */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => syncAudio(lastWanted));
}
