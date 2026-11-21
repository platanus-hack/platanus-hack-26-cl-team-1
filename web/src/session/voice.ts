// Plays the supervisor's lines one at a time (voice owner: Alonso). The server's voice queue decides
// when a line may start (anti-spam); here a new line stops the current one (an urgent correction
// interrupts), and `cancel_say` stops the line it names (the mistake was fixed).
import type { Say } from '../contracts/ws_server_message';

export class VoicePlayer {
  private currentId: string | null = null;
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;

  /** A `say` message. Without server audio, the browser speaks the text. */
  say(message: Say): void {
    this.stop();
    this.currentId = message.id;
    if (!message.audio) {
      const utterance = new SpeechSynthesisUtterance(message.text);
      utterance.lang = 'es-CL';
      speechSynthesis.speak(utterance);
    } // with audio, the binary frame follows (play)
  }

  /** The audio frame for a `say`. Ignored if a newer line already started. */
  play(id: string, bytes: Uint8Array): void {
    if (id !== this.currentId) return;
    this.url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'audio/mpeg' }));
    this.audio = new Audio(this.url);
    this.audio.addEventListener('ended', () => this.release());
    this.audio.play().catch((error: unknown) => console.error('audio playback failed', error));
  }

  cancel(id: string): void {
    if (id === this.currentId) this.stop();
  }

  stop(): void {
    speechSynthesis.cancel();
    this.audio?.pause();
    this.release();
    this.currentId = null;
  }

  private release(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.audio = null;
  }
}
