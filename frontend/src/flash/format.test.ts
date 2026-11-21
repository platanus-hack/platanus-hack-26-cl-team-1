import { describe, expect, it } from 'vitest';
import { artifactExt, codeFingerprint, codeLine, formatSeconds, logSummary, usageLevel, usageText } from './format';

describe('codeFingerprint', () => {
  it('ignores comments, trailing spaces and blank lines but not code or strings', () => {
    const a = '// Circuito Vivo — A\nvoid loop() {\n  delay(500);  // espera\n}\n';
    const b = '// Circuito Vivo — B\n// LED → pin 9\n\nvoid loop() {   \n  delay(500);\n}';
    expect(codeFingerprint(a)).toBe(codeFingerprint(b));
    expect(codeFingerprint(a)).not.toBe(codeFingerprint(a.replace('500', '700')));
    const s = 'Serial.println("http://x // no es comentario");';
    expect(codeFingerprint(s)).toBe(s);
    expect(codeFingerprint('char c = \'/\'; /* x */ int y;')).toBe("char c = '/';  int y;");
    expect(codeFingerprint(null)).toBeNull();
  });
});

describe('compile panel formatting', () => {
  it('usage text in Spanish with thousands separators', () => {
    expect(usageText(1234, 32256)).toBe('Usa 1.234 bytes (3 %) de 32.256');
    expect(usageText(924, 32256)).toBe('Usa 924 bytes (2 %) de 32.256');
    expect(usageText(10, 0)).toBe('Usa 10 bytes');
  });

  it('usage levels', () => {
    expect(usageLevel(10)).toBe('ok');
    expect(usageLevel(80)).toBe('warn');
    expect(usageLevel(95)).toBe('danger');
  });

  it('seconds', () => {
    expect(formatSeconds(2400)).toBe('2,4 s');
    expect(formatSeconds(65_000)).toBe('1 min 05 s');
  });

  it('log summary skips size lines', () => {
    expect(logSummary('Sketch uses 1 bytes\nError de arduino-cli: boom\nmore\nx\ny')).toBe('Error de arduino-cli: boom\nmore\nx');
    expect(logSummary('sketch.ino:3:5: warning: unused variable\n int x;\n     ^\nServo.cpp:9:1: error: boom\nexit status 1')).toBe(
      'Servo.cpp:9:1: error: boom\nexit status 1',
    );
  });

  it('artifact extension and code lines', () => {
    expect(artifactExt({ board: 'uno', artifactName: 'sketch.ino.hex' })).toBe('.hex');
    expect(artifactExt({ board: 'esp32c6', artifactName: undefined })).toBe('.bin');
    expect(codeLine('a\n  b  \nc', 2)).toBe('  b');
    expect(codeLine('a', 5)).toBeNull();
    expect(codeLine(null, 1)).toBeNull();
  });
});
