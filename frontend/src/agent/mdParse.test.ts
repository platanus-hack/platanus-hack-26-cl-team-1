import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './mdParse';

describe('parseInline', () => {
  it('handles bold, italics, code and line breaks', () => {
    expect(parseInline('**¡Listo!** usa `delay` y *espera*\nfin')).toEqual([
      { t: 'bold', c: [{ t: 'text', v: '¡Listo!' }] },
      { t: 'text', v: ' usa ' },
      { t: 'code', v: 'delay' },
      { t: 'text', v: ' y ' },
      { t: 'italic', c: [{ t: 'text', v: 'espera' }] },
      { t: 'br' },
      { t: 'text', v: 'fin' },
    ]);
  });

  it('leaves snake_case, lone asterisks and unclosed markers alone', () => {
    expect(parseInline('pin_mode y 2 * 3 = 6')).toEqual([{ t: 'text', v: 'pin_mode y 2 * 3 = 6' }]);
    expect(parseInline('**sin cerrar')).toEqual([{ t: 'text', v: '**sin cerrar' }]);
    expect(parseInline('<b>hola</b>')).toEqual([{ t: 'text', v: '<b>hola</b>' }]);
  });
});

describe('parseMarkdown', () => {
  it('builds paragraphs, lists, headings and code fences', () => {
    const blocks = parseMarkdown(['## Qué armé', '', 'Primero:', '- Un **LED**', '- Una resistencia', '', '1. Conecta', '2. Prueba', '', '```cpp', 'digitalWrite(13, HIGH);', '```'].join('\n'));
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'ol', 'code']);
    expect(blocks[2]).toMatchObject({ t: 'ul', items: [[{ t: 'text', v: 'Un ' }, { t: 'bold', c: [{ t: 'text', v: 'LED' }] }], [{ t: 'text', v: 'Una resistencia' }]] });
    expect(blocks[3]).toMatchObject({ t: 'ol', start: 1 });
    expect(blocks[4]).toEqual({ t: 'code', lang: 'cpp', v: 'digitalWrite(13, HIGH);' });
  });

  it('tolerates an unclosed fence while streaming', () => {
    expect(parseMarkdown('Mira:\n```\nvoid loop() {')).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'Mira:' }] },
      { t: 'code', lang: '', v: 'void loop() {' },
    ]);
  });
});
