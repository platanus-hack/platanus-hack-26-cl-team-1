/**
 * Project store: the ProjectModel + transactional undo/redo history.
 * ALL mutations go through dispatch(ops, meta) — see contracts/ops.ts.
 */
import { create } from 'zustand';
import type { DispatchMeta, DispatchResult, HistoryEntry, Op, ProjectModel } from '@/contracts';
import { applyOps } from './applyOp';
import { createStarterProject } from './newProject';
import { normalizeProject } from './normalize';

const STORAGE_KEY = 'circuito-vivo:project:v1';
const MAX_HISTORY = 200;
const MERGE_WINDOW_MS = 1000;

export interface ProjectState {
  project: ProjectModel;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Apply ops atomically as ONE undo step. */
  dispatch: (ops: Op | Op[], meta?: DispatchMeta) => DispatchResult;
  undo: () => void;
  redo: () => void;
  /** Replace the project WITHOUT history (initial load). Use dispatch(project.load) for undoable loads. */
  replaceProject: (p: ProjectModel) => void;
  /** Undo the most recent history entry if it belongs to `group` (agent turn). Returns true if undone. */
  undoGroup: (group: string) => boolean;
}

/* ------------------------------ pending edits ------------------------------ */

const flushers = new Set<() => void>();

/**
 * Editors that debounce their writes (the block editor waits 300 ms) register a flush here.
 * It runs before every dispatch, undo and redo, so a pending edit lands as its own history
 * step instead of being overwritten (or merged into the wrong step) by the outside change.
 * Returns the unregister function.
 */
export function registerPendingFlush(fn: () => void): () => void {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

/** Run every registered flush (re-entrant safe: a flush that dispatches finds nothing pending). */
export function flushPendingEdits(): void {
  for (const fn of [...flushers]) fn();
}

function loadInitial(): ProjectModel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = normalizeProject(JSON.parse(raw));
      if (p) return p;
    }
  } catch {
    /* ignore */
  }
  return createStarterProject('uno');
}

export const useProject = create<ProjectState>((set, get) => ({
  project: typeof localStorage === 'undefined' ? createStarterProject('uno') : loadInitial(),
  past: [],
  future: [],
  dispatch: (opOrOps, meta = {}) => {
    const ops = Array.isArray(opOrOps) ? opOrOps : [opOrOps];
    if (ops.length === 0) return { ok: true };
    flushPendingEdits();
    const { project, past } = get();
    const r = applyOps(project, ops);
    if ('error' in r) return { ok: false, error: r.error };
    const now = Date.now();
    const last = past[past.length - 1];
    let nextPast: HistoryEntry[];
    const sameGroup = !!meta.group && !!last && last.group === meta.group;
    const sameMerge = !!meta.mergeKey && !!last && last.mergeKey === meta.mergeKey && now - last.at < MERGE_WINDOW_MS;
    if (sameGroup || sameMerge) {
      // merge: keep the ORIGINAL inverse (restores the state before the first merged step)
      nextPast = [...past.slice(0, -1), { ...last, ops: [...last.ops, ...ops], inverse: [...r.inverse, ...last.inverse], at: now }];
    } else {
      const entry: HistoryEntry = {
        ops,
        inverse: r.inverse,
        label: meta.label ?? describeOps(ops),
        source: meta.source ?? 'user',
        at: now,
        mergeKey: meta.mergeKey,
        group: meta.group,
      };
      nextPast = [...past, entry].slice(-MAX_HISTORY);
    }
    set({ project: r.model, past: nextPast, future: [] });
    return { ok: true };
  },
  undo: () => {
    flushPendingEdits();
    const { past, future, project } = get();
    const entry = past[past.length - 1];
    if (!entry) return;
    const r = applyOps(project, entry.inverse);
    if ('error' in r) {
      console.error('undo failed', r.error);
      set({ past: past.slice(0, -1) });
      return;
    }
    set({ project: r.model, past: past.slice(0, -1), future: [entry, ...future] });
  },
  redo: () => {
    flushPendingEdits();
    const { past, future, project } = get();
    const entry = future[0];
    if (!entry) return;
    const r = applyOps(project, entry.ops);
    if ('error' in r) {
      console.error('redo failed', r.error);
      set({ future: future.slice(1) });
      return;
    }
    set({ project: r.model, past: [...past, { ...entry, inverse: r.inverse }], future: future.slice(1) });
  },
  replaceProject: (p) => set({ project: p, past: [], future: [] }),
  undoGroup: (group) => {
    flushPendingEdits();
    const last = get().past[get().past.length - 1];
    if (!last || last.group !== group) return false;
    get().undo();
    return true;
  },
}));

/** Spanish default label for a transaction. */
export function describeOps(ops: Op[]): string {
  const op = ops[0];
  if (!op) return 'Cambio';
  switch (op.op) {
    case 'part.add': return 'Agregar componente';
    case 'part.remove': return 'Eliminar componente';
    case 'part.move': return 'Mover componente';
    case 'part.rotate': return 'Rotar componente';
    case 'part.setProps': return 'Cambiar propiedad';
    case 'part.setLabel': return 'Renombrar componente';
    case 'wire.add': return 'Agregar cable';
    case 'wire.remove': return 'Eliminar cable';
    case 'wire.update': return 'Editar cable';
    case 'program.set': return 'Editar programa';
    case 'project.rename': return 'Renombrar proyecto';
    case 'project.load': return 'Cargar proyecto';
  }
}

/* Non-React accessors (agent tools, sim runtime, tests). */
export const getProject = () => useProject.getState().project;
export const dispatch = (ops: Op | Op[], meta?: DispatchMeta) => useProject.getState().dispatch(ops, meta);

/* Autosave (debounced; written right away when the page is hidden or closed). */
if (typeof window !== 'undefined') {
  let t: ReturnType<typeof setTimeout> | undefined;
  const persist = (p: ProjectModel) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      /* quota / private mode */
    }
  };
  useProject.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    clearTimeout(t);
    t = setTimeout(() => persist(s.project), 400);
  });
  // A reload or tab close within the debounce windows used to lose the last edit.
  const persistNow = () => {
    flushPendingEdits();
    clearTimeout(t);
    persist(useProject.getState().project);
  };
  window.addEventListener('pagehide', persistNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow();
  });
}
