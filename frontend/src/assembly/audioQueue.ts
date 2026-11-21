/**
 * Plays the agent's voice clips one at a time.
 *  - Errors jump ahead of pending info clips (never interrupt the clip playing now).
 *  - cancel(id) drops a pending clip (the user fixed the error before it was said).
 *  - Muted: nothing is queued and the current clip stops.
 * A clip carries a WAV from the server, or only text when the server has no TTS
 * (then the browser's speechSynthesis says it, as a fallback).
 */

export interface Clip {
  id: string;
  text: string;
  priority: 'error' | 'info';
  audio?: ArrayBuffer;
}

export interface ClipPlayer {
  play(clip: Clip): Promise<void>;
  stop(): void;
}

export class AudioQueue {
  private pending: Clip[] = [];
  private current: Clip | null = null;
  private muted = false;
  onChange: ((speaking: Clip | null, pending: number) => void) | null = null;

  constructor(private readonly player: ClipPlayer) {}

  get speaking(): Clip | null {
    return this.current;
  }

  get size(): number {
    return this.pending.length;
  }

  enqueue(clip: Clip): void {
    if (this.muted) return;
    if (clip.priority === 'error') {
      const firstInfo = this.pending.findIndex((c) => c.priority !== 'error');
      if (firstInfo < 0) this.pending.push(clip);
      else this.pending.splice(firstInfo, 0, clip);
    } else {
      this.pending.push(clip);
    }
    this.emit();
    void this.pump();
  }

  cancel(id: string): void {
    const n = this.pending.length;
    this.pending = this.pending.filter((c) => c.id !== id);
    if (this.pending.length !== n) this.emit();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.clear();
  }

  clear(): void {
    this.pending = [];
    if (this.current) this.player.stop();
    this.emit();
  }

  private async pump(): Promise<void> {
    if (this.current) return;
    const next = this.pending.shift();
    if (!next) return;
    this.current = next;
    this.emit();
    try {
      await this.player.play(next);
    } catch {
      /* a broken clip must not block the queue */
    }
    this.current = null;
    this.emit();
    void this.pump();
  }

  private emit(): void {
    this.onChange?.(this.current, this.pending.length);
  }
}

/** Browser player: WebAudio for WAV clips, speechSynthesis (es-CL) for text-only clips. */
export class BrowserClipPlayer implements ClipPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private done: (() => void) | null = null;

  /** Call from a user gesture (the "Empezar" button) so autoplay policies allow sound. */
  unlock(): void {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }

  async play(clip: Clip): Promise<void> {
    if (!clip.audio) return this.speak(clip.text);
    this.unlock();
    const ctx = this.ctx!;
    const buffer = await ctx.decodeAudioData(clip.audio.slice(0));
    await new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      this.source = src;
      this.done = resolve;
      src.onended = () => {
        this.source = null;
        this.done = null;
        resolve();
      };
      src.start();
    });
  }

  stop(): void {
    try {
      this.source?.stop();
    } catch {
      /* already stopped */
    }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.done?.();
    this.done = null;
  }

  private speak(text: string): Promise<void> {
    if (typeof speechSynthesis === 'undefined') return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-CL';
      const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('es'));
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      this.done = resolve;
      speechSynthesis.speak(u);
    });
  }
}
