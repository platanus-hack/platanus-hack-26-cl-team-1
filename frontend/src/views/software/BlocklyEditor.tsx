import { useEffect, useRef, useState } from 'react';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { EditorController } from './editorController';
import { setFocusHandler, useSoftwareView } from './state';

/** Blockly workspace host: injected once, resized with a ResizeObserver. */
export function BlocklyEditor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EditorController | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let controller: EditorController;
    // Coming back from the Hardware tab: same zoom and place, unless the program changed meanwhile.
    const saved = useSoftwareView.getState().savedView;
    const initialView = saved && saved.workspace === useProject.getState().project.program.workspace ? saved : null;
    try {
      controller = new EditorController(
        host,
        { onSelect: (id, ids) => useSoftwareView.getState().setSelection(id, ids) },
        { initialView },
      );
    } catch (e) {
      console.error(e);
      setFailed(e instanceof Error ? e.message : String(e));
      return;
    }
    controllerRef.current = controller;
    setFocusHandler((id) => controller.focusBlock(id));

    const ro = new ResizeObserver(() => controller.resize());
    ro.observe(host);

    controller.highlight(useSim.getState().activeBlockId);
    const unsubSim = useSim.subscribe((s, prev) => {
      if (s.activeBlockId !== prev.activeBlockId) controller.highlight(s.activeBlockId);
    });

    return () => {
      unsubSim();
      ro.disconnect();
      setFocusHandler(null);
      useSoftwareView.getState().setSelection(null, []);
      controller.flush();
      const { scale, scrollX, scrollY } = controller.getView();
      useSoftwareView.setState({ savedView: { scale, scrollX, scrollY, workspace: useProject.getState().project.program.workspace } });
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  return (
    <div className="sw-editor">
      <div ref={hostRef} className="sw-blockly blocklyDiv" />
      {failed && (
        <div className="sw-editor-error">
          <strong>No se pudo iniciar el editor de bloques.</strong>
          <span>{failed}</span>
        </div>
      )}
    </div>
  );
}
