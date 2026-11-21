/**
 * Owns the injected Blockly workspace and keeps it in sync with the project
 * store (kept outside React so store updates never re-render the editor).
 *
 * Sync rules
 *  - Blockly change events (UI events ignored) → debounce 300 ms → dispatch
 *    program.set {label 'Editar programa', mergeKey 'blockly'}; the emitted
 *    object is remembered.
 *  - project.program.workspace changes to an object the editor does not
 *    reflect (agent, undo, example load) → reload with events disabled and
 *    clear Blockly's undo stack.
 *  - Parts/board changes → rebuild the toolbox, refresh dynamic dropdowns,
 *    recompute block warnings (unbound parts, missing pins).
 *  - A fresh workspace always gets the "al iniciar" / "repetir para siempre" hats.
 */
import * as Blockly from 'blockly';
import type { ProjectModel } from '@/contracts';
import { useProject } from '@/store/project';
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

export interface EditorCallbacks {
  onSelect: (blockId: string | null, ids: string[]) => void;
}

/** Blockly media: served locally in dev (Vite serves node_modules), CDN otherwise. */
const MEDIA = '/blockly-media/';

function hardwareKey(project: ProjectModel, ctx: ProgramContext): string {
  const parts = project.parts.map((p) => `${p.id}:${p.type}:${p.label}`).join('|');
  const bindings = ctx.bindings.map((b) => `${b.part}.${b.channel ?? ''}=${b.boardPin ?? '-'}`).join('|');
  return `${ctx.board?.id ?? 'none'}#${parts}#${bindings}`;
}

export class EditorController {
  readonly ws: Blockly.WorkspaceSvg;
  /** The serialized workspace object the editor currently reflects. */
  private loaded: unknown = undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private warnTimer: ReturnType<typeof setTimeout> | undefined;
  private toolboxKey = '';
  private hwKey = '';
  private warnings = new Map<string, string | null>();
  private unsubscribe: () => void;
  private disposed = false;

  constructor(host: HTMLElement, private readonly cb: EditorCallbacks) {
    registerBlocks();
    registerToolboxCategory();
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
      zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.35, scaleSpeed: 1.12, pinch: true },
      move: { scrollbars: true, drag: true, wheel: false },
    });
    registerToolboxCallbacks(this.ws);

    this.loadExternal(project.program.workspace);
    this.hwKey = hardwareKey(project, ctx);
    this.applyWarnings(ctx);
    this.ws.addChangeListener(this.onChange);
    // Blocks outside "al iniciar" / "repetir para siempre" are greyed out: they never run.
    this.ws.addChangeListener(Blockly.Events.disableOrphans);
    this.unsubscribe = useProject.subscribe((s, prev) => {
      if (s.project !== prev.project) this.syncProject(s.project);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    clearTimeout(this.warnTimer);
    this.unsubscribe();
    this.ws.removeChangeListener(this.onChange);
    this.ws.dispose();
  }

  /* ------------------------------ store → ws ------------------------------ */

  private syncProject(project: ProjectModel): void {
    if (this.disposed) return;
    if (project.program.workspace !== this.loaded) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.loadExternal(project.program.workspace);
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
  private loadExternal(state: unknown): void {
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
    this.cb.onSelect(null, []);
    this.warnings.clear();
    this.applyWarnings(programContext(useProject.getState().project));
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
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DEBOUNCE_MS);
    clearTimeout(this.warnTimer);
    this.warnTimer = setTimeout(() => this.applyWarnings(programContext(useProject.getState().project)), 120);
    if (e.type === Blockly.Events.BLOCK_DELETE) this.reportSelection(null);
  };

  private save(): void {
    this.saveTimer = undefined;
    if (this.disposed) return;
    const json = Blockly.serialization.workspaces.save(this.ws);
    this.loaded = json;
    useProject.getState().dispatch({ op: 'program.set', workspace: json }, { label: 'Editar programa', mergeKey: 'blockly' });
  }

  /** Write pending edits now (view unmount). */
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
      block.setWarningText(text);
    }
    this.warnings = next;
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
