/**
 * SimTimeline → AgentSimSummary (token budget!): only the states a student
 * would notice (brightness, colour, speed, angle, sound, damage), quantized
 * (0.05 / 1°), ≥ 50 ms between samples of the same part, ≤ 200 changes,
 * ≤ 100 serial lines, per-part min/max/last of the main value.
 */
import type { AgentSimSummary, CheckIssue, PartSimState, SimTimeline } from '@/contracts';
import { compactIssue } from './summary';

export const MIN_SPACING_MS = 50;
export const MAX_CHANGES = 200;
export const MAX_SERIAL_LINES = 100;
const MAX_LINE_CHARS = 200;

type State = Partial<PartSimState>;

const q05 = (v: number) => Math.round(v * 20) / 20;

/** Keep only student-visible fields, quantized. */
export function quantizeState(s: State): State {
  const out: State = {};
  if (typeof s.brightness === 'number') out.brightness = q05(s.brightness);
  if (Array.isArray(s.rgb)) out.rgb = [q05(s.rgb[0]), q05(s.rgb[1]), q05(s.rgb[2])];
  if (typeof s.speed === 'number') out.speed = q05(s.speed);
  if (typeof s.angle === 'number') out.angle = Math.round(s.angle);
  if (typeof s.sounding === 'boolean') out.sounding = s.sounding;
  if (typeof s.toneHz === 'number') out.toneHz = Math.round(s.toneHz);
  if (typeof s.burned === 'boolean') out.burned = s.burned;
  if (typeof s.overloaded === 'boolean') out.overloaded = s.overloaded;
  if (typeof s.reversed === 'boolean') out.reversed = s.reversed;
  return out;
}

/** The value min/max are computed on: brightness, motor speed, servo angle or strongest RGB channel. */
export function primaryValue(s: State): number | undefined {
  if (typeof s.brightness === 'number') return s.brightness;
  if (typeof s.speed === 'number') return s.speed;
  if (typeof s.angle === 'number') return s.angle;
  if (Array.isArray(s.rgb)) return Math.max(...s.rgb);
  return undefined;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function diff(cur: State, prev: State | undefined): State {
  if (!prev) return cur;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cur)) {
    if (!same(v, (prev as Record<string, unknown>)[k])) out[k] = v;
  }
  return out as State;
}

export function summarizeTimeline(tl: SimTimeline): AgentSimSummary {
  const changes: AgentSimSummary['changes'] = [];
  const per: AgentSimSummary['per_part'] = {};
  const cur = new Map<string, State>(); // latest quantized state per part
  const emitted = new Map<string, State>(); // last emitted state per part
  const lastT = new Map<string, number>();
  const pending = new Set<string>();
  let truncated = false;

  const emit = (t: number, part: string) => {
    const state = cur.get(part)!;
    const d = diff(state, emitted.get(part));
    pending.delete(part);
    if (Object.keys(d).length === 0) return;
    lastT.set(part, t);
    emitted.set(part, state);
    if (changes.length >= MAX_CHANGES) {
      truncated = true;
      return;
    }
    changes.push({ t: Math.round(t), part, state: d });
  };

  const flushDue = (t: number) => {
    for (const part of [...pending]) {
      const due = (lastT.get(part) ?? 0) + MIN_SPACING_MS;
      if (due <= t) emit(due, part);
    }
  };

  const sorted = [...(tl.changes ?? [])].sort((a, b) => a.t - b.t);
  for (const ch of sorted) {
    flushDue(ch.t);
    const qs = quantizeState(ch.state ?? {});
    if (Object.keys(qs).length === 0 && cur.has(ch.part)) continue;
    const merged = { ...(cur.get(ch.part) ?? {}), ...qs };
    cur.set(ch.part, merged);
    if (Object.keys(merged).length > 0) {
      const pv = primaryValue(merged);
      const entry = per[ch.part] ?? (per[ch.part] = { last: merged });
      entry.last = merged;
      if (pv !== undefined) {
        entry.min = entry.min === undefined ? pv : Math.min(entry.min, pv);
        entry.max = entry.max === undefined ? pv : Math.max(entry.max, pv);
      }
    }
    if (same(merged, emitted.get(ch.part))) {
      pending.delete(ch.part);
      continue;
    }
    const prevT = lastT.get(ch.part);
    if (prevT === undefined || ch.t - prevT >= MIN_SPACING_MS) emit(ch.t, ch.part);
    else pending.add(ch.part);
  }
  const duration = tl.durationMs ?? 0;
  for (const part of [...pending]) emit(Math.min((lastT.get(part) ?? 0) + MIN_SPACING_MS, Math.max(duration, 0)), part);
  changes.sort((a, b) => a.t - b.t);

  const serialAll = tl.serial ?? [];
  if (serialAll.length > MAX_SERIAL_LINES) truncated = true;
  const serial = serialAll.slice(0, MAX_SERIAL_LINES).map((l) => ({
    t: Math.round(l.t),
    text: l.text.length > MAX_LINE_CHARS ? `${l.text.slice(0, MAX_LINE_CHARS)}…` : l.text,
  }));

  const issues: CheckIssue[] = (tl.issues ?? []).map(compactIssue);
  return {
    duration_ms: Math.round(duration),
    changes,
    serial,
    per_part: per,
    issues,
    truncated,
    ...(tl.error ? { error: tl.error } : {}),
  };
}
