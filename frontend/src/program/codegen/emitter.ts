/**
 * Line-based source emitter with 2-space indentation, a line → block id map
 * and trailing `//` comments that are aligned per group of consecutive lines.
 */
const MAX_ALIGN = 64; // longer code lines keep a 2-space gap and break the group

export class Emitter {
  /** Code of each line (with indentation, without its trailing comment). */
  readonly lines: string[] = [];
  /** Trailing comment of each line (without `//`). */
  readonly comments: Array<string | undefined> = [];
  /** 1-based line → block id. */
  readonly lineMap: Record<number, string> = {};
  private depth = 0;

  line(text: string, id?: string, comment?: string): void {
    this.lines.push(text ? '  '.repeat(this.depth) + text : '');
    this.comments.push(text && comment ? comment : undefined);
    if (id) this.lineMap[this.lines.length] = id;
  }

  /** Blank separator line (never two in a row, never at the start). */
  blank(): void {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.line('');
  }

  indent(): void {
    this.depth++;
  }

  dedent(): void {
    this.depth = Math.max(0, this.depth - 1);
  }

  /** Append another emitter's lines keeping its line map and comments. */
  append(other: Emitter): void {
    const offset = this.lines.length;
    this.lines.push(...other.lines);
    this.comments.push(...other.comments);
    for (const [ln, id] of Object.entries(other.lineMap)) this.lineMap[Number(ln) + offset] = id;
  }

  /** Final text: trailing comments aligned within runs of consecutive commented lines. */
  toString(): string {
    const out: string[] = [];
    let i = 0;
    while (i < this.lines.length) {
      if (this.comments[i] === undefined || this.lines[i].length > MAX_ALIGN) {
        const c = this.comments[i];
        out.push(c === undefined ? this.lines[i] : `${this.lines[i]}  // ${c}`);
        i++;
        continue;
      }
      let j = i;
      while (j < this.lines.length && this.comments[j] !== undefined && this.lines[j].length <= MAX_ALIGN) j++;
      const width = Math.max(...this.lines.slice(i, j).map((l) => l.length));
      for (let k = i; k < j; k++) out.push(`${this.lines[k].padEnd(width)}  // ${this.comments[k]}`);
      i = j;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }
}
