import { describe, expect, it } from 'vitest';
import type { ProjectModel } from '@/contracts';
import { buildNetlist, deriveBindings } from './index';
import { BB, UNO, holePos, makeProject, part, placeBy } from './fixtures';

const bindings = (p: ProjectModel) => deriveBindings(p, buildNetlist(p));
const of = (p: ProjectModel, id: string, channel?: string) => bindings(p).find((b) => b.part === id && b.channel === channel);

describe('deriveBindings', () => {
  it('LED through a 220 Ω resistor to D13', () => {
    const bb = BB();
    const r = placeBy('r1', 'resistor', 'b', holePos(bb, 'c10'), { resistance: 220 }); // a c6
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10'));
    const p = makeProject([UNO(), bb, r, led], [
      ['uno1.D13', 'bb1.a6'],
      ['uno1.GND2', 'bb1.a11'],
    ]);
    expect(of(p, 'led1')).toEqual({
      part: 'led1',
      pin: 'anode',
      boardPin: 'D13',
      codeName: '13',
      activeLow: false,
      mode: 'OUTPUT',
      driver: 'direct',
      via: ['r1'],
    });
  });

  it('sinking LED (anode to +, cathode to the pin) is activeLow', () => {
    const bb = BB();
    const r = placeBy('r1', 'resistor', 'b', holePos(bb, 'c10'));
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10'));
    const p = makeProject([UNO(), bb, r, led], [
      ['uno1.5V', 'bb1.a6'],
      ['uno1.D7', 'bb1.a11'],
    ]);
    expect(of(p, 'led1')).toMatchObject({ pin: 'cathode', boardPin: 'D7', activeLow: true, via: [] });
  });

  it('button between D2 and GND → INPUT_PULLUP, activeLow', () => {
    const bb = BB();
    const btn = placeBy('btn1', 'button', 'a1', holePos(bb, 'e10'));
    const p = makeProject([UNO(), bb, btn], [
      ['uno1.D2', 'bb1.a10'],
      ['uno1.GND1', 'bb1.a12'],
    ]);
    expect(of(p, 'btn1')).toMatchObject({ pin: 'a1', boardPin: 'D2', codeName: '2', mode: 'INPUT_PULLUP', activeLow: true });
  });

  it('button between 5V and D2 (pull-down) → INPUT, active high', () => {
    const bb = BB();
    const btn = placeBy('btn1', 'button', 'a1', holePos(bb, 'e10')); // b1 e12
    const pd = placeBy('r1', 'resistor', 'a', holePos(bb, 'c12'), { resistance: 10000 }); // b c16
    const p = makeProject([UNO(), bb, btn, pd], [
      ['uno1.5V', 'bb1.a10'],
      ['uno1.D2', 'bb1.a12'],
      ['uno1.GND1', 'bb1.a16'],
    ]);
    expect(of(p, 'btn1')).toMatchObject({ pin: 'b1', boardPin: 'D2', mode: 'INPUT', activeLow: false });
  });

  it('motor driven through an NPN: via [q1, r1], driver npn', () => {
    const bb = BB();
    const q = placeBy('q1', 'npn', 'e', holePos(bb, 'e20'));
    const r = placeBy('r1', 'resistor', 'b', holePos(bb, 'd21'), { resistance: 1000 });
    const m = part('m1', 'motor-dc', 80, 0);
    const p = makeProject([UNO(), bb, q, r, m], [
      ['uno1.5V', 'm1.a'],
      ['m1.b', 'bb1.a22'],
      ['uno1.GND2', 'bb1.a20'],
      ['uno1.D9', 'bb1.a17'],
    ]);
    expect(of(p, 'm1')).toMatchObject({ pin: 'b', boardPin: 'D9', via: ['q1', 'r1'], driver: 'npn', mode: 'OUTPUT', activeLow: false });
    expect(of(p, 'q1')).toMatchObject({ pin: 'b', boardPin: 'D9', via: ['r1'] });
  });

  it('potentiometer and LDR: ANALOG with invert', () => {
    const bb = BB();
    const pot = placeBy('pot1', 'potentiometer', 'a', holePos(bb, 'e10')); // wiper e12, b e14
    const ldr = placeBy('ldr1', 'ldr', 'a', holePos(bb, 'e20')); // b e22
    const p = (aTo: string, bTo: string) =>
      makeProject([UNO(), bb, pot, ldr], [
        [aTo, 'bb1.a10'],
        [bTo, 'bb1.a14'],
        ['uno1.A0', 'bb1.a12'],
        ['uno1.A1', 'bb1.a20'],
        ['uno1.GND3', 'bb1.a22'],
      ]);
    expect(of(p('uno1.GND2', 'uno1.5V'), 'pot1')).toMatchObject({ boardPin: 'A0', codeName: 'A0', mode: 'ANALOG', invert: false });
    expect(of(p('uno1.5V', 'uno1.GND2'), 'pot1')).toMatchObject({ invert: true });
    expect(of(p('uno1.5V', 'uno1.GND2'), 'ldr1')).toMatchObject({ pin: 'a', boardPin: 'A1', mode: 'ANALOG', invert: true });
  });

  it('RGB LED: one binding per channel; unconnected channels are null', () => {
    const bb = BB();
    const rgb = placeBy('rgb1', 'led-rgb', 'com', holePos(bb, 'e11'));
    const p = makeProject([UNO(), bb, rgb], [['uno1.D9', 'bb1.a10']]);
    const bs = bindings(p).filter((b) => b.part === 'rgb1');
    expect(bs.map((b) => b.channel)).toEqual(['r', 'g', 'b']);
    expect(bs[0]).toMatchObject({ pin: 'r', boardPin: 'D9' });
    expect(bs[1].boardPin).toBeNull();
  });

  it('aliases resolve to canonical pins (SDA → A4)', () => {
    const led = placeBy('led1', 'led', 'anode', { x: 9, y: 1 }); // SDA socket
    expect(of(makeProject([UNO(), led]), 'led1')).toMatchObject({ boardPin: 'A4', codeName: 'A4' });
  });

  it('unwired parts and projects without a board get null bindings', () => {
    const p = makeProject([BB(), part('led1', 'led', 0, 40), part('btn1', 'button', 10, 40), part('servo1', 'servo-sg90', 20, 40)]);
    const bs = bindings(p);
    expect(bs).toHaveLength(3);
    expect(bs.every((b) => b.boardPin === null && b.codeName === null && b.via.length === 0)).toBe(true);
  });

  it('never routes through supply nets', () => {
    // LED always on (anode to 5V, cathode to GND) next to a 10k pull-up on D2: LED must stay unbound.
    const bb = BB();
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10'));
    const r = placeBy('r1', 'resistor', 'a', holePos(bb, 'c20'), { resistance: 10000 }); // b c24
    const p = makeProject([UNO(), bb, led, r], [
      ['uno1.5V', 'bb1.a10'],
      ['uno1.GND2', 'bb1.a11'],
      ['uno1.5V', 'bb1.a20'],
      ['uno1.D2', 'bb1.a24'],
    ]);
    expect(of(p, 'led1')?.boardPin).toBeNull();
  });
});
