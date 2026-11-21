import { describe, expect, it } from 'vitest';
import { AudioQueue, type Clip, type ClipPlayer } from './audioQueue';

class FakePlayer implements ClipPlayer {
  played: string[] = [];
  stopped = 0;
  private finish: (() => void) | null = null;
  play(clip: Clip) {
    this.played.push(clip.id);
    return new Promise<void>((r) => (this.finish = r));
  }
  stop() {
    this.stopped++;
    this.end();
  }
  end() {
    const f = this.finish;
    this.finish = null;
    f?.();
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const clip = (id: string, priority: Clip['priority'] = 'info'): Clip => ({ id, text: id, priority });

describe('AudioQueue', () => {
  it('plays clips one at a time, in order', async () => {
    const p = new FakePlayer();
    const q = new AudioQueue(p);
    q.enqueue(clip('a'));
    q.enqueue(clip('b'));
    expect(p.played).toEqual(['a']);
    p.end();
    await tick();
    expect(p.played).toEqual(['a', 'b']);
    p.end();
    await tick();
    expect(q.speaking).toBeNull();
  });

  it('errors jump ahead of pending info clips but do not interrupt the current one', async () => {
    const p = new FakePlayer();
    const q = new AudioQueue(p);
    q.enqueue(clip('i1'));
    q.enqueue(clip('i2'));
    q.enqueue(clip('e1', 'error'));
    q.enqueue(clip('e2', 'error'));
    expect(p.played).toEqual(['i1']);
    for (let i = 0; i < 3; i++) {
      p.end();
      await tick();
    }
    expect(p.played).toEqual(['i1', 'e1', 'e2', 'i2']);
  });

  it('cancel drops a pending clip', async () => {
    const p = new FakePlayer();
    const q = new AudioQueue(p);
    q.enqueue(clip('a'));
    q.enqueue(clip('err', 'error'));
    q.cancel('err');
    expect(q.size).toBe(0);
    p.end();
    await tick();
    expect(p.played).toEqual(['a']);
  });

  it('muting stops the current clip and ignores new ones', async () => {
    const p = new FakePlayer();
    const q = new AudioQueue(p);
    q.enqueue(clip('a'));
    q.enqueue(clip('b'));
    q.setMuted(true);
    expect(p.stopped).toBe(1);
    await tick();
    q.enqueue(clip('c'));
    expect(p.played).toEqual(['a']);
    q.setMuted(false);
    q.enqueue(clip('d'));
    expect(p.played).toEqual(['a', 'd']);
  });

  it('a clip that fails to play does not block the queue', async () => {
    const played: string[] = [];
    const q = new AudioQueue({
      play: async (c) => {
        played.push(c.id);
        if (c.id === 'bad') throw new Error('decode');
      },
      stop: () => {},
    });
    q.enqueue(clip('bad'));
    q.enqueue(clip('ok'));
    await tick();
    await tick();
    expect(played).toEqual(['bad', 'ok']);
  });
});
