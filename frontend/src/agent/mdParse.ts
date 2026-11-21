/**
 * Tiny, safe Markdown subset for assistant messages → plain data (rendered as
 * React elements, never as HTML): paragraphs with line breaks, **bold**,
 * *italics* / _italics_, `inline code`, bullet / numbered lists, small
 * headings and ``` code fences (tolerates an unclosed fence while streaming).
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'br' };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] }
  | { t: 'code'; lang: string; v: string };

const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const pushText = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') {
      pushText();
      out.push({ t: 'br' });
      i++;
      continue;
    }
    if (ch === '`') {
      const j = src.indexOf('`', i + 1);
      if (j > i + 1) {
        pushText();
        out.push({ t: 'code', v: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] === ch) {
      const close = src.indexOf(ch + ch, i + 2);
      if (close > i + 2 && src[i + 2] !== ' ') {
        pushText();
        out.push({ t: 'bold', c: parseInline(src.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] && src[i + 1] !== ' ' && src[i + 1] !== ch && !(ch === '_' && isWord(src[i - 1]))) {
      let j = i + 1;
      let close = -1;
      while ((j = src.indexOf(ch, j)) !== -1) {
        const okBefore = src[j - 1] !== ' ';
        const okAfter = ch === '*' || !isWord(src[j + 1]);
        if (okBefore && okAfter && src[j + 1] !== ch) {
          close = j;
          break;
        }
        j++;
      }
      if (close > i + 1) {
        pushText();
        out.push({ t: 'italic', c: parseInline(src.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  pushText();
  return out;
}

const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const FENCE = /^\s{0,3}```\s*([\w+-]*)\s*$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; start: number; items: string[] } | null = null;

  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join('\n')) });
    para = [];
  };
  const endList = () => {
    if (!list) return;
    const items = list.items.map((s) => parseInline(s));
    blocks.push(list.t === 'ul' ? { t: 'ul', items } : { t: 'ol', start: list.start, items });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      endPara();
      endList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s{0,3}```\s*$/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ t: 'code', lang: fence[1] ?? '', v: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      endPara();
      endList();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      endPara();
      endList();
      blocks.push({ t: 'h', level: h[1].length, c: parseInline(h[2].trim()) });
      continue;
    }
    const b = BULLET.exec(line);
    const o = b ? null : ORDERED.exec(line);
    if (b || o) {
      endPara();
      const kind = b ? 'ul' : 'ol';
      if (!list || list.t !== kind) {
        endList();
        list = { t: kind, start: o ? Number(o[1]) : 1, items: [] };
      }
      list.items.push((b ? b[1] : o![2]).trim());
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // continuation of the previous list item
      list.items[list.items.length - 1] += `\n${line.trim()}`;
      continue;
    }
    endList();
    para.push(line.trimEnd());
  }
  endPara();
  endList();
  return blocks;
}
