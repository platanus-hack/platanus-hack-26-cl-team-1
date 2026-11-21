import { useEffect } from 'react';
import { TopBar } from './TopBar';
import { Toasts } from './Toasts';
import { useUI } from '@/store/ui';
import { useProject } from '@/store/project';
import { HardwareView } from '@/views/hardware/HardwareView';
import { SoftwareView } from '@/views/software/SoftwareView';
import { SimPanel } from '@/views/sim/SimPanel';
import { AgentPanel } from '@/agent/AgentPanel';
import { simRuntime } from '@/sim/runtime';
import { registerBlocks } from '@/program/blocks';
import { useAssembly } from '@/assembly/store';
import { AssemblyView } from '@/views/assembly/AssemblyView';
import './app.css';

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!el.closest?.('.blocklyDiv, .blocklyWidgetDiv, .cm-editor');
}

export function App() {
  const view = useUI((s) => s.view);
  const agentOpen = useUI((s) => s.panels.agent);
  const simOpen = useUI((s) => s.panels.sim);
  const assemblyOpen = useAssembly((s) => s.open);

  useEffect(() => {
    registerBlocks();
    simRuntime.init();
  }, []);

  // Global undo/redo (the block editor keeps its own undo stack).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useProject.getState().undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        useProject.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (assemblyOpen) {
    return (
      <div className="app">
        <TopBar />
        <main className="app-main">
          <AssemblyView />
        </main>
        <Toasts />
      </div>
    );
  }

  return (
    <div className={`app ${agentOpen ? 'with-agent' : ''}`}>
      <TopBar />
      <main className="app-main">
        <section className="app-center">
          <div className="app-view">{view === 'hardware' ? <HardwareView /> : <SoftwareView />}</div>
          {simOpen && (
            <div className="app-dock">
              <SimPanel />
            </div>
          )}
        </section>
        {agentOpen && (
          <aside className="app-agent">
            <AgentPanel />
          </aside>
        )}
      </main>
      <Toasts />
    </div>
  );
}
