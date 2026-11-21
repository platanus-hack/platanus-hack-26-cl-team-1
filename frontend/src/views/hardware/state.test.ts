/**
 * Hardware view reactions to project loads + edit transactions as undo steps.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createStarterProject } from '@/store/newProject';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { useHW } from './state';
import { deleteSelection, duplicateSelection, rotateSelection } from './actions';
import { part, project, unoAndBreadboard } from './logic/fixtures';

beforeEach(() => {
  useProject.getState().replaceProject(createStarterProject('uno'));
  useUI.getState().clearSelection();
});

describe('fit + gesture reset on project load', () => {
  it('fits once per load, also when the load keeps the project id', () => {
    const p = createStarterProject('uno');
    const f0 = useHW.getState().fitRequest;
    useProject.getState().dispatch({ op: 'project.load', project: p });
    expect(useHW.getState().fitRequest).toBe(f0 + 1);
    useProject.getState().dispatch({ op: 'project.load', project: { ...p } }, { label: 'Importar proyecto' });
    expect(useHW.getState().fitRequest).toBe(f0 + 2);
  });

  it('later ops merged into the same agent turn as a load do not re-fit or drop the user selection', () => {
    const p = createStarterProject('uno');
    useProject.getState().dispatch({ op: 'project.load', project: p }, { group: 'turn-7', source: 'agent' });
    const f1 = useHW.getState().fitRequest;
    useUI.getState().select({ parts: ['bb1'] });
    useHW.getState().set({ dragging: true });
    useProject.getState().dispatch({ op: 'project.rename', name: 'Semáforo 2' }, { group: 'turn-7', source: 'agent' });
    useProject
      .getState()
      .dispatch({ op: 'part.add', part: { id: 'led9', type: 'led', label: 'LED 9', x: 50, y: 6, rotation: 0, props: {} } }, { group: 'turn-7', source: 'agent' });
    expect(useHW.getState().fitRequest).toBe(f1);
    expect(useUI.getState().selection.parts).toEqual(['bb1']);
    expect(useHW.getState().dragging).toBe(true);
    useHW.getState().set({ dragging: false });
  });
});

describe('edit actions are single, atomic undo steps', () => {
  const base = () =>
    project(
      [...unoAndBreadboard(), part('led1', 'led', 45, 6), part('r1', 'resistor', 46, 9)],
      [
        { id: 'w1', from: 'uno1.D13', to: 'led1.anode', color: 'yellow' },
        { id: 'w2', from: 'led1.cathode', to: 'r1.a', color: 'green' },
        { id: 'w3', from: 'r1.b', to: 'uno1.GND1', color: 'black' },
      ],
    );

  it('deleting a part together with one of its wires (and a cascaded one) is one step, undone exactly', () => {
    const p = base();
    useProject.getState().replaceProject(p);
    useUI.getState().select({ parts: ['led1'], wires: ['w1', 'w3'] });
    deleteSelection();
    const after = useProject.getState();
    expect(after.past).toHaveLength(1);
    expect(after.project.parts.map((x) => x.id)).toEqual(['uno1', 'bb1', 'r1']);
    expect(after.project.wires).toEqual([]);
    useProject.getState().undo();
    expect(useProject.getState().project.parts).toEqual(p.parts);
    expect(useProject.getState().project.wires).toEqual(p.wires);
  });

  it('rotate and duplicate of a multi-selection are one step each', () => {
    useProject.getState().replaceProject(base());
    useUI.getState().select({ parts: ['led1', 'r1'], wires: ['w2'] });
    rotateSelection();
    expect(useProject.getState().past).toHaveLength(1);
    duplicateSelection();
    expect(useProject.getState().past).toHaveLength(2);
    const s = useProject.getState().project;
    expect(s.parts).toHaveLength(6);
    expect(s.wires).toHaveLength(4); // w2 copied between the copies
    useProject.getState().undo();
    useProject.getState().undo();
    expect(useProject.getState().project.parts).toEqual(base().parts);
    expect(useProject.getState().project.wires).toEqual(base().wires);
  });
});
