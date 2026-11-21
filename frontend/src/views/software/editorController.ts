/**
 * Owns the injected Blockly workspace and keeps it in sync with the project
 * store (kept outside React so store updates never re-render the editor).
 *
 * Sync rules
 *  - Blockly change events (UI events ignored) → debounce 300 ms → dispatch
 *    program.set {label 'Editar programa'}; the emitted object is remembered.
 *    A save that would not change the program is skipped (it would only wipe redo).
 *    Each gesture is its own undo step; consecutive edits of the same field
 *    (typing a number) merge under a per-field mergeKey.
 *  - The project store is the ONLY undo history: Blockly's undo/redo shortcuts
 *    and its "Deshacer"/"Rehacer" context items are routed to it, and a pending
 *    (debounced) edit is flushed before any undo/redo or outside dispatch.
 *  - project.program.workspace changes to an object the editor does not
 *    reflect (agent, undo, example load) → reload with events disabled,
 *    keeping zoom, scroll and selection.
 *  - Parts/board changes → rebuild the toolbox, refresh dynamic dropdowns,
 *    recompute block warnings (unbound parts, missing pins, loose blocks).
 *  - A fresh workspace always gets the "al iniciar" / "repetir para siempre" hats.
 */
import * as Blockly from 'blockly';
import type { ProjectModel } from '@/contracts';
import { registerPendingFlush, useProject } from '@/store/project';
import { programContext, type ProgramContext } from '@/program/context';
import {
  BLOCK_TYPES,
  buildToolbox,
  checkerPlugin,
  computeBlockWarnings,
  getTheme,
  refreshDynamicFields,
  registerBlocks,
  registerToolboxCallbacks,
} from '@/program/blocks';
import { registerToolboxCategory } from './toolboxCategory';

const SAVE_DEBOUNCE_MS = 300;
const HAT_X = 40;
const HAT_Y = 40;
const ORPHAN_WARNING_ID = 'cv-orphan';
/** Hardware warnings (part not wired, pin missing) get their own id so clearing them keeps the orphan one. */
const HW_WARNING_ID = 'cv-hw';
const ORPHAN_WARNING =
  'Este bloque está suelto y no se ejecuta: arrástralo dentro de «al iniciar» o «repetir para siempre».';

export interface EditorCallbacks {
  onSelect: (blockId: string | null, ids: string[]) => void;
}

/** Zoom + scroll of the workspace, kept across reloads and remounts. */
export interface EditorView {
  scale: number;
  scrollX: number;
  scrollY: number;
}

export interface EditorOptions {
  /** View to restore after mounting (e.g. coming back from the Hardware tab). */
  initialView?: EditorView | null;
}

/** Blockly media: served locally in dev (Vite serves node_modules), CDN otherwise. */
const MEDIA = '/blockly-media/';

function hardwareKey(project: ProjectModel, ctx: ProgramContext): string {
  const parts = project.parts.map((p) => `${p.id}:${p.type}:${p.label}`).join('|');
  const bindings = ctx.bindings.map((b) => `${b.part}.${b.channel ?? ''}=${b.boardPin ?? '-'}`).join('|');
  return `${ctx.board?.id ?? 'none'}#${parts}#${bindings}`;
}

let globalsCustomized = false;

/**
 * Global Blockly tweaks (done once):
 *  - Blockly keeps its own undo stack, which the editor clears on every reload, so Cmd+Z inside
 *    the canvas and the toolbar "Deshacer" used to walk two different histories. Its shortcuts
 *    and context-menu items now go to the project store.
 *  - «al iniciar» / «repetir para siempre» cannot be disabled: a greyed-out hat silently stops
 *    the whole program (and the agent, which only sees the IR, would drop its blocks).
 */
function customizeBlocklyGlobals(): void {
  if (globalsCustomized) return;
  globalsCustomized = true;
  const shortcuts = Blockly.ShortcutRegistry.registry;
  const names = Blockly.ShortcutItems.names;
  for (const [name, run] of [
    [names.UNDO, () => useProject.getState().undo()],
    [names.REDO, () => useProject.getState().redo()],
  ] as const) {
    const original = shortcuts.getRegistry()[name];
    if (!original) continue;
    // Re-registering with allowOverrides would re-add the key codes and collide: unregister first.
    shortcuts.unregister(name);
    shortcuts.register({
      ...original,
      callback: (ws, e) => {
        ws.hideChaff();
        e.preventDefault();
        run();
        return true;
      },
    });
  }
  const menu = Blockly.ContextMenuRegistry.registry;
  for (const [id, has, run] of [
    ['undoWorkspace', () => useProject.getState().past.length > 0, () => useProject.getState().undo()],
    ['redoWorkspace', () => useProject.getState().future.length > 0, () => useProject.getState().redo()],
  ] as const) {
    const item = menu.getItem(id);
    if (!item) continue;
    menu.unregister(id);
    menu.register({ ...item, preconditionFn: () => (has() ? 'enabled' : 'disabled'), callback: () => run() } as Blockly.ContextMenuRegistry.RegistryItem);
  }
  const disable = menu.getItem('blockDisable') as (Blockly.ContextMenuRegistry.RegistryItem & { preconditionFn?: (s: Blockly.ContextMenuRegistry.Scope, e: Event) => string }) | null;
  if (disable?.preconditionFn) {
    const original = disable.preconditionFn;
    menu.unregister('blockDisable');
    menu.register({
      ...disable,
      preconditionFn: (scope: Blockly.ContextMenuRegistry.Scope, e: Event) => {
        const type = scope.block?.type;
        if ((type === BLOCK_TYPES.setup || type === BLOCK_TYPES.loop) && !scope.block?.hasDisabledReason('MANUALLY_DISABLED')) return 'hidden';
        return original(scope, e);
      },
    } as Blockly.ContextMenuRegistry.RegistryItem);
  }
}

/** Kind of the edits waiting to be saved: one field being typed into, or anything else. */
type PendingKind = { field: string } | 'other';

function editKind(e: Blockly.Events.Abstract): PendingKind {
  if (e.type === Blockly.Events.BLOCK_FIELD_INTERMEDIATE_CHANGE) {
    const f = e as Blockly.Events.BlockFieldIntermediateChange;
    return { field: `${f.blockId}:${f.name}` };
  }
  if (e.type === Blockly.Events.BLOCK_CHANGE) {
    const c = e as Blockly.Events.BlockChange;
    if (c.element === 'field') return { field: `${c.blockId}:${c.name}` };
  }
  return 'other';
}

export class EditorController {
  readonly ws: Blockly.WorkspaceSvg;
  /** The serialized workspace object the editor currently reflects. */
  private loaded: unknown = undefined;
  /** JSON of `loaded`, to skip saves that would not change anything. */
  private loadedJson = '';
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private warnTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingKind: PendingKind | null = null;
  private toolboxKey = '';
  private hwKey = '';
  private warnings = new Map<string, string | null>();
  private orphanWarned = new Set<string>();
  private unsubscribe: () => void;
  private unregisterFlush: () => void;
  private disposed = false;

  constructor(host: HTMLElement, private readonly cb: EditorCallbacks, opts: EditorOptions = {}) {
    registerBlocks();
    registerToolboxCategory();
    customizeBlocklyGlobals();
    // Context menus, field editors and dropdowns live at body level: inside the injection div
    // (overflow: hidden) they were clipped at the editor's right/bottom edge.
    Blockly.common.setParentContainer(document.body);
    const project = useProject.getState().project;
    const ctx = programContext(project);
    const toolbox = buildToolbox(ctx);
    this.toolboxKey = JSON.stringify(toolbox);
    this.ws = Blockly.inject(host, {
      toolbox: toolbox as Blockly.utils.toolbox.ToolboxDefinition,
      renderer: 'zelos',
      theme: getTheme(),
      media: MEDIA,
      sounds: false,
      trashcan: true,
      maxInstances: { [BLOCK_TYPES.setup]: 1, [BLOCK_TYPES.loop]: 1 },
      plugins: checkerPlugin,
      grid: { spacing: 28, length: 2, colour: '#1d2530', snap: false },
      // Wheel / two-finger swipe scrolls; Ctrl/⌘ + wheel and trackpad pinch zoom.
      zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.35, scaleSpeed: 1.12, pinch: true },
      move: { scrollbars: true, drag: true, wheel: true },
    });
    registerToolboxCallbacks(this.ws);

    this.loadExternal(project.program.workspace, opts.initialView ?? null);
    this.hwKey = hardwareKey(project, ctx);
    this.applyWarnings(ctx);
    this.ws.addChangeListener(this.onChange);
    // Blocks outside "al iniciar" / "repetir para siempre" are greyed out: they never run.
    this.ws.addChangeListener(Blockly.Events.disableOrphans);
    this.unsubscribe = useProject.subscribe((s, prev) => {
      if (s.project !== prev.project) this.syncProject(s.project);
    });
    this.unregisterFlush = registerPendingFlush(() => this.flush());
  }

  dispose(): void {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    clearTimeout(this.warnTimer);
    this.unsubscribe();
    this.unregisterFlush();
    this.ws.removeChangeListener(this.onChange);
    this.ws.dispose();
  }

  /** Current zoom + scroll (to restore after a remount). */
  getView(): EditorView {
    return { scale: this.ws.scale, scrollX: this.ws.scrollX, scrollY: this.ws.scrollY };
  }

  private setView(view: EditorView): void {
    if (view.scale !== this.ws.scale) this.ws.setScale(view.scale);
    this.ws.scroll(view.scrollX, view.scrollY);
  }

  /* ------------------------------ store → ws ------------------------------ */

  private syncProject(project: ProjectModel): void {
    if (this.disposed) return;
    if (project.program.workspace !== this.loaded) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.pendingKind = null;
      // Undo/redo/agent edits keep the student's place: same zoom, scroll and selection.
      const view = this.getView();
      const selected = Blockly.common.getSelected();
      const selectedId = selected instanceof Blockly.BlockSvg ? selected.id : null;
      this.loadExternal(project.program.workspace, view, selectedId);
    }
    const ctx = programContext(project);
    const toolbox = buildToolbox(ctx);
    const key = JSON.stringify(toolbox);
    if (key !== this.toolboxKey) {
      this.toolboxKey = key;
      this.ws.updateToolbox(toolbox as Blockly.utils.toolbox.ToolboxDefinition);
    }
    const hw = hardwareKey(project, ctx);
    if (hw !== this.hwKey) {
      this.hwKey = hw;
      refreshDynamicFields(this.ws);
      this.applyWarnings(ctx);
    }
  }

  /** Replace the editor content with `state` (no events, no undo history). */
  private loadExternal(state: unknown, view: EditorView | null = null, reselect: string | null = null): void {
    this.loaded = state;
    Blockly.Events.disable();
    try {
      this.ws.clear();
      if (state && typeof state === 'object') {
        try {
          Blockly.serialization.workspaces.load(state as Parameters<typeof Blockly.serialization.workspaces.load>[0], this.ws, { recordUndo: false });
        } catch (e) {
          console.error('No se pudo cargar el programa en el editor', e);
        }
      }
      this.ensureHats();
    } finally {
      Blockly.Events.enable();
    }
    this.ws.clearUndo();
    // What the editor now shows, as a save would write it (the stored object may differ in shape).
    this.loadedJson = JSON.stringify(Blockly.serialization.workspaces.save(this.ws));
    if (view) this.setView(view);
    this.warnings.clear();
    this.orphanWarned.clear();
    this.applyWarnings(programContext(useProject.getState().project));
    const again = reselect ? (this.ws.getBlockById(reselect) as Blockly.BlockSvg | null) : null;
    if (again) {
      Blockly.common.setSelected(again);
      this.reportSelection(again.id);
    } else {
      this.cb.onSelect(null, []);
    }
  }

  private ensureHats(): void {
    const has = (t: string) => this.ws.getBlocksByType(t, false).length > 0;
    if (!has(BLOCK_TYPES.setup)) {
      Blockly.serialization.blocks.append({ type: BLOCK_TYPES.setup, x: HAT_X, y: HAT_Y }, this.ws, { recordUndo: false });
    }
    if (!has(BLOCK_TYPES.loop)) {
      const setup = this.ws.getBlocksByType(BLOCK_TYPES.setup, false)[0] as Blockly.BlockSvg | undefined;
      const xy = setup?.getRelativeToSurfaceXY();
      const h = setup?.getHeightWidth().height ?? 80;
      Blockly.serialization.blocks.append({ type: BLOCK_TYPES.loop, x: xy?.x ?? HAT_X, y: (xy?.y ?? HAT_Y) + h + 48 }, this.ws, { recordUndo: false });
    }
  }

  /* ------------------------------ ws → store ------------------------------ */

  private onChange = (e: Blockly.Events.Abstract): void => {
    if (this.disposed) return;
    if (e.type === Blockly.Events.SELECTED) {
      this.reportSelection((e as Blockly.Events.Selected).newElementId ?? null);
      return;
    }
    if (e.isUiEvent) return;
    // Late events about blocks that are gone (e.g. Blockly disabling an orphan that an undo
    // already removed) are not edits.
    const blockId = (e as { blockId?: string }).blockId;
    if (blockId && e.type !== Blockly.Events.BLOCK_DELETE && !this.ws.getBlockById(blockId)) return;
    const kind = editKind(e);
    const prev = this.pendingKind;
    this.pendingKind = prev === null || (typeof prev === 'object' && typeof kind === 'object' && prev.field === kind.field) ? kind : 'other';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(this.onSaveTimer, SAVE_DEBOUNCE_MS);
    clearTimeout(this.warnTimer);
    this.warnTimer = setTimeout(() => this.applyWarnings(programContext(useProject.getState().project)), 120);
    if (e.type === Blockly.Events.BLOCK_DELETE) this.reportSelection(null);
  };

  /**
   * A drag fires real (non-UI) events when it starts (unplug, create from the toolbox): saving
   * then would store the block mid-air and split one drag into two undo steps. Wait for the drop.
   */
  private onSaveTimer = (): void => {
    if (!this.disposed && this.ws.isDragging()) {
      this.saveTimer = setTimeout(this.onSaveTimer, SAVE_DEBOUNCE_MS);
      return;
    }
    this.save();
  };

  private save(): void {
    this.saveTimer = undefined;
    const kind = this.pendingKind;
    this.pendingKind = null;
    if (this.disposed) return;
    const json = Blockly.serialization.workspaces.save(this.ws);
    const text = JSON.stringify(json);
    // Nothing changed (a drag cancelled back onto the toolbox, a late disable event): an empty
    // history entry would only wipe the redo stack.
    if (text === this.loadedJson) return;
    this.loaded = json;
    this.loadedJson = text;
    useProject.getState().dispatch(
      { op: 'program.set', workspace: json },
      { label: 'Editar programa', mergeKey: kind && typeof kind === 'object' ? `blockly-field:${kind.field}` : undefined },
    );
  }

  /** Write pending edits now (view unmount, before an undo/redo or an outside change). */
  flush(): void {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.save();
    }
  }

  private reportSelection(id: string | null): void {
    const block = id ? this.ws.getBlockById(id) : null;
    if (!block) {
      this.cb.onSelect(null, []);
      return;
    }
    // The block and everything nested in it (inputs, C-shaped bodies) — not the blocks that follow it.
    const ids = [block.id];
    for (const input of block.inputList) {
      const child = input.connection?.targetBlock();
      if (child) for (const d of child.getDescendants(false)) ids.push(d.id);
    }
    // A value block (sensor, comparison, number…) generates no line of its own: show the
    // statement that contains it.
    if (block.outputConnection) {
      let owner: Blockly.Block | null = block.getParent();
      while (owner?.outputConnection) owner = owner.getParent();
      if (owner) ids.push(owner.id);
    }
    this.cb.onSelect(block.id, ids);
  }

  /* ------------------------------ decorations ----------------------------- */

  private applyWarnings(ctx: ProgramContext): void {
    if (this.disposed) return;
    const next = computeBlockWarnings(this.ws.getAllBlocks(false), ctx);
    for (const [id, text] of next) {
      if (this.warnings.get(id) === text) continue;
      const block = this.ws.getBlockById(id) as Blockly.BlockSvg | null;
      if (!block || block.isInFlyout) continue;
      block.setWarningText(text, HW_WARNING_ID);
    }
    this.warnings = next;

    // Loose stacks/values (greyed out by disableOrphans) say why on the block itself.
    const orphans = new Set<string>();
    for (const top of this.ws.getTopBlocks(false)) {
      if (top.isInFlyout || top.type === BLOCK_TYPES.setup || top.type === BLOCK_TYPES.loop) continue;
      if (top.previousConnection || top.outputConnection) orphans.add(top.id);
    }
    for (const id of this.orphanWarned) {
      if (orphans.has(id)) continue;
      (this.ws.getBlockById(id) as Blockly.BlockSvg | null)?.setWarningText(null, ORPHAN_WARNING_ID);
    }
    for (const id of orphans) {
      if (this.orphanWarned.has(id)) continue;
      (this.ws.getBlockById(id) as Blockly.BlockSvg | null)?.setWarningText(ORPHAN_WARNING, ORPHAN_WARNING_ID);
    }
    this.orphanWarned = orphans;
  }

  /** Highlight the block the simulator is running (null clears). */
  highlight(blockId: string | null): void {
    if (this.disposed) return;
    try {
      this.ws.highlightBlock(blockId && this.ws.getBlockById(blockId) ? blockId : null);
    } catch {
      /* block disappeared mid-run */
    }
  }

  /** Select + scroll to a block. Returns false when it does not exist. */
  focusBlock(blockId: string): boolean {
    if (this.disposed) return false;
    const block = this.ws.getBlockById(blockId) as Blockly.BlockSvg | null;
    if (!block) return false;
    let root: Blockly.BlockSvg | null = block;
    while (root) {
      if (root.isCollapsed()) root.setCollapsed(false);
      root = root.getSurroundParent();
    }
    this.ws.centerOnBlock(blockId);
    Blockly.common.setSelected(block);
    this.reportSelection(blockId);
    const svg = block.getSvgRoot();
    svg.classList.remove('sw-pulse');
    void svg.getBoundingClientRect();
    svg.classList.add('sw-pulse');
    setTimeout(() => svg.classList.remove('sw-pulse'), 1400);
    return true;
  }

  resize(): void {
    if (!this.disposed) Blockly.svgResize(this.ws);
  }
}
