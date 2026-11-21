// @vitest-environment jsdom
/**
 * Buzzer audio lifecycle with a fake WebAudio implementation: every started
 * oscillator must be stopped when the buzzer goes quiet, on mute, and when
 * the tab is hidden (requestAnimationFrame stops there, so the runtime can no
 * longer silence a tone that was sounding).
 */
import { beforeAll, describe, expect, it } from 'vitest';

class FakeParam {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
  cancelScheduledValues() {}
}
class FakeNode {
  connect() {}
  disconnect() {}
}
const oscillators: FakeOsc[] = [];
class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  constructor() {
    super();
    oscillators.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = new FakeNode();
  createGain() {
    return new FakeGain();
  }
  createOscillator() {
    return new FakeOsc();
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

const playing = () => oscillators.filter((o) => o.started && !o.stopped).length;

let audio: typeof import('./audio');

beforeAll(async () => {
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  audio = await import('./audio');
  audio.setMuted(false);
  audio.unlockAudio();
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('buzzer audio lifecycle', () => {
  it('starts one voice per sounding buzzer and stops it when silenced', () => {
    audio.syncAudio(new Map([['bz1', 440]]));
    expect(playing()).toBe(1);
    audio.silenceAudio();
    expect(playing()).toBe(0);
  });

  it('mute stops every voice and unmute does not restart a stale tone by itself', () => {
    audio.syncAudio(new Map([['bz1', 440]]));
    audio.setMuted(true);
    expect(playing()).toBe(0);
    audio.syncAudio(new Map([['bz1', 440]]));
    expect(playing()).toBe(0);
    audio.setMuted(false);
    expect(playing()).toBe(1);
    audio.silenceAudio();
    expect(playing()).toBe(0);
  });

  it('hiding the tab stops a sounding tone (the frame loop is paused there)', () => {
    audio.syncAudio(new Map([['bz1', 880]]));
    expect(playing()).toBe(1);
    setHidden(true);
    expect(playing()).toBe(0);
    // while hidden nothing may start a voice
    audio.syncAudio(new Map([['bz1', 880]]));
    expect(playing()).toBe(0);
    // back to the tab: the runtime's next frame decides again
    setHidden(false);
    audio.syncAudio(new Map([['bz1', 880]]));
    expect(playing()).toBe(1);
    audio.silenceAudio();
    expect(playing()).toBe(0);
  });
});
