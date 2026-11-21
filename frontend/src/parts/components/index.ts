/**
 * ART AGENT (components): register renderers here.
 * Types: led, led-rgb, resistor, diode, button, switch-slide, potentiometer,
 *        ldr, buzzer, motor-dc, npn, servo-sg90
 *
 * Interactive parts tag their actuator element with data-actuator="<propKey>"
 * (button cap → "pressed", pot rotor → "position", slide switch slider →
 * "position", LDR window → "light"); the canvas handles the pointer events.
 */
import type { PartRenderer } from '../types';
import { ButtonRenderer } from './Button';
import { BuzzerRenderer } from './Buzzer';
import { DiodeRenderer } from './Diode';
import { LdrRenderer } from './Ldr';
import { LedRenderer } from './Led';
import { LedRgbRenderer } from './LedRgb';
import { MotorDcRenderer } from './MotorDc';
import { NpnRenderer } from './Npn';
import { PotentiometerRenderer } from './Potentiometer';
import { ResistorRenderer } from './Resistor';
import { ServoSg90Renderer } from './ServoSg90';
import { SwitchSlideRenderer } from './SwitchSlide';

export const componentRenderers: Record<string, PartRenderer> = {
  led: LedRenderer,
  'led-rgb': LedRgbRenderer,
  resistor: ResistorRenderer,
  diode: DiodeRenderer,
  button: ButtonRenderer,
  'switch-slide': SwitchSlideRenderer,
  potentiometer: PotentiometerRenderer,
  ldr: LdrRenderer,
  buzzer: BuzzerRenderer,
  'motor-dc': MotorDcRenderer,
  npn: NpnRenderer,
  'servo-sg90': ServoSg90Renderer,
};

export { resistorBands, describeBands, BAND_HEX, BAND_LABEL_ES } from './resistorBands';
export type { BandColor } from './resistorBands';
export { LED_PALETTES } from './Led';
export { CAP_COLORS } from './Button';
export { potCode } from './Potentiometer';
