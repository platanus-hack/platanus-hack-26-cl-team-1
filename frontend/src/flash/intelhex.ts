/**
 * Intel HEX → flat binary image (gaps and padding filled with 0xFF, the erased-flash value).
 * Supports record types 00 (data), 01 (EOF), 02 (extended segment), 04 (extended linear);
 * 03/05 (start address) are ignored.
 */

export interface HexImage {
  /** Bytes from address 0 up to the highest written address (exclusive). */
  data: Uint8Array;
  /** Lowest written address. */
  start: number;
  /** One past the highest written address (= data.length). */
  end: number;
}

export class IntelHexError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = 'IntelHexError';
    this.line = line;
  }
}

/** Largest image accepted (1 MiB) — protects against absurd addresses in a corrupt file. */
const MAX_IMAGE_BYTES = 0x100000;

const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

/** Strict: Number.parseInt alone would read '1g', '+1' or ' 1' as 1. */
function hexByte(s: string, at: number): number {
  const pair = s.slice(at, at + 2);
  return HEX_PAIR.test(pair) ? Number.parseInt(pair, 16) : -1;
}

export function parseIntelHex(text: string): HexImage {
  const chunks: Array<{ address: number; bytes: Uint8Array }> = [];
  let base = 0;
  let sawEof = false;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length && !sawEof; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const lineNo = i + 1;
    if (raw[0] !== ':' || raw.length < 11 || (raw.length - 1) % 2 !== 0) {
      throw new IntelHexError(`El archivo .hex está dañado (línea ${lineNo}: formato inválido).`, lineNo);
    }
    const bytes: number[] = [];
    for (let p = 1; p < raw.length; p += 2) {
      const b = hexByte(raw, p);
      if (b < 0) throw new IntelHexError(`El archivo .hex está dañado (línea ${lineNo}: carácter inválido).`, lineNo);
      bytes.push(b);
    }
    const count = bytes[0];
    if (bytes.length !== count + 5) {
      throw new IntelHexError(`El archivo .hex está dañado (línea ${lineNo}: largo incorrecto).`, lineNo);
    }
    const sum = bytes.reduce((a, b) => a + b, 0) & 0xff;
    if (sum !== 0) throw new IntelHexError(`El archivo .hex está dañado (línea ${lineNo}: checksum incorrecto).`, lineNo);

    const offset = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const payload = bytes.slice(4, 4 + count);
    switch (type) {
      case 0x00:
        chunks.push({ address: base + offset, bytes: Uint8Array.from(payload) });
        break;
      case 0x01:
        sawEof = true;
        break;
      case 0x02:
        if (count !== 2) throw new IntelHexError(`El archivo .hex está dañado (línea ${lineNo}).`, lineNo);
        base = ((payload[0] << 8) | payload[1]) * 16;
        break;
      case 0x04:
        if (count !== 2) throw new IntelHexError(`El archivo .hex está dañado (línea ${lineNo}).`, lineNo);
        base = ((payload[0] << 8) | payload[1]) * 0x10000;
        break;
      case 0x03:
      case 0x05:
        break;
      default:
        throw new IntelHexError(`El archivo .hex tiene un registro desconocido (línea ${lineNo}).`, lineNo);
    }
  }

  if (!sawEof) throw new IntelHexError('El archivo .hex está incompleto (falta el registro final).', lines.length);
  if (chunks.length === 0) return { data: new Uint8Array(0), start: 0, end: 0 };

  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const c of chunks) {
    start = Math.min(start, c.address);
    end = Math.max(end, c.address + c.bytes.length);
  }
  if (end > MAX_IMAGE_BYTES) throw new IntelHexError('El archivo .hex es demasiado grande para esta placa.', 0);
  const data = new Uint8Array(end).fill(0xff);
  for (const c of chunks) data.set(c.bytes, c.address);
  return { data, start, end };
}

/** Split an image into fixed-size pages (last page padded with 0xFF). Pages entirely 0xFF before `start` are skipped. */
export function toPages(image: HexImage, pageSize: number): Array<{ address: number; data: Uint8Array }> {
  const pages: Array<{ address: number; data: Uint8Array }> = [];
  const first = Math.floor(image.start / pageSize) * pageSize;
  for (let addr = first; addr < image.end; addr += pageSize) {
    const page = new Uint8Array(pageSize).fill(0xff);
    page.set(image.data.subarray(addr, Math.min(addr + pageSize, image.end)));
    pages.push({ address: addr, data: page });
  }
  return pages;
}
