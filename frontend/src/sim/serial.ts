/**
 * Serial monitor buffer: raw chunks from host.serial → lines.
 * Chunks are split on "\n"; a chunk without a trailing newline leaves the
 * line "open" so the next print continues it ("Valor: " + "3" + "\n").
 */
export interface SerialLine {
  t: number; // sim ms when the line started
  text: string;
}

const MAX_LINE_CHARS = 1000;

export class SerialBuffer {
  private lines: SerialLine[] = [];
  private open = false;
  /** Bumped on every change (publish when it differs from the last published one). */
  version = 0;

  constructor(private readonly maxLines = 500) {}

  get isOpen(): boolean {
    return this.open;
  }

  get length(): number {
    return this.lines.length;
  }

  write(chunk: string, t: number): void {
    if (!chunk) return;
    const parts = chunk.replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast && part === '') break; // next line not started yet
      const last = this.lines[this.lines.length - 1];
      if (i === 0 && this.open && last && last.text.length + part.length <= MAX_LINE_CHARS) {
        this.lines[this.lines.length - 1] = { t: last.t, text: last.text + part };
      } else {
        this.lines.push({ t, text: part.length > MAX_LINE_CHARS ? part.slice(0, MAX_LINE_CHARS) : part });
      }
    }
    this.open = parts[parts.length - 1] !== '';
    // Trim lazily (amortized) so print floods stay cheap.
    if (this.lines.length > this.maxLines * 2) this.lines = this.lines.slice(-this.maxLines);
    this.version++;
  }

  clear(): void {
    if (this.lines.length === 0 && !this.open) return;
    this.lines = [];
    this.open = false;
    this.version++;
  }

  /** Last `maxLines` lines as a NEW array (safe to hand to the store). */
  snapshot(): SerialLine[] {
    return this.lines.length > this.maxLines ? this.lines.slice(-this.maxLines) : this.lines.slice();
  }
}
