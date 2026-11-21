import { describe, expect, it } from 'vitest';
import { tokenizeCpp } from './cppTokens';
import { linesForBlocks } from './lines';

const text = (line: { v: string }[]) => line.map((t) => t.v).join('');

describe('tokenizeCpp', () => {
  it('keeps one token list per source line and reconstructs the text', () => {
    const code = '#include <Servo.h>\n\nvoid setup() {\n  pinMode(13, OUTPUT);\n}\n';
    const lines = tokenizeCpp(code);
    expect(lines).toHaveLength(6);
    expect(lines.map(text).join('\n')).toBe(code);
  });

  it('classifies keywords, types, constants, functions, numbers, strings and comments', () => {
    const [line] = tokenizeCpp('if (x >= 3.5f) digitalWrite(LED, HIGH); // hola "x"');
    const kinds = Object.fromEntries(line.filter((t) => t.t !== 'space').map((t) => [t.v, t.t]));
    expect(kinds).toMatchObject({
      if: 'keyword',
      x: 'ident',
      '>=': 'punct',
      '3.5f': 'number',
      digitalWrite: 'function',
      HIGH: 'constant',
      '// hola "x"': 'comment',
    });
    const [decl] = tokenizeCpp('double contador = 0; Serial.println("a\\"b");');
    expect(decl.find((t) => t.v === 'double')?.t).toBe('type');
    expect(decl.find((t) => t.t === 'string')?.v).toBe('"a\\"b"');
    expect(decl.find((t) => t.v === 'println')?.t).toBe('function');
  });

  it('splits multi-line block comments per line', () => {
    const lines = tokenizeCpp('/* uno\n dos */ int a;');
    expect(lines[0]).toEqual([{ t: 'comment', v: '/* uno' }]);
    expect(lines[1][0]).toEqual({ t: 'comment', v: ' dos */' });
    expect(lines[1].some((t) => t.v === 'int' && t.t === 'type')).toBe(true);
  });

  it('never loops on unknown characters', () => {
    const lines = tokenizeCpp('a @ b ` ñ');
    expect(text(lines[0])).toBe('a @ b ` ñ');
  });
});

describe('linesForBlocks', () => {
  it('maps block ids to their 1-based code lines', () => {
    const lineMap = { 3: 'a', 4: 'b', 5: 'a', 9: 'c' };
    expect([...linesForBlocks(lineMap, new Set(['a']))]).toEqual([3, 5]);
    expect([...linesForBlocks(lineMap, new Set(['b', 'c']))]).toEqual([4, 9]);
    expect(linesForBlocks(lineMap, new Set()).size).toBe(0);
  });
});
