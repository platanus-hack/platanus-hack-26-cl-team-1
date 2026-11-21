import { useRef, useState } from 'react';
import {
  Bot, Cpu, Download, FilePlus2, FolderOpen, Library, Pause, Play, Redo2, ScanEye, Square, Undo2, Upload, Workflow,
} from 'lucide-react';
import { useAssembly } from '@/assembly/store';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { useSim } from '@/store/sim';
import { simRuntime } from '@/sim/runtime';
import { EXAMPLES, buildExample } from '@/examples';
import { createStarterProject } from '@/store/newProject';
import type { ProjectModel } from '@/contracts';

function Logo() {
  return (
    <div className="logo">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#131820" stroke="#2f3a47" />
        <path d="M5 19h6l3-8 4 12 3-8h6" fill="none" stroke="#3DDC97" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Circuito <b>Vivo</b></span>
    </div>
  );
}

function Menu({ label, icon, children }: { label: string; icon: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu" onMouseLeave={() => setOpen(false)}>
      <button className="btn ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {icon}
        {label}
      </button>
      {open && <div className="menu-pop">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function TopBar() {
  const name = useProject((s) => s.project.name);
  const dispatch = useProject((s) => s.dispatch);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);
  const past = useProject((s) => s.past);
  const future = useProject((s) => s.future);
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const agentOpen = useUI((s) => s.panels.agent);
  const togglePanel = useUI((s) => s.togglePanel);
  const toast = useUI((s) => s.toast);
  const program = useSim((s) => s.program);
  const assemblyOpen = useAssembly((s) => s.open);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (p: ProjectModel, label: string) => {
    simRuntime.stopProgram();
    dispatch({ op: 'project.load', project: p }, { label });
  };

  const exportJson = () => {
    const p = useProject.getState().project;
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.name.replace(/[^\w-]+/g, '_') || 'circuito'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const p = JSON.parse(await file.text()) as ProjectModel;
      if (p.version !== 1 || !Array.isArray(p.parts) || !Array.isArray(p.wires)) throw new Error('formato');
      load(p, 'Importar proyecto');
      toast(`Proyecto "${p.name}" importado`, 'success');
    } catch {
      toast('El archivo no es un proyecto válido', 'error');
    }
  };

  const lastUndo = past[past.length - 1]?.label;
  const nextRedo = future[0]?.label;

  return (
    <header className="topbar">
      <Logo />
      <input
        className="project-name"
        value={name}
        onChange={(e) => dispatch({ op: 'project.rename', name: e.target.value }, { mergeKey: 'rename', label: 'Renombrar proyecto' })}
        aria-label="Nombre del proyecto"
      />
      <div className="topbar-group">
        <Menu label="Ejemplos" icon={<Library size={16} />}>
          {(close) => (
            <>
              {EXAMPLES.map((ex) => (
                <button key={ex.id} className="menu-item" onClick={() => { load(buildExample(ex.id), `Ejemplo: ${ex.name}`); close(); }}>
                  <span className="menu-item-title">{ex.name}</span>
                  <span className="menu-item-sub">{ex.description}</span>
                </button>
              ))}
            </>
          )}
        </Menu>
        <Menu label="Archivo" icon={<FolderOpen size={16} />}>
          {(close) => (
            <>
              <button className="menu-item" onClick={() => { load(createStarterProject('uno'), 'Nuevo proyecto'); close(); }}>
                <span className="menu-item-title"><FilePlus2 size={14} /> Nuevo con Arduino Uno</span>
              </button>
              <button className="menu-item" onClick={() => { load(createStarterProject('esp32c6'), 'Nuevo proyecto'); close(); }}>
                <span className="menu-item-title"><FilePlus2 size={14} /> Nuevo con ESP32-C6</span>
              </button>
              <button className="menu-item" onClick={() => { load(createStarterProject(null), 'Nuevo proyecto'); close(); }}>
                <span className="menu-item-title"><FilePlus2 size={14} /> Nuevo solo con protoboard</span>
              </button>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => { exportJson(); close(); }}>
                <span className="menu-item-title"><Download size={14} /> Exportar (.json)</span>
              </button>
              <button className="menu-item" onClick={() => { fileRef.current?.click(); close(); }}>
                <span className="menu-item-title"><Upload size={14} /> Importar…</span>
              </button>
            </>
          )}
        </Menu>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }} />
      </div>

      <div className="topbar-center">
        <div className="segmented" role="tablist" aria-label="Vista">
          <button role="tab" className={view === 'hardware' ? 'active' : ''} onClick={() => setView('hardware')}>
            <Cpu size={15} /> Hardware
          </button>
          <button role="tab" className={view === 'software' ? 'active' : ''} onClick={() => setView('software')}>
            <Workflow size={15} /> Software
          </button>
        </div>
      </div>

      <div className="topbar-group right">
        <button className="btn icon ghost" onClick={undo} disabled={!past.length} title={lastUndo ? `Deshacer: ${lastUndo} (⌘Z)` : 'Deshacer (⌘Z)'}>
          <Undo2 size={16} />
        </button>
        <button className="btn icon ghost" onClick={redo} disabled={!future.length} title={nextRedo ? `Rehacer: ${nextRedo} (⇧⌘Z)` : 'Rehacer (⇧⌘Z)'}>
          <Redo2 size={16} />
        </button>
        <div className="divider" />
        {program === 'running' ? (
          <button className="btn" onClick={() => simRuntime.pauseProgram()} title="Pausar programa">
            <Pause size={15} /> Pausar
          </button>
        ) : (
          <button className="btn primary" onClick={() => simRuntime.startProgram()} title="Ejecutar el programa en la simulación">
            <Play size={15} /> {program === 'paused' ? 'Continuar' : 'Ejecutar'}
          </button>
        )}
        <button className="btn icon" onClick={() => simRuntime.stopProgram()} disabled={program === 'stopped'} title="Detener programa">
          <Square size={14} />
        </button>
        <div className="divider" />
        <button
          className={`btn ${assemblyOpen ? 'active-toggle' : ''}`}
          onClick={() => useAssembly.getState().setOpen(!assemblyOpen)}
          title="Arma el circuito real con la cámara: el agente revisa cada paso y te avisa si algo quedó mal"
        >
          <ScanEye size={16} /> Modo Armado
        </button>
        <button className={`btn ${agentOpen ? 'active-toggle' : ''}`} onClick={() => togglePanel('agent')} title="Asistente con IA">
          <Bot size={16} /> Asistente
        </button>
      </div>
    </header>
  );
}
