/**
 * Incremental Server-Sent Events parser (WHATWG event-stream rules, the subset
 * we need): handles frames split across arbitrary chunk boundaries, \n / \r\n /
 * \r line endings, comment lines (": ping") and multi-line data.
 */
export interface SSEMessage {
  event: string;
  data: string;
}

export class SSEParser {
  private buf = '';
  private data: string[] = [];
  private event = '';

  /** Feed a decoded text chunk; returns the messages completed by it. */
  push(chunk: string): SSEMessage[] {
    let text = this.buf + chunk;
    // A trailing \r may be the first half of \r\n: keep it for the next chunk.
    let hold = '';
    if (text.endsWith('\r')) {
      hold = '\r';
      text = text.slice(0, -1);
    }
    const lines = text.replace(/\r\n|\r/g, '\n').split('\n');
    this.buf = (lines.pop() ?? '') + hold;
    const out: SSEMessage[] = [];
    for (const line of lines) this.line(line, out);
    return out;
  }

  /** End of stream: a last frame without its blank line is discarded (per spec). */
  flush(): SSEMessage[] {
    this.buf = '';
    this.data = [];
    this.event = '';
    return [];
  }

  private line(line: string, out: SSEMessage[]): void {
    if (line === '') {
      if (this.data.length > 0) out.push({ event: this.event || 'message', data: this.data.join('\n') });
      this.data = [];
      this.event = '';
      return;
    }
    if (line.startsWith(':')) return; // comment / keepalive
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    // id / retry are not used by this protocol
  }
}
