import { describe, expect, it } from 'vitest';
import { TimelineRecorder, partSnapshot } from './timeline';

describe('partSnapshot', () => {
  it('rounds LED brightness to 0.1 and motor speed to 0.1', () => {
    expect(partSnapshot('led', { currentA: 0.01, voltage: 2, brightness: 0.437 })).toEqual({ brightness: 0.4 });
    expect(partSnapshot('motor', { currentA: 0, voltage: 0, speed: -0.04 })).toEqual({ speed: 0 });
  });

  it('records buzzer tone, servo angle, rgb and burned flag', () => {
    expect(partSnapshot('buzzer', { currentA: 0, voltage: 5, sounding: true, toneHz: 440.4 })).toEqual({ sounding: true, toneHz: 440 });
    expect(partSnapshot('buzzer', { currentA: 0, voltage: 5, toneHz: 440 })).toEqual({ sounding: false });
    expect(partSnapshot('servo', { currentA: 0, voltage: 5, angle: 89.6, powered: true })).toEqual({ angle: 90, powered: true });
    expect(partSnapshot('rgb-led', { currentA: 0, voltage: 0, rgb: [1, 0.04, 0.55] })).toEqual({ rgb: [1, 0, 0.6] });
    expect(partSnapshot('led', { currentA: 0, voltage: 0, burned: true })).toEqual({ brightness: 0, burned: true });
  });

  it('ignores parts with nothing observable', () => {
    expect(partSnapshot('resistor', { currentA: 0.01, voltage: 2 })).toBeNull();
    expect(partSnapshot(undefined, { currentA: 0, voltage: 0 })).toBeNull();
  });
});

describe('TimelineRecorder', () => {
  it('records only changes', () => {
    const r = new TimelineRecorder();
    r.observe(0, 'led1', { brightness: 0 });
    r.observe(5, 'led1', { brightness: 0 });
    r.observe(500, 'led1', { brightness: 1 });
    r.observe(505, 'led1', { brightness: 1 });
    r.observe(1000, 'led1', { brightness: 0 });
    expect(r.finish()).toEqual([
      { t: 0, part: 'led1', state: { brightness: 0 } },
      { t: 500, part: 'led1', state: { brightness: 1 } },
      { t: 1000, part: 'led1', state: { brightness: 0 } },
    ]);
  });

  it('collapses same-time flicker (replace, or drop when back to the previous state)', () => {
    const r = new TimelineRecorder();
    r.observe(0, 'led1', { brightness: 0 });
    r.observe(10, 'led1', { brightness: 0.5 });
    r.observe(10, 'led1', { brightness: 1 });
    expect(r.finish()).toEqual([
      { t: 0, part: 'led1', state: { brightness: 0 } },
      { t: 10, part: 'led1', state: { brightness: 1 } },
    ]);
    r.observe(20, 'led1', { brightness: 0 });
    r.observe(20, 'led1', { brightness: 1 });
    expect(r.finish()).toHaveLength(2);
  });

  it('caps the number of changes and appends final states', () => {
    const r = new TimelineRecorder(10);
    for (let i = 0; i < 50; i++) r.observe(i * 100, 'led1', { brightness: i % 2 });
    r.observe(0, 'm1', { speed: 0 }); // late part first seen after the cap
    const out = r.finish();
    expect(r.truncated).toBe(true);
    // 10 capped entries + final state of led1 + m1 (first seen after the cap)
    expect(out.length).toBe(12);
    expect(out[out.length - 1]).toEqual({ t: 4900, part: 'led1', state: { brightness: 1 } });
    expect(out.find((e) => e.part === 'm1')).toEqual({ t: 0, part: 'm1', state: { speed: 0 } });
    const times = out.map((e) => e.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
