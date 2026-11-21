import { describe, expect, it } from 'vitest';
import type { CheckIssue } from '@/contracts';
import { allPartDefs, getPartDef } from '@/catalog';
import { filterDefs } from './search';
import { issueCounts, issuesSignature, sortIssues } from './issues';
import { describePin, effectiveProp, holeLabel, interactiveKey, partLayer, safeProjectBounds } from './partInfo';
import { part, project, unoAndBreadboard } from './fixtures';

describe('filterDefs', () => {
  const defs = allPartDefs();
  it('returns everything for an empty query', () => {
    expect(filterDefs(defs, '  ')).toHaveLength(defs.length);
  });
  it('is accent- and case-insensitive and matches categories', () => {
    expect(filterDefs(defs, 'bateria').map((d) => d.type)).toContain('battery-9v');
    expect(filterDefs(defs, 'PLACAS').map((d) => d.type)).toEqual(expect.arrayContaining(['arduino-uno', 'esp32c6-devkit']));
  });
  it('requires every term', () => {
    const types = filterDefs(defs, 'led rgb').map((d) => d.type);
    expect(types).toContain('led-rgb');
    expect(types).not.toContain('led');
    expect(filterDefs(defs, 'zzzz')).toEqual([]);
  });
});

describe('issues helpers', () => {
  const mk = (id: string, severity: CheckIssue['severity']): CheckIssue => ({ id, code: 'unconnected-part', severity, title: id, message: id, parts: [] });
  it('sorts by severity, stable', () => {
    const list = [mk('a', 'info'), mk('b', 'warning'), mk('c', 'error'), mk('d', 'warning')];
    expect(sortIssues(list).map((i) => i.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(issueCounts(list)).toEqual({ errors: 1, warnings: 2 });
  });
  it('signature changes only with content', () => {
    expect(issuesSignature([mk('a', 'info')])).toBe(issuesSignature([mk('a', 'info')]));
    expect(issuesSignature([mk('a', 'info')])).not.toBe(issuesSignature([mk('a', 'error')]));
  });
});

describe('partInfo', () => {
  it('derives interactive prop keys from the electrical model', () => {
    expect(interactiveKey(getPartDef('button'))).toBe('pressed');
    expect(interactiveKey(getPartDef('switch-slide'))).toBe('position');
    expect(interactiveKey(getPartDef('potentiometer'))).toBe('position');
    expect(interactiveKey(getPartDef('ldr'))).toBe('light');
  });

  it('effectiveProp: runtime → instance → default', () => {
    const def = getPartDef('potentiometer');
    const inst = part('pot1', 'potentiometer', 0, 0, { props: { position: 20 } });
    expect(effectiveProp(inst, def, undefined, 'position')).toBe(20);
    expect(effectiveProp(inst, def, { position: 70 }, 'position')).toBe(70);
    expect(effectiveProp(part('pot2', 'potentiometer'), def, undefined, 'position')).toBe(50);
  });

  it('orders z layers breadboard < board < component', () => {
    expect(partLayer(getPartDef('breadboard-half'))).toBe(0);
    expect(partLayer(getPartDef('arduino-uno'))).toBe(1);
    expect(partLayer(getPartDef('led'))).toBe(2);
  });

  it('describes pins with friendly labels', () => {
    const p = project([...unoAndBreadboard(), part('led1', 'led', 45, 6)]);
    expect(describePin(p, 'led1.anode')).toMatchObject({ partLabel: 'LED1', pinLabel: 'Ánodo (+)' });
    expect(describePin(p, 'bb1.e10').pinLabel).toBe('e10');
    expect(holeLabel('T-3')).toBe('Riel − sup. 3');
    expect(describePin(p, 'zz.top')).toMatchObject({ partLabel: 'zz', pinLabel: 'top' });
  });

  it('project bounds ignore unknown part types and handle empty projects', () => {
    const p = project([part('x1', 'does-not-exist', 500, 500), part('led1', 'led', 0, 0)]);
    const b = safeProjectBounds(p, 0);
    expect(b).toEqual({ x: -0.5, y: 0, w: 2, h: 3 });
    expect(safeProjectBounds(project([])).w).toBeGreaterThan(0);
  });
});
