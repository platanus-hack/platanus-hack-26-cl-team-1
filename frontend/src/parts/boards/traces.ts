/**
 * Decorative copper traces under the soldermask (one cached path per board).
 * Purely visual: routed around the labels, the chip and the header labels.
 */
import { circlesPath, polylinesPath, type Pt } from './layout';

let cached: string | null = null;

const p = (x: number, y: number): Pt => ({ x, y });

export function unoTraces(): string {
  if (cached) return cached;
  const lines: Pt[][] = [];
  const vias: Pt[] = [];

  // D0..D4 bus: chip top-row pins 2..6 up to the right-hand digital header.
  for (let k = 0; k < 5; k++) {
    const cx = 24.5 - k;
    const hx = 26 - k;
    lines.push([p(cx, 12.3), p(cx, 8.0), p(hx, 6.5), p(hx, 4.7)]);
  }
  // D8..D11 header → vias above the "UNO" mark (clear of the LED resistor traces).
  for (let x = 14; x <= 17; x++) {
    const k = x - 14;
    lines.push([p(x, 3.45), p(x, 7.0 - k * 0.2), p(x - 0.5, 7.5 - k * 0.2)]);
    vias.push(p(x - 0.5, 7.5 - k * 0.2));
  }
  // USB data / power into the 16U2.
  for (const y of [5.0, 5.6, 6.2]) lines.push([p(4.75, y), p(5.95, y)]);
  // Crystal → 16U2.
  lines.push([p(6.3, 7.62), p(6.3, 6.65)], [p(7.7, 7.62), p(7.7, 6.65)]);
  // 16U2 → LED resistors.
  lines.push([p(8.15, 5.0), p(8.8, 5.0)], [p(8.15, 6.2), p(8.8, 6.4)], [p(9.1, 7.0), p(9.1, 7.6), p(10.4, 8.9), p(10.4, 10.7)]);
  // LEDs → series resistors → header side.
  for (const y of [4.5, 5.5, 6.5]) lines.push([p(11.42, y), p(12.15, y)], [p(12.85, y), p(13.4, y)]);
  // Barrel jack → caps → regulator.
  lines.push([p(5.05, 16.1), p(6.0, 16.1), p(6.5, 15.6), p(6.5, 14.1)]);
  lines.push([p(5.05, 17.6), p(6.6, 17.6), p(7.0, 17.9)]);
  lines.push([p(8.75, 14.1), p(8.75, 15.2), p(9.3, 15.75), p(9.3, 18.2), p(9.0, 18.6)]);
  // SOIC / fuse area.
  lines.push([p(2.6, 9.95), p(2.6, 10.45)], [p(3.9, 10.5), p(4.6, 9.8), p(5.05, 9.8)]);
  lines.push([p(2.4, 12.15), p(2.4, 13.2)], [p(3.4, 12.15), p(3.4, 13.25)]);
  vias.push(p(10.4, 10.7), p(9.0, 18.6), p(13.4, 4.5), p(13.4, 5.5), p(13.4, 6.5));

  cached = polylinesPath(lines) + circlesPath(vias, 0.14);
  return cached;
}

let espCached: string | null = null;

/** Faint traces on the ESP32-C6 DevKit's black soldermask (one cached path). */
export function espTraces(): string {
  if (espCached) return espCached;
  const lines: Pt[][] = [
    // USB-UART receptacle → CP2102N
    [p(2.65, 2.5), p(6.9, 2.5), p(7.2, 2.8)],
    // CP2102N → module UART pads
    [p(8.45, 3.5), p(10.75, 3.5), p(11.3, 3.3)],
    [p(8.45, 4.2), p(10.75, 4.2), p(11.3, 3.85)],
    // RGB LED data (GPIO8)
    [p(10.55, 5.5), p(11.3, 5.5)],
    // LDO → module 3V3
    [p(8.4, 7.4), p(10.75, 7.4), p(11.3, 7.15)],
    // native USB → module (GPIO12/13)
    [p(2.65, 8.5), p(10.6, 8.5)],
    [p(2.65, 8.1), p(3.2, 8.1)],
    // BOOT / RST nets
    [p(5.5, 3.2), p(6.2, 3.2), p(6.45, 3.45)],
    [p(5.5, 7.8), p(5.75, 7.8), p(5.75, 8.5)],
    // PWR LED
    [p(6.6, 5.6), p(6.75, 5.6)],
    [p(5.8, 5.6), p(5.4, 5.6), p(5.4, 6.0)],
  ];
  const vias = [p(10.6, 8.5), p(5.4, 6.0), p(3.2, 8.1), p(9.3, 5.0), p(1.4, 4.95), p(1.4, 6.05)];
  espCached = polylinesPath(lines) + circlesPath(vias, 0.13);
  return espCached;
}
