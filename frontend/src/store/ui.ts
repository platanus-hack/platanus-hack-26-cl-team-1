/** UI state that is NOT part of the document (not undoable, not persisted). */
import { create } from 'zustand';
import type { Id } from '@/contracts';

export type MainView = 'hardware' | 'software';
export type HardwareMode = 'board' | 'schematic';
export type Tool = 'select' | 'wire' | 'pan';

export interface Highlight {
  targets: string[]; // part ids, wire ids or pin refs
  message?: string;
  /** Who set it ('agent' | 'guide' | 'checks' …) so each clears only its own. */
  source?: string;
  at: number;
}

export interface UIState {
  view: MainView;
  hardwareMode: HardwareMode;
  tool: Tool;
  selection: { parts: Id[]; wires: Id[] };
  hoveredPin: string | null;
  highlight: Highlight | null;
  panels: { agent: boolean; sim: boolean; checks: boolean; guide: boolean };
  /** Toasts shown by the app shell. */
  toasts: Array<{ id: number; kind: 'info' | 'success' | 'warning' | 'error'; text: string }>;

  setView: (v: MainView) => void;
  setHardwareMode: (m: HardwareMode) => void;
  /** Convenience used by the agent: 'hardware' | 'schematic' | 'software'. */
  showView: (v: 'hardware' | 'schematic' | 'software') => void;
  /** 'hardware' | 'schematic' | 'software' (agent summary / context). */
  currentView: () => 'hardware' | 'schematic' | 'software';
  setTool: (t: Tool) => void;
  select: (sel: { parts?: Id[]; wires?: Id[] }) => void;
  clearSelection: () => void;
  setHoveredPin: (p: string | null) => void;
  setHighlight: (targets: string[], message?: string, source?: string) => void;
  /** Clear only if the current highlight was set by `source` (or always when omitted). */
  clearHighlight: (source?: string) => void;
  togglePanel: (p: keyof UIState['panels'], open?: boolean) => void;
  toast: (text: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
  dismissToast: (id: number) => void;
}

let toastId = 1;

export const useUI = create<UIState>((set, get) => ({
  view: 'hardware',
  hardwareMode: 'board',
  tool: 'select',
  selection: { parts: [], wires: [] },
  hoveredPin: null,
  highlight: null,
  panels: { agent: true, sim: true, checks: false, guide: false },
  toasts: [],
  setView: (view) => set({ view }),
  setHardwareMode: (hardwareMode) => set({ hardwareMode }),
  showView: (v) => (v === 'software' ? set({ view: 'software' }) : set({ view: 'hardware', hardwareMode: v === 'schematic' ? 'schematic' : 'board' })),
  currentView: () => (get().view === 'software' ? 'software' : get().hardwareMode === 'schematic' ? 'schematic' : 'hardware'),
  setTool: (tool) => set({ tool }),
  select: ({ parts = [], wires = [] }) => set({ selection: { parts, wires } }),
  clearSelection: () => set({ selection: { parts: [], wires: [] } }),
  setHoveredPin: (hoveredPin) => set({ hoveredPin }),
  setHighlight: (targets, message, source) => set({ highlight: { targets, message, source, at: Date.now() } }),
  clearHighlight: (source) => {
    const h = get().highlight;
    if (!source || !h || h.source === source) set({ highlight: null });
  },
  togglePanel: (p, open) => set({ panels: { ...get().panels, [p]: open ?? !get().panels[p] } }),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), 4500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
