/**
 * WORKSTREAM A — wiring guide generator (owned by the schematic/guide agent).
 * buildWiringGuide(project, netlist) → GuideStep[] in Spanish, ordered like a
 * real build (board, breadboard, parts left → right with exact holes, power
 * wires, signal wires, final check, program). <WiringGuidePanel/> renders it.
 */
export { buildWiringGuide } from './build';
export { resistorBands } from './text';
export { WiringGuidePanel } from './WiringGuidePanel';
