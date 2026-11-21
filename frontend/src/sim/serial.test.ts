import { describe, expect, it } from 'vitest';
import { SerialBuffer } from './serial';

const texts = (b: SerialBuffer) => b.snapshot().map((l) => l.text);

describe('SerialBuffer', () => {
  it('merges partial prints into the current line', () => {
    const b = new SerialBuffer();
    b.write('Valor: ', 10);
    b.write('3', 11);
    b.write('\n', 12);
    b.write('Otro\n', 20);
    expect(b.snapshot()).toEqual([
      { t: 10, text: 'Valor: 3' },
      { t: 20, text: 'Otro' },
    ]);
    expect(b.isOpen).toBe(false);
  });

  it('splits chunks with several newlines and keeps blank lines', () => {
    const b = new SerialBuffer();
    b.write('a\n\nb\nc', 0);
    expect(texts(b)).toEqual(['a', '', 'b', 'c']);
    expect(b.isOpen).toBe(true);
    b.write('d\n', 1);
    expect(texts(b)).toEqual(['a', '', 'b', 'cd']);
  });

  it('an empty println on a closed line adds a blank line', () => {
    const b = new SerialBuffer();
    b.write('x\n', 0);
    b.write('\n', 1);
    expect(texts(b)).toEqual(['x', '']);
  });

  it('normalizes CRLF', () => {
    const b = new SerialBuffer();
    b.write('hola\r\nmundo\r\n', 0);
    expect(texts(b)).toEqual(['hola', 'mundo']);
  });

  it('keeps only the last N lines in snapshots', () => {
    const b = new SerialBuffer(5);
    for (let i = 0; i < 23; i++) b.write(`${i}\n`, i);
    expect(texts(b)).toEqual(['18', '19', '20', '21', '22']);
  });

  it('bumps version on change and clear resets the open line', () => {
    const b = new SerialBuffer();
    const v0 = b.version;
    b.write('abc', 0);
    expect(b.version).toBeGreaterThan(v0);
    b.clear();
    expect(b.length).toBe(0);
    b.write('def\n', 5);
    expect(b.snapshot()).toEqual([{ t: 5, text: 'def' }]);
  });
});
