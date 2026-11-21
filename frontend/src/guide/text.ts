/** Spanish vocabulary for the wiring guide (nouns, pin descriptions, tips). */
import type { PartDef, PartInstance, WireColor } from '@/contracts';
import { propValue } from '@/catalog';
import { formatOhms } from '@/lib/format';

export const WIRE_COLOR_ES: Record<WireColor, string> = {
  red: 'rojo',
  black: 'negro',
  blue: 'azul',
  green: 'verde',
  yellow: 'amarillo',
  orange: 'naranja',
  white: 'blanco',
  purple: 'morado',
};

export const LED_COLOR_ES: Record<string, string> = {
  red: 'rojo',
  green: 'verde',
  yellow: 'amarillo',
  blue: 'azul',
  white: 'blanco',
};

const NOUNS: Record<string, string> = {
  led: 'el LED',
  'led-rgb': 'el LED RGB',
  resistor: 'la resistencia',
  diode: 'el diodo',
  button: 'el botón',
  'switch-slide': 'el interruptor deslizante',
  potentiometer: 'el potenciómetro',
  ldr: 'la fotorresistencia (LDR)',
  buzzer: 'el zumbador',
  'motor-dc': 'el motor',
  npn: 'el transistor NPN',
  'servo-sg90': 'el servo',
  'battery-9v': 'la batería de 9 V',
  'battery-aa4': 'el portapilas 4×AA',
};

/** Long pin descriptions ("la pata larga (ánodo, +)"). */
const PIN_LONG: Record<string, Record<string, string>> = {
  led: { anode: 'la pata larga (ánodo, +)', cathode: 'la pata corta (cátodo, −)' },
  'led-rgb': { r: 'la pata del rojo', com: 'la pata más larga (cátodo común, −)', g: 'la pata del verde', b: 'la pata del azul' },
  resistor: { a: 'una pata', b: 'la otra pata' },
  ldr: { a: 'una pata', b: 'la otra pata' },
  diode: { anode: 'el ánodo', cathode: 'el cátodo (lado de la franja plateada)' },
  button: { a1: 'la pata A1', a2: 'la pata A2', b1: 'la pata B1', b2: 'la pata B2' },
  'switch-slide': { a: 'la pata A', com: 'la pata central (común)', b: 'la pata B' },
  potentiometer: { a: 'el extremo 1', wiper: 'la pata central (cursor)', b: 'el extremo 2' },
  buzzer: { plus: 'la pata larga (+)', minus: 'la pata corta (−)' },
  'motor-dc': { a: 'el terminal A', b: 'el terminal B' },
  npn: { e: 'el emisor (E)', b: 'la base (B)', c: 'el colector (C)' },
  'servo-sg90': { gnd: 'el cable café (GND)', vcc: 'el cable rojo (V+)', signal: 'el cable naranja (señal)' },
  'battery-9v': { plus: 'el cable rojo (+)', minus: 'el cable negro (−)' },
  'battery-aa4': { plus: 'el cable rojo (+)', minus: 'el cable negro (−)' },
};

/** Short pin names used as context ("columna del ánodo de LED rojo"). */
const PIN_SHORT: Record<string, Record<string, string>> = {
  led: { anode: 'ánodo', cathode: 'cátodo' },
  'led-rgb': { r: 'pata roja', com: 'cátodo común', g: 'pata verde', b: 'pata azul' },
  resistor: { a: 'pata 1', b: 'pata 2' },
  ldr: { a: 'pata 1', b: 'pata 2' },
  diode: { anode: 'ánodo', cathode: 'cátodo' },
  button: { a1: 'pata A1', a2: 'pata A2', b1: 'pata B1', b2: 'pata B2' },
  'switch-slide': { a: 'pata A', com: 'común', b: 'pata B' },
  potentiometer: { a: 'extremo 1', wiper: 'cursor', b: 'extremo 2' },
  buzzer: { plus: '+', minus: '−' },
  'motor-dc': { a: 'terminal A', b: 'terminal B' },
  npn: { e: 'emisor', b: 'base', c: 'colector' },
  'servo-sg90': { gnd: 'GND', vcc: 'V+', signal: 'señal' },
  'battery-9v': { plus: '+', minus: '−' },
  'battery-aa4': { plus: '+', minus: '−' },
};

export function pinLong(def: PartDef, pinId: string): string {
  const t = PIN_LONG[def.type]?.[pinId];
  if (t) return t;
  const pin = def.pins.find((p) => p.id === pinId);
  return pin ? `la pata «${pin.label}»` : pinId;
}

export function pinShort(def: PartDef, pinId: string): string {
  return PIN_SHORT[def.type]?.[pinId] ?? def.pins.find((p) => p.id === pinId)?.label ?? pinId;
}

const BAND = ['negro', 'café', 'rojo', 'naranja', 'amarillo', 'verde', 'azul', 'violeta', 'gris', 'blanco'];

/** Colour bands of a 4-band resistor: 220 → ['rojo','rojo','café','dorado']. */
export function resistorBands(ohms: number): string[] | null {
  if (!Number.isFinite(ohms) || ohms < 10) return null;
  let v = ohms;
  let exp = 0;
  while (v >= 100) {
    v /= 10;
    exp++;
  }
  v = Math.round(v);
  if (v >= 100) {
    v /= 10;
    exp++;
  }
  if (exp > 9) return null;
  return [BAND[Math.floor(v / 10)], BAND[v % 10], BAND[exp], 'dorado'];
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** "el LED rojo", "la resistencia R1 de 220 Ω", "el potenciómetro (Perilla)". */
export function partPhrase(part: PartInstance, def: PartDef): string {
  const noun = NOUNS[def.type] ?? `«${def.name}»`;
  if (def.type === 'led') {
    const color = LED_COLOR_ES[String(propValue(part, 'color', def))] ?? '';
    const base = `el LED${color ? ` ${color}` : ''}`;
    return norm(part.label).includes(norm(color || 'led')) ? base : `${base} (${part.label})`;
  }
  if (def.type === 'resistor') {
    const ohms = Number(propValue(part, 'resistance', def));
    return `la resistencia ${part.label} de ${formatOhms(ohms)}`;
  }
  const bare = norm(noun.replace(/^(el|la|los|las)\s+/, ''));
  const label = norm(part.label.replace(/\s*\d+$/, ''));
  return !label || bare.includes(label) || label === norm(def.defaultLabel) ? noun : `${noun} (${part.label})`;
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "a, b y c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

export function partTip(part: PartInstance, def: PartDef): string | undefined {
  switch (def.type) {
    case 'led':
      return 'La pata larga va hacia el + (o hacia el pin que lo enciende). Si queda al revés no se daña, pero no enciende.';
    case 'led-rgb':
      return 'La pata más larga es el cátodo común y va a GND. Cada color necesita su propia resistencia.';
    case 'resistor': {
      const bands = resistorBands(Number(propValue(part, 'resistance', def)));
      return `${bands ? `Sus franjas de color: ${joinList(bands)}. ` : ''}No tiene polaridad: da igual hacia qué lado la pongas.`;
    }
    case 'diode':
      return 'La franja plateada marca el cátodo (−). Al revés, el diodo no deja pasar la corriente.';
    case 'button':
      return 'Debe quedar a caballo sobre el canal central: así las patas A y B quedan en columnas distintas y solo se unen al presionar.';
    case 'switch-slide':
      return 'La pata central es la común: se une con A o con B según la posición de la palanca.';
    case 'potentiometer':
      return 'La pata del centro es el cursor: su voltaje cambia al girar la perilla.';
    case 'ldr':
      return 'No tiene polaridad. Su resistencia baja cuando le llega más luz.';
    case 'buzzer':
      return 'La pata larga (+) va hacia el pin que genera el tono.';
    case 'npn':
      return 'Fíjate en las letras E, B y C: cada pata va en su propia columna. La base controla la corriente entre colector y emisor.';
    case 'servo-sg90':
      return 'El conector tiene tres cables: café (GND), rojo (V+) y naranja (señal).';
    case 'motor-dc':
      return 'El motor consume mucha corriente: nunca lo conectes directo a un pin de la placa.';
    case 'battery-9v':
    case 'battery-aa4':
      return 'En un circuito real, conecta la batería al final, cuando todo esté revisado.';
    default:
      return def.education?.tips?.[0];
  }
}
