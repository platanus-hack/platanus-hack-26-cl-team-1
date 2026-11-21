/**
 * CONTRACT 6 — Board profile format
 * ---------------------------------------------------------------------------
 * One JSON file per board in /shared/boards/<id>.json. A board is placed on
 * the canvas as a part whose PartDef has generator 'board-profile'; its pins
 * (with positions) come from here. Codegen, sim, compile and flashing read the
 * electrical/toolchain fields.
 */
import type { BoardId } from './model';

export type PinCap =
  | 'digital'
  | 'pwm'
  | 'analog'
  | 'i2c-sda'
  | 'i2c-scl'
  | 'uart-tx'
  | 'uart-rx'
  | 'spi'
  | 'strapping' // ESP32 boot pins — usable but warn
  | 'usb' // ESP32-C6 USB D+/D- — avoid
  | 'onboard-led';

export interface BoardPin {
  id: string; // unique: 'D13', 'A0', '5V', 'GND1', 'GPIO4'
  label: string; // silkscreen: '13', 'A0', '5V', 'GND', '4'
  x: number; // integer grid position relative to the board origin (unrotated)
  y: number;
  kind: 'gpio' | 'power' | 'ground' | 'reset' | 'nc' | 'aref';
  /** Identifier used in generated C code ('13', 'A0', '4'). gpio pins only. */
  codeName?: string;
  /** Numeric GPIO (ESP32) or Arduino digital number (Uno A0 = 14). */
  gpio?: number;
  caps?: PinCap[];
  /** Power pins: nominal voltage. */
  voltage?: number;
  header: string; // 'DIGITAL', 'POWER', 'ANALOG', 'J1', 'J3'
  notes?: string; // Spanish
  /**
   * Same physical pin as another BoardPin (Uno SDA→A4, SCL→A5, IOREF→5V).
   * Bindings, Net.name, CircuitInputs.drives, CircuitResult.boardPins, IR pin
   * fields and toolbox dropdowns always use the CANONICAL id (no aliasOf).
   */
  aliasOf?: string;
}

export interface BoardProfile {
  id: BoardId;
  name: string; // 'Arduino Uno R3'
  mcu: string; // 'ATmega328P'
  fqbn: string; // 'arduino:avr:uno'
  description: string; // Spanish
  logicVoltage: number; // 5 | 3.3
  vih: number; // min volts read as HIGH
  vil: number; // max volts read as LOW
  outputOhms: number; // GPIO driver output resistance (sim)
  pullupOhms: number;
  pinCurrent: { recommendedmA: number; maxmA: number };
  totalCurrentmA: number;
  adc: { bits: number; maxValue: number; vref: number };
  pwm: { maxValue: number; freqHz: number };
  /**
   * Power model: ONLY supply.rails of the ACTIVE board (catalog projectBoard)
   * are voltage sources (USB-powered, always on in the sim); GND pins are the
   * reference; IOREF/VIN/AREF/RESET/NC are passive (high-Z); a second board is
   * unpowered. A rail whose + and GND end up in the same net is a short:
   * reported in CircuitResult.shorts with currentA = volts / sourceOhms, and the
   * rest of the circuit is solved without that source.
   */
  supply: {
    usbVolts: number; // 5
    usbMaxmA: number; // polyfuse / port limit
    rails: Array<{ pin: string; volts: number; maxmA: number; sourceOhms: number; label: string }>;
  };
  /** Contact type of the board's header pins (Uno: female sockets, ESP32 devkit: male pins). */
  headerContact: 'male' | 'female';
  /** Timer conflicts (Uno: Servo disables PWM on D9/D10, tone() on D3/D11). */
  conflicts: Array<{ when: 'servo' | 'tone'; disablesPwm: string[]; message: string }>;
  /** Max simultaneous tone() outputs (Uno: 1). Omit = unlimited. */
  maxConcurrentTones?: number;
  /** Shared PWM hardware channels (ESP32-C6 LEDC: 6) used by analogWrite + tone + servos. Omit = per-pin timers. */
  maxPwmChannels?: number;
  /** What the compile worker needs. The sketch is compiled VERBATIM as sketch/sketch.ino. */
  toolchain: {
    core: 'arduino:avr' | 'esp32:esp32';
    minCoreVersion: string;
    libraries: Array<{ name: string; version?: string }>;
    /** Artifact served for flashing: '.ino.hex' (STK500, NOT with_bootloader) or '.ino.merged.bin' (esptool at 0x0). */
    artifactSuffix: '.ino.hex' | '.ino.merged.bin';
    fqbnOptions?: string;
  };
  onboard: Array<
    | { kind: 'led'; pin: string; label: string }
    | { kind: 'rgb-ws2812'; pin: string; label: string }
    | { kind: 'button'; pin: string; label: string }
  >;
  serial: { baud: number };
  upload:
    | { protocol: 'stk500v1'; baud: number; artifact: 'hex' }
    | { protocol: 'esptool'; baud: number; artifact: 'bin'; flashOffset: number; chip: string };
  libraries: { servoLib: string; servoInclude: string };
  size: { w: number; h: number }; // grid units of the board drawing
  /** Pins joined on the PCB (all GNDs, SDA=A4 on the Uno…). */
  internalBuses: string[][];
  pins: BoardPin[];
}
