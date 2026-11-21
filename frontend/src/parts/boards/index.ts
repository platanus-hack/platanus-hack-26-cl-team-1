/**
 * ART AGENT (boards & power): renderers for the boards, the breadboard and the batteries.
 * Types: arduino-uno, esp32c6-devkit, breadboard-half, battery-9v, battery-aa4
 *
 * Board renderers draw their onboard indicators from props.sim?.onboard
 * ({ power, led (Uno 'L' 0..1), rgb (ESP32-C6 WS2812, 0..1) }); unlit when undefined.
 */
import type { PartRenderer } from '../types';
import { ArduinoUno } from './ArduinoUno';
import { Battery9V } from './Battery9V';
import { BatteryAA4 } from './BatteryAA4';
import { BreadboardHalf } from './Breadboard';
import { Esp32C6DevKit } from './Esp32C6DevKit';

export const boardRenderers: Record<string, PartRenderer> = {
  'arduino-uno': ArduinoUno,
  'esp32c6-devkit': Esp32C6DevKit,
  'breadboard-half': BreadboardHalf,
  'battery-9v': Battery9V,
  'battery-aa4': BatteryAA4,
};
