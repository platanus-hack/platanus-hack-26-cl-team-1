import { describe, expect, it } from 'vitest';
import { FrameGate } from './frameGate';

describe('FrameGate', () => {
  it('captures only when the camera presented a new frame', () => {
    const gate = new FrameGate(3000, 0);
    gate.markFrame(100);
    expect(gate.take(150)).toBe('capture');
    expect(gate.take(300)).toBe('skip'); // same frame: don't resend it
    gate.markFrame(320);
    expect(gate.take(330)).toBe('capture');
  });

  it('reports a stall once no new frame arrived for the limit', () => {
    const gate = new FrameGate(3000, 0);
    gate.markFrame(100);
    expect(gate.take(150)).toBe('capture');
    expect(gate.take(3099)).toBe('skip');
    expect(gate.take(3100)).toBe('stalled');
  });

  it('counts the stall from the start when no frame ever arrived', () => {
    const gate = new FrameGate(3000, 1000);
    expect(gate.take(3999)).toBe('skip');
    expect(gate.take(4000)).toBe('stalled');
  });
});
