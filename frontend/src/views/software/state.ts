/**
 * View-local state of the software view (not persisted, not undoable):
 * the block selected in Blockly (plus its descendants, to highlight the C++
 * lines it generates) and a bridge to focus a block from anywhere.
 */
import { create } from 'zustand';
import { useUI } from '@/store/ui';

export interface SoftwareViewState {
  /** Selected block id in the editor. */
  selected: string | null;
  /** Selected block + all its descendants (ids). */
  selectedIds: string[];
  setSelection: (selected: string | null, ids: string[]) => void;
}

export const useSoftwareView = create<SoftwareViewState>((set) => ({
  selected: null,
  selectedIds: [],
  setSelection: (selected, selectedIds) => set({ selected, selectedIds }),
}));

/* ------------------------- window 'cv:focus-block' ------------------------ */

type FocusHandler = (blockId: string) => boolean;

let handler: FocusHandler | null = null;
let pending: string | null = null;

/** The mounted editor registers its focus handler here (null on unmount); pending requests are delivered. */
export function setFocusHandler(h: FocusHandler | null): void {
  handler = h;
  if (h && pending) {
    // Let Blockly finish its first render before scrolling. Deliver to whichever
    // editor is mounted by then (React StrictMode mounts twice in development).
    setTimeout(() => {
      if (!handler || !pending) return;
      const id = pending;
      pending = null;
      handler(id);
    }, 80);
  }
}

/** Ask the editor to select + scroll to a block (switches to the software view if needed). */
export function focusBlock(blockId: string): void {
  if (!blockId) return;
  if (handler && useUI.getState().view === 'software') {
    handler(blockId);
    return;
  }
  pending = blockId;
  useUI.getState().setView('software');
}

if (typeof window !== 'undefined') {
  window.addEventListener('cv:focus-block', (e: Event) => {
    const id = (e as CustomEvent<{ blockId?: unknown }>).detail?.blockId;
    if (typeof id === 'string') focusBlock(id);
  });
}
