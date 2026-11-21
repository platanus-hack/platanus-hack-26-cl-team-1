import { describe, expect, it } from 'vitest';
import { IntelHexError, parseIntelHex, toPages } from './intelhex';

/** Build one Intel HEX record with a correct checksum. */
function rec(address: number, type: number, data: number[]): string {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data];
  const sum = (0x100 - (bytes.reduce((a, b) => a + b, 0) & 0xff)) & 0xff;
  return ':' + [...bytes, sum].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}
const EOF_REC = ':00000001FF';

describe('parseIntelHex', () => {
  it('parses a real avr-gcc record (checksum verified)', () => {
    const img = parseIntelHex(':100000000C9434000C9446000C9446000C9446006A\n' + EOF_REC + '\n');
    expect(img.start).toBe(0);
    expect(img.end).toBe(16);
    expect(Array.from(img.data.slice(0, 4))).toEqual([0x0c, 0x94, 0x34, 0x00]);
  });

  it('fills gaps with 0xFF and handles CRLF', () => {
    const text = [rec(0x0000, 0, [1, 2]), rec(0x0004, 0, [3]), EOF_REC].join('\r\n');
    const img = parseIntelHex(text);
    expect(Array.from(img.data)).toEqual([1, 2, 0xff, 0xff, 3]);
  });

  it('applies extended linear (04) and segment (02) addresses', () => {
    const lin = parseIntelHex([rec(0, 4, [0x00, 0x01]), rec(0x0002, 0, [0xaa]), EOF_REC].join('\n'));
    expect(lin.start).toBe(0x10002);
    expect(lin.data[0x10002]).toBe(0xaa);
    const seg = parseIntelHex([rec(0, 2, [0x10, 0x00]), rec(0x0001, 0, [0xbb]), EOF_REC].join('\n'));
    expect(seg.start).toBe(0x10001);
    expect(seg.data[0x10001]).toBe(0xbb);
  });

  it('ignores start-address records and stops at EOF', () => {
    const img = parseIntelHex([rec(0, 0, [9]), rec(0, 3, [0, 0, 0, 0]), rec(0, 5, [0, 0, 0, 0]), EOF_REC, 'garbage after eof'].join('\n'));
    expect(Array.from(img.data)).toEqual([9]);
  });

  it('rejects corrupt files with a Spanish message and the line number', () => {
    expect(() => parseIntelHex(':100000000C9434000C9446000C9446000C9446006B\n' + EOF_REC)).toThrow(/checksum/);
    expect(() => parseIntelHex('hola\n' + EOF_REC)).toThrow(IntelHexError);
    expect(() => parseIntelHex(rec(0, 0, [1]))).toThrow(/incompleto/);
    try {
      parseIntelHex(`${rec(0, 0, [1])}\n:0300000001FF`);
    } catch (e) {
      expect(e).toBeInstanceOf(IntelHexError);
      expect((e as IntelHexError).line).toBe(2);
    }
  });

  it('rejects non-hex characters even when Number.parseInt would read a prefix and the checksum matches', () => {
    // "1g" used to parse as 0x01 ('g' silently dropped) and the checksum computed for 0x01 passed.
    const sum = (0x100 - ((1 + 0 + 0 + 0 + 1) & 0xff)) & 0xff;
    const forged = `:01000000${'1g'}${sum.toString(16).padStart(2, '0')}`;
    expect(() => parseIntelHex(`${forged}\n${EOF_REC}`)).toThrow(/carácter inválido/);
    expect(() => parseIntelHex(`:01000000+1FE\n${EOF_REC}`)).toThrow(IntelHexError); // '+1' was read as 1
    expect(() => parseIntelHex(`:01000000 1FE\n${EOF_REC}`)).toThrow(IntelHexError); // ' 1' was read as 1
  });

  it('returns an empty image for a file with only EOF', () => {
    expect(parseIntelHex(EOF_REC).end).toBe(0);
  });
});

describe('toPages', () => {
  it('splits into padded pages', () => {
    const img = parseIntelHex([rec(0, 0, Array.from({ length: 16 }, (_, i) => i)), rec(16, 0, [0x42]), EOF_REC].join('\n'));
    const pages = toPages(img, 8);
    expect(pages.map((p) => p.address)).toEqual([0, 8, 16]);
    expect(Array.from(pages[2].data)).toEqual([0x42, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  });
});
