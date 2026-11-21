import { describe, expect, it } from 'vitest';
import type { PartDef } from '@/contracts';
import { BB_RAILS, BB_ROW_Y, getPartDef } from '@/catalog';
import { boardPinViews, findBoardProfile, unoSilkLabel } from './board-data';
import { BB_HOLE, breadboardPaths, columnLabels, railMarks, rowLabels } from './breadboard-geo';

describe('boardPinViews', () => {
  it('takes positions from def.pins and silkscreen/caps from the Uno profile', () => {
    const def = getPartDef('arduino-uno');
    const views = boardPinViews(def);
    expect(views).toHaveLength(def.pins.length);
    for (const v of views) {
      const pin = def.pins.find((p) => p.id === v.id)!;
      expect([v.x, v.y]).toEqual([pin.x, pin.y]);
    }
    const byId = Object.fromEntries(views.map((v) => [v.id, v]));
    expect(unoSilkLabel(byId.D11)).toBe('~11');
    expect(unoSilkLabel(byId.D13)).toBe('13');
    expect(unoSilkLabel(byId.A0)).toBe('A0');
    expect(unoSilkLabel(byId.NC)).toBe(''); // unlabeled on the real board
    expect(byId.D1.label).toBe('TX→1');
    expect(views.filter((v) => v.pwm).map((v) => v.id).sort()).toEqual(['D10', 'D11', 'D3', 'D5', 'D6', 'D9']);
  });

  it('is memoized per def object', () => {
    const def = getPartDef('esp32c6-devkit');
    expect(boardPinViews(def)).toBe(boardPinViews(def));
  });

  it('ESP32-C6: pin 1 (3V3) is on the right end of J1', () => {
    const views = boardPinViews(getPartDef('esp32c6-devkit'));
    const j1 = views.filter((v) => v.header === 'J1');
    expect(Math.max(...j1.map((v) => v.x))).toBe(j1.find((v) => v.id === '3V3')!.x);
  });

  it('never throws for a def without a profile', () => {
    const fake: PartDef = { ...getPartDef('arduino-uno'), board: undefined, pins: [{ id: 'X', label: 'X', x: 1, y: 1, kind: 'gpio' }] };
    expect(findBoardProfile(fake)).toBeUndefined();
    expect(boardPinViews(fake)).toEqual([{ id: 'X', x: 1, y: 1, label: 'X', header: '', kind: 'unknown', pwm: false }]);
  });
});

describe('breadboard geometry', () => {
  const def = getPartDef('breadboard-half');

  it('builds one sub-path per hole (400), centred on the exact hole coordinates', () => {
    const paths = breadboardPaths(def.pins);
    expect(paths.count).toBe(400);
    const starts = [...paths.holes.matchAll(/M(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(starts).toHaveLength(400);
    // rounded square: starts at (x - size/2 + r, y - size/2)
    def.pins.forEach((p, i) => {
      expect(starts[i][0]).toBeCloseTo(p.x - BB_HOLE / 2 + 0.06, 3);
      expect(starts[i][1]).toBeCloseTo(p.y - BB_HOLE / 2, 3);
    });
  });

  it('caches per pins array', () => {
    expect(breadboardPaths(def.pins)).toBe(breadboardPaths(def.pins));
  });

  it('labels columns 1,5..30 on both sides and rows a–j on both sides', () => {
    expect(columnLabels().map((l) => l.text)).toEqual(['1', '1', '5', '5', '10', '10', '15', '15', '20', '20', '25', '25', '30', '30']);
    expect(rowLabels()).toHaveLength(Object.keys(BB_ROW_Y).length * 2);
  });

  it('puts the red line above each + rail and the blue line below each − rail', () => {
    const marks = railMarks();
    expect(marks).toHaveLength(BB_RAILS.length);
    for (const m of marks) {
      if (m.polarity === '+') expect(m.lineY).toBeLessThan(m.y);
      else expect(m.lineY).toBeGreaterThan(m.y);
    }
  });
});
