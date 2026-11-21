/**
 * Conversation store (local to agent/). `messages` is the append-only API
 * history (the browser is the source of truth); `turns` is the UI view of it.
 * Persisted in sessionStorage so a reload keeps the chat.
 */
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { AgentStep, ApiContentBlock, ApiMessage, DecisionCard } from '@/contracts';

export type TurnItem =
  | { kind: 'text'; id: string; iter: number; text: string }
  | { kind: 'step'; id: string; iter: number; step: AgentStep }
  | { kind: 'decision'; id: string; iter: number; card: DecisionCard }
  | { kind: 'notice'; id: string; iter: number; tone: 'info' | 'warning'; text: string };

export type TurnStatus = 'streaming' | 'tools' | 'waiting-user' | 'done' | 'error' | 'stopped';

export interface TurnError {
  message: string;
  retryable: boolean;
  code?: string;
}

export interface Turn {
  /** Also the history group of the turn's project changes. */
  id: string;
  userText: string;
  createdAt: number;
  items: TurnItem[];
  /** Summarized thinking of the current iteration (display only). */
  thinking: string;
  /** Iteration counter (one per API call). */
  iter: number;
  status: TurnStatus;
  error?: TurnError;
  /** The project changed during this turn (offers "Deshacer cambios del asistente"). */
  changed: boolean;
  undone: boolean;
}

export interface AgentState {
  messages: ApiMessage[];
  turns: Turn[];
  busy: boolean;
  /** tool_use id → tool_result computed before the student stopped the agent. */
  partialResults: Record<string, ApiContentBlock>;

  appendMessage: (m: ApiMessage) => void;
  addTurn: (t: Turn) => void;
  patchTurn: (id: string, patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) => void;
  setBusy: (busy: boolean) => void;
  setPartial: (id: string, block: ApiContentBlock | null) => void;
  clearPartials: () => void;
  reset: () => void;
}

const memory = new Map<string, string>();

/** sessionStorage that never throws (private mode, quota, SSR/tests → in-memory). */
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(k) : memory.get(k) ?? null;
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem: (k, v) => {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(k, v);
      else memory.set(k, v);
    } catch {
      memory.set(k, v);
    }
  },
  removeItem: (k) => {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    memory.delete(k);
  },
};

const ACTIVE: TurnStatus[] = ['streaming', 'tools', 'waiting-user'];

export const useAgent = create<AgentState>()(
  persist(
    (set) => ({
      messages: [],
      turns: [],
      busy: false,
      partialResults: {},
      appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
      addTurn: (t) => set((s) => ({ turns: [...s.turns, t] })),
      patchTurn: (id, patch) =>
        set((s) => ({
          turns: s.turns.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
        })),
      setBusy: (busy) => set({ busy }),
      setPartial: (id, block) =>
        set((s) => {
          const next = { ...s.partialResults };
          if (block) next[id] = block;
          else delete next[id];
          return { partialResults: next };
        }),
      clearPartials: () => set({ partialResults: {} }),
      reset: () => set({ messages: [], turns: [], busy: false, partialResults: {} }),
    }),
    {
      name: 'circuito-vivo:agent:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ messages: s.messages, turns: s.turns, partialResults: s.partialResults }),
      // A reload interrupts whatever was running.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.busy = false;
        state.turns = state.turns.map((t) =>
          ACTIVE.includes(t.status)
            ? {
                ...t,
                status: 'done',
                thinking: '',
                items: [
                  ...t.items.map(stopStep),
                  { kind: 'notice', id: `reload-${t.iter}`, iter: t.iter, tone: 'info', text: 'Me interrumpí al recargar la página. Escríbeme para continuar.' },
                ],
              }
            : t,
        );
      },
    },
  ),
);

function stopStep(item: TurnItem): TurnItem {
  if (item.kind !== 'step' || (item.step.status !== 'running' && item.step.status !== 'pending')) return item;
  return { ...item, step: { ...item.step, status: 'error', detail: 'Interrumpido' } };
}

/* Small helpers used by the loop and the views. */
export const getTurn = (id: string): Turn | undefined => useAgent.getState().turns.find((t) => t.id === id);
export const lastTurn = (): Turn | undefined => {
  const turns = useAgent.getState().turns;
  return turns[turns.length - 1];
};
