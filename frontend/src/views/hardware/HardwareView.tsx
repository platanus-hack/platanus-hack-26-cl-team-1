/**
 * Hardware workspace — palette · canvas (or schematic) · inspector, with the
 * checks and wiring-guide drawers. Owned by workstream A3.
 */
import { ListOrdered, ShieldCheck } from 'lucide-react';
import { useUI } from '@/store/ui';
import { SchematicView } from '@/views/schematic/SchematicView';
import { WiringGuidePanel } from '@/guide/WiringGuidePanel';
import { useHW } from './state';
import { Palette, PaletteDragLayer } from './palette/Palette';
import { Canvas } from './canvas/Canvas';
import { CanvasToolbar, LiveStatus, ModeToolbar, ZoomControls } from './canvas/Toolbar';
import { Inspector } from './inspector/Inspector';
import { ChecksPanel, IssuesBridge } from './panels/ChecksPanel';
import { Drawer } from './panels/Drawer';
import './hardware.css';
import './panels/panels.css';

function RightColumn() {
  const checks = useUI((s) => s.panels.checks);
  const guide = useUI((s) => s.panels.guide);
  const close = (p: 'checks' | 'guide') => useUI.getState().togglePanel(p, false);
  return (
    <aside className="hw-right" aria-label="Inspector">
      <Inspector />
      {checks && (
        <Drawer title="Revisión del circuito" icon={<ShieldCheck size={15} />} onClose={() => close('checks')}>
          <ChecksPanel />
        </Drawer>
      )}
      {guide && !checks && (
        <Drawer title="Guía de armado" icon={<ListOrdered size={15} />} onClose={() => close('guide')}>
          <WiringGuidePanel />
        </Drawer>
      )}
    </aside>
  );
}

function Center() {
  const mode = useUI((s) => s.hardwareMode);
  return (
    <section className="hw-center">
      {mode === 'board' ? (
        <>
          <Canvas />
          <CanvasToolbar />
          <ZoomControls />
          <LiveStatus />
        </>
      ) : (
        <div className="hw-schematic">
          <SchematicView />
        </div>
      )}
      <ModeToolbar />
    </section>
  );
}

export function HardwareView() {
  const collapsed = useHW((s) => s.paletteCollapsed);
  return (
    <div className={`hw-root${collapsed ? ' is-palette-collapsed' : ''}`}>
      <IssuesBridge />
      <Palette />
      <Center />
      <RightColumn />
      <PaletteDragLayer />
    </div>
  );
}
