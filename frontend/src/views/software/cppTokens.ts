/**
 * Tiny C++ tokenizer for the read-only code viewer (Arduino sketches only —
 * not a full lexer). Produces tokens per line so the viewer can render line
 * numbers and highlight block-mapped lines. Block comments spanning lines are
 * split per line keeping their token type.
 */

export type TokenType = 'comment' | 'preproc' | 'string' | 'number' | 'keyword' | 'type' | 'constant' | 'function' | 'ident' | 'punct' | 'space';

export interface Token {
  t: TokenType;
  v: string;
}

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default',
  'static', 'const', 'volatile', 'inline', 'struct', 'class', 'public', 'private', 'new', 'delete',
  'sizeof', 'typedef', 'namespace', 'using', 'template', 'extern', 'goto', 'nullptr',
]);

const TYPES = new Set([
  'void', 'int', 'long', 'short', 'unsigned', 'signed', 'float', 'double', 'bool', 'boolean', 'char',
  'byte', 'word', 'size_t', 'String', 'uint8_t', 'uint16_t', 'uint32_t', 'int8_t', 'int16_t', 'int32_t',
  'Servo', 'auto',
]);

const CONSTANTS = new Set(['true', 'false', 'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN', 'NULL', 'PI']);

const RULES: Array<[TokenType, RegExp]> = [
  ['space', /^[ \t]+/],
  ['comment', /^\/\/[^\n]*/],
  ['comment', /^\/\*[\s\S]*?(\*\/|$)/],
  ['preproc', /^#[^\n]*/],
  ['string', /^"(?:\\.|[^"\\\n])*"?/],
  ['string', /^'(?:\\.|[^'\\\n])*'?/],
  ['number', /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[uUlLfF]*/],
  ['ident', /^[A-Za-z_]\w*/],
  ['punct', /^(?:::|->|<<|>>|[<>=!]=|&&|\|\||\+\+|--|[{}()[\];,.<>+\-*/%=!&|^~?:])/],
];

function classifyIdent(word: string, rest: string): TokenType {
  if (KEYWORDS.has(word)) return 'keyword';
  if (TYPES.has(word)) return 'type';
  if (CONSTANTS.has(word)) return 'constant';
  if (/^\s*\(/.test(rest)) return 'function';
  return 'ident';
}

/** Tokenize source code into lines of tokens (one entry per "\n"-separated line). */
export function tokenizeCpp(code: string): Token[][] {
  const lines: Token[][] = [[]];
  let i = 0;
  const push = (t: TokenType, v: string) => {
    const parts = v.split('\n');
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ t, v: part });
    });
  };
  while (i < code.length) {
    const rest = code.slice(i);
    if (rest[0] === '\n') {
      lines.push([]);
      i++;
      continue;
    }
    let matched = false;
    for (const [type, re] of RULES) {
      const m = re.exec(rest);
      if (!m || m[0].length === 0) continue;
      const v = m[0];
      push(type === 'ident' ? classifyIdent(v, rest.slice(v.length)) : type, v);
      i += v.length;
      matched = true;
      break;
    }
    if (!matched) {
      push('punct', rest[0]);
      i++;
    }
  }
  return lines;
}
