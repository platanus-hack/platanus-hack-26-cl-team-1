/** Modo Armado UI/session state (not part of the document, not undoable). */
import { create } from 'zustand';
import type { GuideStep, ProjectModel } from '@/contracts';
import type { ConnStatus } from './client';
import type { Detection, IssueKind, StepStatus } from './protocol';

const URL_KEY = 'cv.visionUrl';

/** Accepts "https://x.trycloudflare.com", "wss://x/ws/session", "x.trycloudflare.com" → wss://…/ws/session. */
export function normalizeVisionUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return '';
  if (!/^[a-z]+:\/\//i.test(u)) u = `wss://${u}`;
  u = u.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
  try {
    const url = new URL(u);
    if (url.pathname === '/' || url.pathname === '') url.pathname = '/ws/session';
    return url.toString();
  } catch {
    return '';
  }
}

/** wss://host/ws/session → https://host/health (same server, plain HTTP check). */
export function healthUrl(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    u.protocol = u.protocol === 'ws:' ? 'http:' : 'https:';
    u.pathname = '/health';
    u.search = '';
    return u.toString();
  } catch {
    return '';
  }
}

function readStoredUrl(): string {
  try {
    const q = new URLSearchParams(window.location.search).get('vision');
    if (q) {
      const u = normalizeVisionUrl(q);
      if (u) localStorage.setItem(URL_KEY, u);
      return u;
    }
    return localStorage.getItem(URL_KEY) ?? '';
  } catch {
    return '';
  }
}

export interface Issue {
  step: number;
  kind: IssueKind;
  text: string;
  target?: string;
  holes?: string[];
}

export interface AssemblyState {
  open: boolean;
  visionUrl: string;
  /** Session running (camera + socket). */
  running: boolean;
  conn: ConnStatus;
  attempt: number;
  cameraError: string | null;
  ready: boolean;
  voice: string | null;
  calibrated: boolean;
  markers: number;
  /** Breadboard grid → frame pixel homography (row-major 3×3). */
  H: number[] | null;
  refined: boolean;
  calibMessage: string | null;
  /** Snapshot taken when the session starts. */
  project: ProjectModel | null;
  steps: GuideStep[];
  current: number;
  status: Record<string, StepStatus>;
  issue: Issue | null;
  subtitle: { text: string; priority: 'error' | 'info'; at: number } | null;
  speaking: boolean;
  debug: boolean;
  muted: boolean;
  record: boolean;
  capture: { on: boolean; saved: number };
  detections: Detection[];
  latency: Record<string, number>;
  rttMs: number;
  paused: string | null;
  /** Click calibration in progress: index of the next hole to click (0..3), or null. */
  calibClick: number | null;

  setOpen: (open: boolean) => void;
  setVisionUrl: (raw: string) => void;
  patch: (p: Partial<AssemblyState>) => void;
}

export const CALIB_HOLES = ['a1', 'a30', 'j1', 'j30'] as const;

function openFromUrl(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('armado');
  } catch {
    return false;
  }
}

export const useAssembly = create<AssemblyState>((set) => ({
  /** `?armado` in the URL opens the Modo Armado directly (demo link). */
  open: typeof window === 'undefined' ? false : openFromUrl(),
  visionUrl: typeof window === 'undefined' ? '' : readStoredUrl(),
  running: false,
  conn: 'idle',
  attempt: 0,
  cameraError: null,
  ready: false,
  voice: null,
  calibrated: false,
  markers: 0,
  H: null,
  refined: false,
  calibMessage: null,
  project: null,
  steps: [],
  current: 1,
  status: {},
  issue: null,
  subtitle: null,
  speaking: false,
  debug: false,
  muted: false,
  record: false,
  capture: { on: false, saved: 0 },
  detections: [],
  latency: {},
  rttMs: 0,
  paused: null,
  calibClick: null,

  setOpen: (open) => set({ open }),
  setVisionUrl: (raw) => {
    const visionUrl = normalizeVisionUrl(raw);
    try {
      if (visionUrl) localStorage.setItem(URL_KEY, visionUrl);
      else localStorage.removeItem(URL_KEY);
    } catch {
      /* private mode */
    }
    set({ visionUrl });
  },
  patch: (p) => set(p),
}));

/** Apply a homography (row-major 3×3) to a point. */
export function applyH(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}
