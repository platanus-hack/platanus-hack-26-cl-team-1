/**
 * Records part state CHANGES for runHeadless (agent `simulate` tool).
 * Only the observable outputs are kept, rounded so tiny solver noise does not
 * show up as a change. Same-time flicker is collapsed; the list is capped and
 * the final state of every part is appended when the cap was hit.
 */
import type { ElectricalModelName, Id, PartSimState } from '@/contracts';

export type TimelineChange = { t: number; part: Id; state: Partial<PartSimState> };

const r1 = (v: number | undefined) => {
  const x = Math.round((v ?? 0) * 10) / 10;
  return x === 0 ? 0 : x; // no -0
};

/** Observable snapshot of one part, or null when the part has nothing worth recording. */
export function partSnapshot(model: ElectricalModelName | undefined, st: PartSimState | undefined): Partial<PartSimState> | null {
  if (!st || !model) return null;
  let out: Partial<PartSimState> | null = null;
  switch (model) {
    case 'led':
      out = { brightness: r1(st.brightness) };
      break;
    case 'rgb-led':
      out = { rgb: (st.rgb ?? [0, 0, 0]).map((c) => r1(c)) as [number, number, number] };
      break;
    case 'motor':
      out = { speed: r1(st.speed) };
      break;
    case 'servo':
      out = { angle: Math.round(st.angle ?? 0), powered: !!st.powered };
      break;
    case 'buzzer':
      out = st.sounding ? { sounding: true, toneHz: Math.round(st.toneHz ?? 0) } : { sounding: false };
      break;
    case 'mcu':
      if (st.onboard) {
        const ob: NonNullable<PartSimState['onboard']> = { power: !!st.onboard.power };
        if (st.onboard.led !== undefined) ob.led = r1(st.onboard.led);
        if (st.onboard.rgb) ob.rgb = st.onboard.rgb.map((c) => r1(c)) as [number, number, number];
        out = { onboard: ob };
      }
      break;
    default:
      break;
  }
  if (st.burned) out = { ...(out ?? {}), burned: true };
  return out;
}

interface PartTrack {
  /** Key of the latest observed snapshot. */
  latestKey: string;
  latestState: Partial<PartSimState>;
  latestT: number;
  /** Key of the last RECORDED snapshot. */
  recordedKey: string;
  /** Index (in entries) of the last recorded change and the key recorded before it. */
  lastIndex: number;
  keyBefore: string;
  /** A change of this part was dropped because of the cap. */
  missed: boolean;
}

export class TimelineRecorder {
  private entries: Array<TimelineChange | null> = [];
  private count = 0;
  private tracks = new Map<Id, PartTrack>();
  truncated = false;

  constructor(private readonly maxChanges = 300) {}

  /** Observe a part snapshot at time t (ms). */
  observe(t: number, part: Id, state: Partial<PartSimState> | null): void {
    if (!state) return;
    const time = Math.max(0, Math.round(t));
    const key = JSON.stringify(state);
    const tr = this.tracks.get(part);
    if (!tr) {
      this.tracks.set(part, { latestKey: key, latestState: state, latestT: time, recordedKey: '', lastIndex: -1, keyBefore: '', missed: false });
      this.push(part, time, state, key);
      return;
    }
    if (tr.latestKey === key) return;
    tr.latestKey = key;
    tr.latestState = state;
    tr.latestT = time;
    const prevEntry = tr.lastIndex >= 0 ? this.entries[tr.lastIndex] : null;
    if (prevEntry && prevEntry.t === time) {
      // Same-time flicker: replace the entry, or drop it when we are back to the earlier state.
      if (key === tr.keyBefore) {
        this.entries[tr.lastIndex] = null;
        this.count--;
        tr.recordedKey = tr.keyBefore;
        tr.lastIndex = -1;
      } else {
        this.entries[tr.lastIndex] = { t: time, part, state };
        tr.recordedKey = key;
      }
      return;
    }
    this.push(part, time, state, key);
  }

  private push(part: Id, t: number, state: Partial<PartSimState>, key: string): void {
    const tr = this.tracks.get(part)!;
    if (this.count >= this.maxChanges) {
      this.truncated = true;
      tr.missed = true;
      return;
    }
    tr.keyBefore = tr.recordedKey;
    tr.recordedKey = key;
    tr.lastIndex = this.entries.length;
    this.entries.push({ t, part, state });
    this.count++;
  }

  /** Changes sorted by time; when truncated, the final state of each part is appended. */
  finish(): TimelineChange[] {
    const out = this.entries.filter((e): e is TimelineChange => e !== null);
    if (this.truncated) {
      for (const [part, tr] of this.tracks) {
        if (tr.missed) out.push({ t: tr.latestT, part, state: tr.latestState });
      }
    }
    return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
  }

  get size(): number {
    return this.count;
  }
}
