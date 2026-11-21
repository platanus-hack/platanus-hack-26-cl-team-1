/**
 * 4-band resistor colour code (2 significant digits + multiplier + 5 % gold).
 *   220 Ω  → red, red, brown, gold
 *   10 kΩ  → brown, black, orange, gold
 *   4.7 kΩ → yellow, violet, red, gold
 */
export type BandColor =
  | 'black'
  | 'brown'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'violet'
  | 'grey'
  | 'white'
  | 'gold'
  | 'silver';

const DIGITS: BandColor[] = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];

/** Display colours (realistic paint tones on a beige body). */
export const BAND_HEX: Record<BandColor, string> = {
  black: '#1b1b1d',
  brown: '#7a4524',
  red: '#d2302c',
  orange: '#f17a16',
  yellow: '#f4cf1d',
  green: '#2e9a48',
  blue: '#2c6ad8',
  violet: '#8b4fd3',
  grey: '#8d939a',
  white: '#f3f3f1',
  gold: '#c8a03a',
  silver: '#c3c9cf',
};

/** Spanish names (Chile: "café" for brown) for tooltips / education text. */
export const BAND_LABEL_ES: Record<BandColor, string> = {
  black: 'negro',
  brown: 'café',
  red: 'rojo',
  orange: 'naranja',
  yellow: 'amarillo',
  green: 'verde',
  blue: 'azul',
  violet: 'violeta',
  grey: 'gris',
  white: 'blanco',
  gold: 'dorado',
  silver: 'plateado',
};

function multiplierColor(exp: number): BandColor {
  if (exp <= -2) return 'silver';
  if (exp === -1) return 'gold';
  return DIGITS[Math.min(exp, 9)];
}

/**
 * Colour bands of a resistance in ohms: [digit1, digit2, multiplier, tolerance].
 * Values are rounded to 2 significant digits. 0 Ω → a single black band.
 * Invalid input (NaN, negative) falls back to 0 Ω.
 */
export function resistorBands(ohms: number): BandColor[] {
  if (!Number.isFinite(ohms) || ohms <= 0) return ['black'];
  let exp = Math.floor(Math.log10(ohms) + 1e-9) - 1;
  let sig = Math.round(ohms / 10 ** exp);
  if (sig >= 100) {
    sig = Math.round(sig / 10);
    exp += 1;
  }
  if (sig < 10) {
    // tiny values (< 1 Ω): clamp at the silver multiplier
    sig = Math.max(1, sig) * 10;
    exp -= 1;
  }
  if (exp < -2) {
    sig = Math.max(10, Math.round(ohms * 100));
    exp = -2;
  }
  if (exp > 9) {
    sig = 99;
    exp = 9;
  }
  const d1 = Math.floor(sig / 10) % 10;
  const d2 = sig % 10;
  return [DIGITS[d1], DIGITS[d2], multiplierColor(exp), 'gold'];
}

/** "rojo, rojo, café, dorado" */
export function describeBands(ohms: number): string {
  return resistorBands(ohms)
    .map((c) => BAND_LABEL_ES[c])
    .join(', ');
}
