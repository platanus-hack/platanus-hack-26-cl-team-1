/**
 * Modo Armado session controller: wires camera frames → AssemblyClient → store
 * and the server's voice → AudioQueue. One session at a time.
 */
import type { PartDef } from '@/contracts';
import { findPartDef } from '@/catalog';
import { buildWiringGuide } from '@/guide';
import { getNetlist } from '@/store/derived';
import { useProject } from '@/store/project';
import { AudioQueue, BrowserClipPlayer } from './audioQueue';
import { AssemblyClient } from './client';
import { type ClientMsg, type HelloMsg, type IssueKind, PROTOCOL, type ServerMsg } from './protocol';
import { useAssembly } from './store';
import { FRAME_H, FRAME_W } from './useCamera';

const FPS = 6;

let client: AssemblyClient | null = null;
let frameTimer: ReturnType<typeof setInterval> | null = null;
let capturing = false;
/** The server answered `ready` at least once in this session → later hellos are reconnects. */
let hadReady = false;
let video: HTMLVideoElement | null = null;
let canvas: HTMLCanvasElement | null = null;
const player = new BrowserClipPlayer();
const queue = new AudioQueue(player);
/** `say` messages whose audio has not arrived yet. */
const pendingSay = new Map<string, { text: string; priority: 'error' | 'info' }>();

queue.onChange = (speaking) => useAssembly.getState().patch({ speaking: !!speaking });

/** Snapshot of the project the user is building (design → steps → hello). */
export function buildHello(): HelloMsg {
  const st = useAssembly.getState();
  const project = st.project ?? useProject.getState().project;
  const netlist = getNetlist(project);
  const steps = st.steps.length ? st.steps : buildWiringGuide(project, netlist);
  const parts: Record<string, PartDef> = {};
  for (const p of project.parts) {
    const def = findPartDef(p.type);
    if (def) parts[p.type] = def;
  }
  // Only a REconnect resumes (the server then keeps the step and skips the greeting).
  const resume = hadReady ? { current: st.current, status: st.status } : undefined;
  return {
    type: 'hello',
    protocol: PROTOCOL,
    project,
    netlist,
    steps,
    parts,
    record: st.record,
    debug: st.debug,
    resume,
  };
}

function onMessage(m: ServerMsg): void {
  const s = useAssembly.getState();
  switch (m.type) {
    case 'ready':
      hadReady = true;
      s.patch({ ready: true, calibrated: m.calibrated, voice: m.voice });
      break;
    case 'calibration':
      s.patch({
        calibrated: m.ok,
        markers: m.markers,
        H: m.H ?? (m.ok ? s.H : null),
        refined: m.refined ?? s.refined,
        calibMessage: m.message ?? null,
      });
      break;
    case 'step':
      s.patch({ current: m.current, status: m.status });
      break;
    case 'issue':
      s.patch({ issue: { step: m.step, kind: m.kind, text: m.text, target: m.target, holes: m.holes } });
      break;
    case 'issue_clear':
      if (!s.issue || s.issue.step === m.step) s.patch({ issue: null });
      break;
    case 'say':
      s.patch({ subtitle: { text: m.text, priority: m.priority, at: Date.now() } });
      if (m.audio) pendingSay.set(m.id, { text: m.text, priority: m.priority });
      else queue.enqueue({ id: m.id, text: m.text, priority: m.priority });
      break;
    case 'cancel_say':
      pendingSay.delete(m.id);
      queue.cancel(m.id);
      break;
    case 'debug':
      s.patch({
        latency: { ...m.latency_ms, rtt: client?.stats.lastRttMs ?? 0 },
        rttMs: client?.stats.lastRttMs ?? 0,
        paused: m.paused ?? null,
        ...(m.detections ? { detections: m.detections } : {}),
      });
      break;
    case 'capture':
      s.patch({ capture: { ...s.capture, saved: m.saved } });
      break;
    case 'error':
      s.patch({ calibMessage: m.message });
      break;
  }
}

function onAudio(id: string, audio: ArrayBuffer): void {
  const meta = pendingSay.get(id);
  pendingSay.delete(id);
  if (!meta) return; // cancelled meanwhile
  queue.enqueue({ id, audio, ...meta });
}

async function grabFrame(): Promise<void> {
  if (!client || !video || capturing || video.readyState < 2) return;
  if (!client.canSendFrame()) return;
  capturing = true;
  try {
    canvas ??= document.createElement('canvas');
    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, FRAME_W, FRAME_H);
    const quality = useAssembly.getState().capture.on ? 0.92 : 0.7;
    const blob = await new Promise<Blob | null>((r) => canvas!.toBlob(r, 'image/jpeg', quality));
    if (blob && client) client.sendFrame(await blob.arrayBuffer());
  } finally {
    capturing = false;
  }
}

/** Must be called from a user gesture (audio unlock). */
export function startSession(videoEl: HTMLVideoElement): void {
  stopSession();
  hadReady = false;
  player.unlock();
  const st = useAssembly.getState();
  const project = useProject.getState().project;
  const steps = buildWiringGuide(project, getNetlist(project));
  st.patch({
    running: true,
    project,
    steps,
    current: 1,
    status: Object.fromEntries(steps.map((x) => [String(x.index), x.index === 1 ? 'active' : 'pending'])),
    issue: null,
    subtitle: null,
    ready: false,
    calibrated: false,
    markers: 0,
    detections: [],
  });
  video = videoEl;
  client = new AssemblyClient({
    url: st.visionUrl,
    hello: buildHello,
    onMessage,
    onAudio,
    onStatus: (conn, info) => {
      useAssembly.getState().patch({ conn, attempt: info.attempt, ...(conn !== 'open' ? { ready: false } : {}) });
    },
  });
  client.connect();
  if (st.muted) send({ type: 'mute', muted: true });
  frameTimer = setInterval(() => void grabFrame(), 1000 / FPS);
}

export function stopSession(): void {
  if (frameTimer) clearInterval(frameTimer);
  frameTimer = null;
  client?.close();
  client = null;
  video = null;
  queue.clear();
  pendingSay.clear();
  useAssembly.getState().patch({ running: false, conn: 'idle', ready: false, speaking: false });
}

export function send(msg: ClientMsg): boolean {
  return client?.send(msg) ?? false;
}

export function setMuted(muted: boolean): void {
  useAssembly.getState().patch({ muted });
  queue.setMuted(muted);
  send({ type: 'mute', muted });
}

export function setDebug(debug: boolean): void {
  useAssembly.getState().patch({ debug });
  send({ type: 'set_debug', debug });
}

/** Dataset recording (F7): keys 1–6 = error inserted (this order), 0 = fixed, N = step done. */
export const LABEL_KEYS: Array<{ key: string; kind: IssueKind; label: string }> = [
  { key: '1', kind: 'missing', label: 'falta' },
  { key: '2', kind: 'wrong_hole', label: 'hueco corrido' },
  { key: '3', kind: 'led_reversed', label: 'polaridad' },
  { key: '4', kind: 'wrong_part', label: 'pieza equivocada' },
  { key: '5', kind: 'wire_wrong_end', label: 'cable mal' },
  { key: '6', kind: 'extra_part', label: 'pieza de más' },
];

export function setRecord(record: boolean): void {
  useAssembly.getState().patch({ record });
  send({ type: 'set_record', record });
}

/** Returns true when the key was a recording shortcut. */
export function recordKey(key: string): boolean {
  if (!useAssembly.getState().record) return false;
  const l = LABEL_KEYS.find((x) => x.key === key);
  if (l) return send({ type: 'label', kind: 'error_inserted', error: l.kind });
  if (key === '0') return send({ type: 'label', kind: 'error_fixed' });
  if (key === 'n' || key === 'N') return send({ type: 'skip_step' });
  return false;
}

export function setCapture(on: boolean): void {
  const s = useAssembly.getState();
  s.patch({ capture: { ...s.capture, on } });
  send({ type: 'set_capture', on });
}
