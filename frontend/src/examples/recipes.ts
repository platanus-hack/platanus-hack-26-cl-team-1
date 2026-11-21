/**
 * The 7 example builds. Each recipe places parts through planAddPart and
 * wires them through planConnect (via ExampleBuilder) and returns its program
 * as Block IR (null = no program).
 *
 * Electrical choices (checked against the solver's models):
 *  - LEDs always with a series resistor: 220 Ω on 5 V, 470 Ω on 9 V,
 *    100–220 Ω on 3.3 V.
 *  - Buttons go to GND and are read with INPUT_PULLUP (binding activeLow).
 *  - Motor: NPN low-side driver + 1 kΩ base resistor + flyback diode,
 *    powered by its own 4×AA pack with a common ground.
 */
import type { Expr, ProgramIR } from '@/contracts';
import { ExampleBuilder } from './builder';
import { delay, forRange, led, motor, num, program, ref, rgb, sub } from './ir';

export type Recipe = (b: ExampleBuilder) => ProgramIR | null;

/** LED + resistor driven from a board pin, cathode to the − rail. Returns the LED id. */
function ledOnPin(b: ExampleBuilder, boardPin: string, color: string, label: string, rLabel: string, ohms: number): string {
  const r = b.add('resistor', { label: rLabel, props: { resistance: ohms } });
  const l = b.add('led', { label, props: { color } });
  b.connect(boardPin, `${r}.a`);
  b.connect(`${r}.b`, `${l}.anode`);
  b.connect(`${l}.cathode`, b.rail('T-', `${l}.cathode`), 'black');
  return l;
}

const batteryLed: Recipe = (b) => {
  // Battery above the breadboard, leads right over the top rails.
  const bat = b.add('battery-9v', { label: 'Batería 9V', placement: 'free', at: { x: 6, y: -20 } });
  b.connect(`${bat}.plus`, b.rail('T+', `${bat}.plus`), 'red');
  b.connect(`${bat}.minus`, b.rail('T-', `${bat}.minus`), 'black');
  const r = b.add('resistor', { label: 'R1', props: { resistance: 470 } });
  const l = b.add('led', { label: 'LED rojo', props: { color: 'red' } });
  b.connect(`${r}.a`, b.rail('T+', `${r}.a`), 'red');
  b.connect(`${r}.b`, `${l}.anode`, 'yellow');
  b.connect(`${l}.cathode`, b.rail('T-', `${l}.cathode`), 'black');
  return null;
};

const blink: Recipe = (b) => {
  b.connect('uno1.GND1', b.rail('T-', 'uno1.GND1'), 'black');
  const l = ledOnPin(b, 'uno1.D13', 'red', 'LED rojo', 'R1', 220);
  return program('uno', { loop: [led(l, true), delay(500), led(l, false), delay(500)] });
};

const trafficLight: Recipe = (b) => {
  b.connect('uno1.GND1', b.rail('T-', 'uno1.GND1'), 'black');
  const red = ledOnPin(b, 'uno1.D13', 'red', 'LED rojo', 'R1', 220);
  const yellow = ledOnPin(b, 'uno1.D12', 'yellow', 'LED amarillo', 'R2', 220);
  const green = ledOnPin(b, 'uno1.D11', 'green', 'LED verde', 'R3', 220);
  return program('uno', {
    setup: [led(red, false), led(yellow, false), led(green, false)],
    loop: [
      led(red, true), delay(3000), led(red, false),
      led(green, true), delay(3000), led(green, false),
      led(yellow, true), delay(1000), led(yellow, false),
    ],
  });
};

const buttonLed: Recipe = (b) => {
  b.connect('uno1.GND1', b.rail('T-', 'uno1.GND1'), 'black');
  const l = ledOnPin(b, 'uno1.D13', 'red', 'LED rojo', 'R1', 220);
  const btn = b.add('button', { label: 'Botón', props: { cap: 'red' } });
  b.connect('uno1.D2', `${btn}.a1`, 'green');
  b.connect(`${btn}.b1`, b.rail('T-', `${btn}.b1`), 'black');
  return program('uno', {
    loop: [
      {
        k: 'if',
        branches: [{ cond: { k: 'buttonPressed', part: btn }, body: [led(l, true)] }],
        else: [led(l, false)],
      },
    ],
  });
};

const servoPot: Recipe = (b) => {
  // 5 V/GND from the bottom header to the bottom rails, bridge + to the top rail for the servo.
  b.connect('uno1.5V', b.rail('B+', 'uno1.5V'), 'red');
  b.connect('uno1.GND2', b.rail('B-', 'uno1.GND2'), 'black');
  b.connect('uno1.GND1', b.rail('T-', 'uno1.GND1'), 'black');
  b.connect(b.hole('B+2'), b.hole('T+2'), 'red');
  // Knob in the bottom half (legs on row f, body towards the bottom rails).
  const pot = b.add('potentiometer', {
    label: 'Perilla',
    props: { resistance: 10000 },
    rotation: 180,
    at: b.originAt('potentiometer', 'a', 'f9', 180),
  });
  // b → 5V, a → GND: turning the knob up raises the voltage on A0 (no inversion).
  b.connect(`${pot}.b`, b.rail('B+', `${pot}.b`), 'red');
  b.connect(`${pot}.a`, b.rail('B-', `${pot}.a`), 'black');
  b.connect(`${pot}.wiper`, 'uno1.A0', 'yellow');
  // Servo above the breadboard, connector next to the top rails.
  const servo = b.add('servo-sg90', { label: 'Servo', placement: 'free', at: { x: 38, y: -14 } });
  b.connect(`${servo}.gnd`, b.rail('T-', `${servo}.gnd`), 'black');
  b.connect(`${servo}.vcc`, b.rail('T+', `${servo}.vcc`), 'red');
  b.connect(`${servo}.signal`, 'uno1.D9', 'orange');
  return program('uno', {
    loop: [
      {
        k: 'servo',
        part: servo,
        angle: { k: 'map', value: { k: 'potPercent', part: pot }, fromLow: num(0), fromHigh: num(100), toLow: num(0), toHigh: num(180) },
      },
      delay(15),
    ],
  });
};

const motorTransistor: Recipe = (b) => {
  b.connect('uno1.GND1', b.rail('T-', 'uno1.GND1'), 'black');
  // 4×AA pack above the breadboard: its + feeds the top + rail, its − joins the common GND rail.
  const bat = b.add('battery-aa4', { label: 'Pilas 4xAA', placement: 'free', at: { x: 35, y: -18 } });
  b.connect(`${bat}.plus`, b.rail('T+', `${bat}.plus`), 'red');
  b.connect(`${bat}.minus`, b.rail('T-', `${bat}.minus`), 'black');
  const rb = b.add('resistor', { label: 'R base', props: { resistance: 1000 } });
  const q = b.add('npn', { label: 'Transistor' });
  const d = b.add('diode', { label: 'Diodo' });
  const m = b.add('motor-dc', { label: 'Motor', placement: 'free', at: { x: 51, y: -15 } });
  b.connect('uno1.D9', `${rb}.a`, 'yellow');
  b.connect(`${rb}.b`, `${q}.b`, 'green');
  b.connect(`${q}.e`, b.rail('T-', `${q}.e`), 'black');
  b.connect(`${m}.a`, b.rail('T+', `${m}.a`), 'red');
  b.connect(`${m}.b`, `${q}.c`, 'blue');
  // Flyback diode across the motor: cathode to +, anode to the collector.
  b.connect(`${d}.cathode`, b.rail('T+', `${d}.cathode`), 'red');
  b.connect(`${d}.anode`, `${q}.c`, 'white');
  return program('uno', {
    loop: [motor(m, 100), delay(2000), motor(m, 40), delay(2000), motor(m, 0), delay(1500)],
  });
};

const rgbEsp32: Recipe = (b) => {
  // The devkit straddles columns 1–20 and covers rows c–j there, so its bottom
  // header (J3) has no free hole left: GND and the three GPIOs come from J1,
  // through the free holes a/b of their column (planConnect picks them).
  b.connect('esp1.GND1', b.rail('B-', 'esp1.GND1'), 'black');
  // RGB LED right of the devkit (r, com, g, b on b21..b24).
  const led = b.add('led-rgb', { label: 'LED RGB', at: b.originAt('led-rgb', 'r', 'b21') });
  // One resistor per colour, standing across the centre channel (e → g).
  const rB = b.add('resistor', { label: 'R azul', props: { resistance: 100 }, rotation: 90, at: b.originAt('resistor', 'a', 'e26', 90) });
  const rG = b.add('resistor', { label: 'R verde', props: { resistance: 100 }, rotation: 90, at: b.originAt('resistor', 'a', 'e28', 90) });
  const rR = b.add('resistor', { label: 'R rojo', props: { resistance: 220 }, rotation: 90, at: b.originAt('resistor', 'a', 'e30', 90) });
  b.connect(`${led}.com`, b.rail('B-', `${led}.com`), 'black');
  b.connect(b.hole('d24'), b.hole('d26'), 'blue');
  b.connect(b.hole('c23'), b.hole('c28'), 'green');
  b.connect(b.hole('e21'), b.hole('d30'), 'orange');
  // Resistor → J1 pin: GPIO6, GPIO7 and GPIO0 (PWM, no boot/USB role).
  b.connect(`${rB}.b`, 'esp1.GPIO6', 'blue');
  b.connect(`${rG}.b`, 'esp1.GPIO7', 'green');
  b.connect(`${rR}.b`, 'esp1.GPIO0', 'orange');
  const i = ref('i');
  const step = (f: (x: Expr) => [Expr, Expr, Expr]) => forRange('i', 0, 255, 5, [rgb(led, ...f(i)), delay(15)]);
  return program('esp32c6', {
    variables: [{ name: 'i', type: 'number', init: 0 }],
    loop: [
      step((x) => [sub(num(255), x), x, num(0)]), // rojo → verde
      step((x) => [num(0), sub(num(255), x), x]), // verde → azul
      step((x) => [x, num(0), sub(num(255), x)]), // azul → rojo
    ],
  });
};

export const RECIPES: Record<string, Recipe> = {
  'battery-led': batteryLed,
  'blink-uno': blink,
  'traffic-light-uno': trafficLight,
  'button-led-uno': buttonLed,
  'servo-pot-uno': servoPot,
  'motor-transistor-uno': motorTransistor,
  'rgb-esp32c6': rgbEsp32,
};

