// Expert recording (owner: Anaís): the simulator's canvas → .webm, plus one ClipRecord per ground-truth
// action segment. MOCK: there is no upload endpoint yet, so "sending" downloads both files.
//
// Labels come from the simulator's own events checked against the recipe's step graph: an action whose
// prerequisites aren't done is out of order; a task mistake action is that mistake. A segment that is
// wrong but has no MistakeDef can't be a valid ClipRecord (is_correct=false needs a mistake_id), so it
// is dropped and counted, never silently relabeled.
import type { ClipRecord, Split } from '../contracts/clip_record';
import type { Task } from '../contracts/ws_server_message';
import type { SimEvent } from './types';

export const RECORD_FPS = 30;

export type Labeled = { clips: ClipRecord[]; dropped: { t: number; action: string; reason: string }[] };

const round = (x: number) => Math.round(x * 100) / 100;

/** Shortest segment that becomes a clip; shorter ones (two actions in the same instant) are reported. */
export const MIN_CLIP_S = 0.05;

type Label = { step: string | null; is_correct: boolean; mistake_id: string | null } | { reason: string };

/** What `action` means after the steps in `done` (and the step it completes, if it advances). */
function classify(task: Task, done: Set<string>, action: string): { label: Label; completes?: string } {
  const mistakeAction = task.mistakes?.find((m) => m.action === action);
  if (mistakeAction) return { label: { step: mistakeAction.step, is_correct: false, mistake_id: mistakeAction.id } };
  const step = task.steps.find((s) => s.action === action);
  if (!step) return { label: { reason: 'la acción no está en la receta' } };
  if (done.has(step.id)) return { label: { reason: 'paso repetido' } };
  if (!(step.requires ?? []).every((r) => done.has(r))) {
    const def = task.mistakes?.find((m) => m.kind === 'out_of_order' && m.step === step.id);
    return { label: def ? { step: step.id, is_correct: false, mistake_id: def.id } : { reason: 'fuera de orden sin error definido' } };
  }
  return { label: { step: step.id, is_correct: true, mistake_id: null }, completes: step.id };
}

/**
 * Label a run. `events` are sorted by `t`, in seconds on the **video's** clock (the recorder's, not the
 * simulator's: they drift apart when the tab pauses); `durationS` is the video length. `split` is the
 * whole run's split (splits are per run, never per clip).
 */
export function labelRun(task: Task, runId: string, events: SimEvent[], durationS: number, split: Split): Labeled {
  const done = new Set<string>();
  const clips: ClipRecord[] = [];
  const dropped: Labeled['dropped'] = [];
  const bounds = [0, ...events.map((e) => e.t), durationS];
  const segments: { a: number; b: number; action: string | null }[] = [
    { a: 0, b: bounds[1], action: null },
    ...events.map((e, i) => ({ a: e.t, b: bounds[i + 2], action: e.action })),
  ];
  for (const { a, b, action } of segments) {
    // Classify first: an action moves the recipe forward even when its segment is too short to keep.
    const { label, completes } = action === null ? { label: { step: null, is_correct: true, mistake_id: null } } : classify(task, done, action);
    if (completes) done.add(completes);
    if (b - a < MIN_CLIP_S) {
      if (action !== null) dropped.push({ t: a, action, reason: 'duró menos de 50 ms (otra acción en el mismo instante)' });
      continue;
    }
    if ('reason' in label) {
      if (action !== null) dropped.push({ t: a, action, reason: label.reason });
      continue;
    }
    clips.push({
      id: `${runId}_${String(clips.length).padStart(3, '0')}`,
      task_id: task.id,
      task_version: task.version,
      run_id: runId,
      split,
      source: 'recorded',
      path: `recorded/${runId}.webm#t=${round(a)},${round(b)}`,
      duration_s: round(b - a),
      fps: RECORD_FPS,
      prompt: null,
      action,
      ...label,
    });
  }
  return { clips, dropped };
}

/** Which steps the ground truth says are done (for the recording checklist). */
export function doneSteps(task: Task, events: SimEvent[]): Set<string> {
  const done = new Set<string>();
  for (const e of events) {
    const step = task.steps.find((s) => s.action === e.action);
    if (step && (step.requires ?? []).every((r) => done.has(r))) done.add(step.id);
  }
  return done;
}

export function newRunId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `rec_${stamp}_${Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, 'x')}`;
}

/** Records a canvas with MediaRecorder. */
export class CanvasRecorder {
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private t0 = 0;

  constructor(canvas: HTMLCanvasElement) {
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    if (!type) throw new Error('este navegador no puede grabar video webm');
    this.recorder = new MediaRecorder(canvas.captureStream(RECORD_FPS), { mimeType: type, videoBitsPerSecond: 6_000_000 });
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
  }

  start(): void {
    this.chunks = [];
    this.t0 = performance.now();
    this.recorder.start(1000);
  }

  /** Seconds since `start()` on the video's clock: stamp labels with this, not with simulator time. */
  elapsedS(): number {
    return (performance.now() - this.t0) / 1000;
  }

  /** Stops and resolves with the video and its length in seconds. */
  stop(): Promise<{ video: Blob; durationS: number }> {
    const durationS = (performance.now() - this.t0) / 1000;
    return new Promise((resolve, reject) => {
      this.recorder.onstop = () => resolve({ video: new Blob(this.chunks, { type: 'video/webm' }), durationS });
      this.recorder.onerror = () => reject(new Error('la grabación falló'));
      this.recorder.stop();
    });
  }
}

export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** MOCK upload: saves the video and the JSONL manifest locally. Replace with a POST once the server has an endpoint. */
export function sendRecordingMock(runId: string, video: Blob, labeled: Labeled): void {
  download(`${runId}.webm`, video);
  const jsonl = labeled.clips.map((c) => JSON.stringify(c)).join('\n') + '\n';
  download(`${runId}.clips.jsonl`, new Blob([jsonl], { type: 'application/x-ndjson' }));
}
