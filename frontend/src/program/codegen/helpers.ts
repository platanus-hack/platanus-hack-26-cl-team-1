/**
 * C++ helper functions emitted into the sketch only when the program needs
 * them. Each one has a JS twin in shared.ts used by the interpreter.
 */
import type { BoardProfile } from '@/contracts';

export type HelperId = 'printNum' | 'printBool' | 'div' | 'mod' | 'map' | 'constrain' | 'pwm' | 'percentToPwm' | 'percent' | 'ms' | 'tone';

export const HELPER_ORDER: HelperId[] = ['printNum', 'printBool', 'div', 'mod', 'map', 'constrain', 'pwm', 'percentToPwm', 'percent', 'ms', 'tone'];

export function helperSource(id: HelperId, board: BoardProfile | null): string[] {
  switch (id) {
    case 'printNum':
      return [
        '// Muestra un número en el Monitor Serie: sin decimales si es entero (3), con 2 decimales si no (3.14)',
        'void cvPrint(double value) {',
        '  if (fabs(value) < 2000000000.0 && value == (long) value) Serial.print((long) value);',
        '  else Serial.print(value, 2);',
        '}',
        'void cvPrintln(double value) {',
        '  cvPrint(value);',
        '  Serial.println();',
        '}',
      ];
    case 'printBool':
      return [
        '// Muestra un valor lógico como «verdadero» o «falso»',
        'void cvPrint(bool value) {',
        '  Serial.print(value ? "verdadero" : "falso");',
        '}',
        'void cvPrintln(bool value) {',
        '  cvPrint(value);',
        '  Serial.println();',
        '}',
      ];
    case 'div':
      return [
        '// División segura: si el divisor es 0 el resultado es 0 (en vez de un valor inválido)',
        'double cv_div(double a, double b) {',
        '  return b == 0 ? 0 : a / b;',
        '}',
      ];
    case 'mod':
      return [
        '// Resto de una división (también con decimales); 0 si el divisor es 0',
        'double cv_mod(double a, double b) {',
        '  return b == 0 ? 0 : fmod(a, b);',
        '}',
      ];
    case 'map':
      return [
        '// Pasa un valor de un rango a otro, conservando los decimales (map() de Arduino solo usa enteros)',
        'double cv_map(double value, double fromLow, double fromHigh, double toLow, double toHigh) {',
        '  if (fromHigh == fromLow) return toLow;',
        '  return (value - fromLow) * (toHigh - toLow) / (fromHigh - fromLow) + toLow;',
        '}',
      ];
    case 'constrain':
      return [
        '// Mantiene un valor entre dos límites (como constrain(), pero calcula el valor una sola vez)',
        'double cv_constrain(double value, double low, double high) {',
        '  return value < low ? low : (value > high ? high : value);',
        '}',
      ];
    case 'pwm':
      return [
        '// Ajusta un valor al rango 0..255 que entiende analogWrite()',
        'int cv_pwm(double value) {',
        '  return (int) round(constrain(value, 0, 255));',
        '}',
      ];
    case 'percentToPwm':
      return [
        '// Convierte un porcentaje (0..100 %) en un valor PWM (0..255)',
        'int cv_percentToPwm(double percent) {',
        '  return (int) round(constrain(percent, 0, 100) * 255 / 100);',
        '}',
      ];
    case 'percent': {
      const max = board?.adc.maxValue ?? 1023;
      return [
        `// Convierte una lectura analógica (0..${max}) en porcentaje (0..100 %)`,
        'double cv_percent(int raw) {',
        `  return round(raw * 100.0 / ${max});`,
        '}',
      ];
    }
    case 'ms':
      return [
        '// Tiempo de espera en milisegundos (los valores negativos cuentan como 0)',
        'unsigned long cv_ms(double ms) {',
        '  return ms > 0 ? (unsigned long) ms : 0;',
        '}',
      ];
    case 'tone':
      return [
        '// Hace sonar un tono (ms = 0: sin parar); con menos de 1 Hz lo silencia (tone() no acepta 0 Hz)',
        'void cv_tone(int pin, double hz, unsigned long ms) {',
        '  if (hz >= 1) tone(pin, (unsigned int) hz, ms);',
        '  else noTone(pin);',
        '}',
      ];
  }
}

/** Per-part click detector (rising edge of "pressed" with a 30 ms debounce). */
export function clickedHelperSource(fnName: string, pinConst: string, activeLow: boolean, label: string): string[] {
  return [
    `// ${label}: devuelve true UNA sola vez por cada pulsación (antirrebote de 30 ms)`,
    `bool ${fnName}() {`,
    '  static bool previous = false;         // ¿estaba presionado la vez anterior?',
    '  static unsigned long lastChange = 0;  // cuándo cambió por última vez (ms)',
    `  bool pressed = (digitalRead(${pinConst}) == ${activeLow ? 'LOW' : 'HIGH'});`,
    '  if (pressed != previous && millis() - lastChange >= 30) {',
    '    previous = pressed;',
    '    lastChange = millis();',
    '    return pressed;  // true solo al presionar, no al soltar',
    '  }',
    '  return false;',
    '}',
  ];
}

/** Escape a JS string as a C string literal. */
export function cString(s: string): string {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '?' && out.endsWith('?')) out += '\\?';
    else if (c < 0x20 || c === 0x7f) out += '\\' + c.toString(8).padStart(3, '0');
    else out += ch;
  }
  return `"${out}"`;
}
