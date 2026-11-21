import type { BoardId } from '@/contracts';
import { findPartDef, getBoardProfile } from '@/catalog';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { PartInspector } from './PartInspector';
import { BoardInspector } from './BoardInspector';
import { WireInspector } from './WireInspector';
import { MultiInspector, ProjectOverview } from './Overview';
import './inspector.css';

function safeProfile(board: BoardId) {
  try {
    return getBoardProfile(board);
  } catch {
    return null;
  }
}

function InspectorBody() {
  const project = useProject((s) => s.project);
  const sel = useUI((s) => s.selection);
  const parts = sel.parts.filter((id) => project.parts.some((p) => p.id === id));
  const wires = sel.wires.filter((id) => project.wires.some((w) => w.id === id));
  if (parts.length + wires.length === 0) return <ProjectOverview />;
  if (parts.length === 1 && wires.length === 0) {
    const part = project.parts.find((p) => p.id === parts[0])!;
    const def = findPartDef(part.type);
    if (!def) return <ProjectOverview />;
    if (def.electrical.model === 'mcu') {
      const profile = safeProfile(def.electrical.board);
      if (profile) return <BoardInspector key={part.id} part={part} def={def} profile={profile} />;
    }
    return <PartInspector key={part.id} part={part} def={def} />;
  }
  if (wires.length === 1 && parts.length === 0) {
    const wire = project.wires.find((w) => w.id === wires[0])!;
    return <WireInspector key={wire.id} wire={wire} />;
  }
  return <MultiInspector parts={parts} wires={wires} />;
}

export function Inspector() {
  return (
    <div className="ins-scroll">
      <InspectorBody />
    </div>
  );
}
