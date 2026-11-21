import { describe, expect, it } from 'vitest';
import type { SimTimeline } from '@/contracts';
import { MAX_CHANGES, MAX_SERIAL_LINES, quantizeState, summarizeTimeline } from './simSummary';

const base: SimTimeline = { durationMs: 2000, changes: [], serial: [], issues: [] };

describe('summarizeTimeline', () => {
  it('keeps a blink faithfully and drops invisible fields', () => {
    const tl: SimTimeline = {
      ...base,
      changes: [
        { t: 0, part: 'led1', state: { brightness: 0, currentA: 0, voltage: 0 } },
        { t: 0, part: 'r1', state: { currentA: 0, voltage: 0 } },
        { t: 500, part: 'led1', state: { brightness: 0.9871, currentA: 0.0131 } },
        { t: 1000, part: 'led1', state: { brightness: 0, currentA: 0 } },
        { t: 1500, part: 'led1', state: { brightness: 0.99, currentA: 0.0131 } },
      ],
    };
    const s = summarizeTimeline(tl);
    expect(s.changes).toEqual([
      { t: 0, part: 'led1', state: { brightness: 0 } },
      { t: 500, part: 'led1', state: { brightness: 1 } },
      { t: 1000, part: 'led1', state: { brightness: 0 } },
      { t: 1500, part: 'led1', state: { brightness: 1 } },
    ]);
    expect(s.per_part.led1).toEqual({ min: 0, max: 1, last: { brightness: 1 } });
    expect(s.per_part.r1).toBeUndefined();
    expect(s.truncated).toBe(false);
    expect(s.duration_ms).toBe(2000);
  });

  it('spaces samples of one part ≥ 50 ms and keeps the final state', () => {
    const changes = Array.from({ length: 40 }, (_, i) => ({ t: i * 10, part: 'led1', state: { brightness: i / 40 } }));
    const s = summarizeTimeline({ ...base, durationMs: 400, changes });
    const ts = s.changes.map((c) => c.t);
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(50);
    expect(s.per_part.led1.last.brightness).toBe(quantizeState({ brightness: 39 / 40 }).brightness);
    const lastEmitted = s.changes[s.changes.length - 1].state.brightness;
    expect(lastEmitted).toBe(s.per_part.led1.last.brightness);
  });

  it('quantizes angle, speed and rgb; caps changes and serial lines', () => {
    expect(quantizeState({ angle: 89.6, speed: 0.512, rgb: [0.123, 0.5, 0.98] })).toEqual({ rgb: [0.1, 0.5, 1], speed: 0.5, angle: 90 });
    const changes = Array.from({ length: 600 }, (_, i) => ({ t: i * 60, part: 'servo1', state: { angle: i % 180 } }));
    const serial = Array.from({ length: 150 }, (_, i) => ({ t: i, text: `línea ${i}` }));
    const s = summarizeTimeline({ ...base, durationMs: 40000, changes, serial });
    expect(s.changes.length).toBe(MAX_CHANGES);
    expect(s.serial.length).toBe(MAX_SERIAL_LINES);
    expect(s.truncated).toBe(true);
    expect(s.per_part.servo1).toMatchObject({ min: 0, max: 179 });
  });

  it('passes errors and strips issue nets', () => {
    const s = summarizeTimeline({
      ...base,
      error: 'No hay placa',
      issues: [{ id: 'i', code: 'short-circuit', severity: 'error', title: 'Corto', message: 'm', parts: [], nets: ['n1'] }],
    });
    expect(s.error).toBe('No hay placa');
    expect(s.issues[0]).not.toHaveProperty('nets');
  });
});
