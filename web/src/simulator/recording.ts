// Expert recording (owner: Anaís): the simulator's canvas → .webm, plus one ClipRecord per ground-truth
// action segment. MOCK: there is no upload endpoint yet, so "sending" downloads both files.
//
// Labels come from the simulator's own events checked against the recipe's step graph: an action whose
// prerequisites aren't done is out of order; a task mistake action is that mistake. A segment that is
// wrong but has no MistakeDef can't be a valid ClipRecord (is_correct=false needs a mistake_id), so it
// is dropped and counted, never silently relabeled.
import type { ClipRecord } from '../contracts/clip_record';
import type { Task } from '../contracts/ws_server_message';
import type { SimEvent } from './types';

export const RECORD_FPS = 30;

export type Labeled = { clips: ClipRecord[]; dropped: { t: number; action: string; reason: string }[] };

const round = (x: number) => Math.round(x * 100) / 100;

/** Label a run. `events` are sorted by `t`; `durationS` is the recording length. */
export function labelRun(task: Task, runId: string, events: SimEvent[], durationS: number): Labeled {
  const done = new Set<string>();
  const clips: ClipRecord[] = [];
  const dropped: Labeled['dropped'] = [];
  const bounds = [0, ...events.map((e) => e.t), durationS];
  const segments: { a: number; b: number; action: string | null }[] = [
    { a: 0, b: bounds[1], action: null },
    ...events.map((e, i) => ({ a: e.t, b: bounds[i + 2], action: e.action })),
  ];
  for (const { a, b, action } of segments) {
    if (b - a < 0.05) continue; // two events in the same instant: the later one carries the segment
    const base = {
      task_id: task.id,
      task_version: task.version,
      run_id: runId,
      split: 'train' as const, // per run; real assignment happens when the data is ingested
      source: 'recorded' as const,
      path: `recorded/${runId}.webm#t=${round(a)},${round(b)}`,
      duration_s: round(b - a),
      fps: RECORD_FPS,
      prompt: null,
    };
    const id = `${runId}_${String(clips.length).padStart(3, '0')}`;
    if (action === null) {
      clips.push({ ...base, id, action: null, step: null, is_correct: true, mistake_id: null });
      continue;
    }
    const mistakeAction = task.mistakes?.find((m) => m.action === action);
    if (mistakeAction) {
      clips.push({ ...base, id, action, step: mistakeAction.step, is_correct: false, mistake_id: mistakeAction.id });
      continue;
    }
    const step = task.steps.find((s) => s.action === action);
    if (!step) {
      dropped.push({ t: a, action, reason: 'la acción no está en la receta' });
      continue;
    }
    if (done.has(step.id)) {
      dropped.push({ t: a, action, reason: 'paso repetido' });
      continue;
    }
    const ready = (step.requires ?? []).every((r) => done.has(r));
    if (!ready) {
      const def = task.mistakes?.find((m) => m.kind === 'out_of_order' && m.step === step.id);
      if (def) clips.push({ ...base, id, action, step: step.id, is_correct: false, mistake_id: def.id });
      else dropped.push({ t: a, action, reason: 'fuera de orden sin error definido' });
      continue;
    }
    done.add(step.id);
    clips.push({ ...base, id, action, step: step.id, is_correct: true, mistake_id: null });
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
