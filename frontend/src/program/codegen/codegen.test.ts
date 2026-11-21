import { describe, expect, it } from 'vitest';
import { generateCode } from './index';
import { bin, bool, delay, ir, led, makeCtx, num, print, set, str, v } from './testkit';

const blinkIR = ir({
  loop: [led('led1', true, 'b1'), delay(500, 'b2'), led('led1', false, 'b3'), delay(500, 'b4')],
});

describe('generateCode', () => {
  it('blink on the Uno', () => {
    const ctx = makeCtx('uno', [{ id: 'led1', type: 'led', label: 'LED 1' }, { id: 'r1', type: 'resistor', label: 'R1' }], [
      { part: 'led1', boardPin: 'D13', via: ['r1'] },
    ], 'Parpadeo');
    const res = generateCode(blinkIR, ctx);
    expect(res.code).toMatchSnapshot();
    expect(res.code).toContain('// Circuito Vivo — Parpadeo — Arduino Uno R3');
    expect(res.code).toContain('// LED 1 → pin 13 (a través de R1)');
    expect(res.code).toContain('const int LED_1 = 13;');
    expect(res.code).toMatch(/pinMode\(LED_1, OUTPUT\);/);
    expect(res.code).toContain('digitalWrite(LED_1, HIGH);');
    expect(res.code).not.toContain('Servo');
    expect(res.code).not.toContain('Serial');
    expect(res.warnings).toEqual([]);
    const lines = res.code.split('\n');
    const on = lines.findIndex((l) => l.includes('digitalWrite(LED_1, HIGH)')) + 1;
    expect(res.lineMap[on]).toBe('b1');
    expect(lines[on - 1].startsWith('  digitalWrite')).toBe(true);
  });

  it('blink on the ESP32-C6', () => {
    const ctx = makeCtx('esp32c6', [{ id: 'led1', type: 'led', label: 'LED 1' }, { id: 'r1', type: 'resistor', label: 'R1' }], [
      { part: 'led1', boardPin: 'GPIO4', via: ['r1'] },
    ], 'Parpadeo');
    const res = generateCode(blinkIR, ctx);
    expect(res.code).toMatchSnapshot();
    expect(res.code).toContain('— ESP32-C6-DevKitC-1');
    expect(res.code).toContain('// LED 1 → GPIO4 (a través de R1)');
    expect(res.code).toContain('const int LED_1 = 4;');
  });

  it('traffic light with three LEDs and a counter', () => {
    const parts = [
      { id: 'led1', type: 'led', label: 'Rojo' },
      { id: 'led2', type: 'led', label: 'Amarillo' },
      { id: 'led3', type: 'led', label: 'Verde' },
    ];
    const ctx = makeCtx('uno', parts, [
      { part: 'led1', boardPin: 'D12' },
      { part: 'led2', boardPin: 'D11' },
      { part: 'led3', boardPin: 'D10' },
    ], 'Semáforo');
    const program = ir({
      variables: [{ name: 'ciclos', type: 'number' }],
      loop: [
        led('led1', true, 'r_on'),
        delay(3000),
        led('led1', false),
        led('led3', true),
        delay(2500),
        led('led3', false),
        { k: 'repeat', id: 'blinkY', times: num(3), body: [led('led2', true), delay(250), led('led2', false), delay(250)] },
        { k: 'change', var: 'ciclos', delta: num(1) },
        print(str('Ciclos: '), false),
        print(v('ciclos')),
      ],
    });
    const res = generateCode(program, ctx);
    expect(res.code).toMatchSnapshot();
    expect(res.code).toContain('const int ROJO = 12;');
    expect(res.code).toContain('for (int i = 0; i < 3; i++) {');
    expect(res.code).toContain('Serial.begin(9600);');
    expect(res.code).toContain('ciclos++;');
    expect(res.code).toContain('cvPrintln(ciclos);');
    expect(res.code).toContain('double ciclos = 0;');
  });

  it('button with INPUT_PULLUP (active low)', () => {
    const ctx = makeCtx('uno', [{ id: 'btn1', type: 'button', label: 'Botón 1' }, { id: 'led1', type: 'led', label: 'LED 1' }], [
      { part: 'btn1', boardPin: 'D2', pin: 'a1', mode: 'INPUT_PULLUP', activeLow: true },
      { part: 'led1', boardPin: 'D13' },
    ]);
    const program = ir({
      loop: [
        { k: 'if', id: 'if1', branches: [{ cond: { k: 'buttonPressed', part: 'btn1' }, body: [led('led1', true)] }], else: [led('led1', false)] },
        { k: 'if', branches: [{ cond: { k: 'buttonClicked', part: 'btn1' }, body: [print(str('¡Clic!'))] }] },
      ],
    });
    const res = generateCode(program, ctx);
    expect(res.code).toMatchSnapshot();
    expect(res.code).toContain('pinMode(BOTON_1, INPUT_PULLUP);');
    expect(res.code).toContain('if (digitalRead(BOTON_1) == LOW) {');
    expect(res.code).toContain('bool clicked_BOTON_1() {');
    expect(res.code).toContain('millis() - lastChange >= 30');
  });

  it('servo + potentiometer (include, attach, cv_map)', () => {
    const ctx = makeCtx('uno', [{ id: 'pot1', type: 'potentiometer', label: 'Potenciómetro 1' }, { id: 'servo1', type: 'servo-sg90', label: 'Servo 1' }], [
      { part: 'pot1', boardPin: 'A0', pin: 'wiper', mode: 'ANALOG' },
      { part: 'servo1', boardPin: 'D9', pin: 'signal' },
    ]);
    const program = ir({
      variables: [{ name: 'ángulo', type: 'number' }],
      loop: [
        set('ángulo', { k: 'map', value: { k: 'potPercent', part: 'pot1' }, fromLow: num(0), fromHigh: num(100), toLow: num(0), toHigh: num(180) }),
        { k: 'servo', part: 'servo1', angle: v('ángulo'), id: 's1' },
        print(v('ángulo')),
        delay(15),
      ],
    });
    const res = generateCode(program, ctx);
    expect(res.code).toMatchSnapshot();
    expect(res.code).toContain('#include <Servo.h>');
    expect(res.code).toContain('Servo servo1;');
    expect(res.code).toContain('servo1.attach(SERVO_1);');
    expect(res.code).toContain('angulo = cv_map(cv_percent(analogRead(POTENCIOMETRO_1)), 0, 100, 0, 180);');
    expect(res.code).toContain('servo1.write(constrain(angulo, 0, 180));');
    expect(res.code).toContain('return round(raw * 100.0 / 1023);');
    expect(res.code).not.toMatch(/pinMode\(POTENCIOMETRO_1/);
  });

  it('servo on the ESP32 uses ESP32Servo', () => {
    const ctx = makeCtx('esp32c6', [{ id: 'servo1', type: 'servo-sg90', label: 'Servo 1' }], [{ part: 'servo1', boardPin: 'GPIO5', pin: 'signal' }]);
    const res = generateCode(ir({ loop: [{ k: 'servo', part: 'servo1', angle: num(200) }] }), ctx);
    expect(res.code).toContain('#include <ESP32Servo.h>');
    expect(res.code).toContain('servo1.write(180);');
  });

  it('RGB LED + onboard RGB on the ESP32-C6', () => {
    const ctx = makeCtx('esp32c6', [{ id: 'rgb1', type: 'led-rgb', label: 'LED RGB 1' }], [
      { part: 'rgb1', boardPin: 'GPIO4', pin: 'r', channel: 'r' },
      { part: 'rgb1', boardPin: 'GPIO5', pin: 'g', channel: 'g' },
      { part: 'rgb1', boardPin: 'GPIO6', pin: 'b', channel: 'b' },
    ]);
    const program = ir({
      variables: [{ name: 'azul', type: 'number', init: 128 }],
      loop: [
        { k: 'rgb', part: 'rgb1', r: num(255), g: num(0), b: v('azul'), id: 'c1' },
        { k: 'onboardRgb', r: num(0), g: num(0), b: num(255) },
        delay(500),
        { k: 'onboardLed', on: bool(false) },
        delay(500),
      ],
    });
    const res = generateCode(program, ctx);
    expect(res.code).toMatchSnapshot();
    expect(res.code).toContain('analogWrite(LED_RGB_1_R, 255);');
    expect(res.code).toContain('analogWrite(LED_RGB_1_B, cv_pwm(azul));');
    expect(res.code).toContain('rgbLedWrite(RGB_BUILTIN, 0, 0, 255);');
    expect(res.code).toContain('rgbLedWrite(RGB_BUILTIN, 0, 0, 0);');
    expect(res.code).toContain('double azul = 128;');
    expect(res.warnings).toEqual([]);
  });

  it('unbound part → warning + comment, code still valid', () => {
    const ctx = makeCtx('uno', [{ id: 'led1', type: 'led', label: 'LED 1' }, { id: 'led2', type: 'led', label: 'LED 2' }], [
      { part: 'led1', boardPin: 'D13' },
      { part: 'led2', boardPin: null },
    ]);
    const res = generateCode(ir({ loop: [led('led1', true), led('led2', true, 'x2'), delay(100)] }), ctx);
    expect(res.code).toMatchSnapshot();
    expect(res.code).toContain('// ⚠ LED 2 no está conectado a un pin');
    expect(res.code).not.toContain('LED_2');
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatchObject({ blockId: 'x2', part: 'led2' });
    const line = res.code.split('\n').findIndex((l) => l.includes('⚠ LED 2')) + 1;
    expect(res.lineMap[line]).toBe('x2');
  });

  it('numeric model: real division, fmod, int promotion, for both ways', () => {
    const ctx = makeCtx('uno', [], []);
    const program = ir({
      variables: [{ name: 'x', type: 'number' }, { name: 'listo', type: 'boolean' }],
      setup: [
        set('x', bin('/', num(7), num(2))),
        set('x', bin('/', v('x'), v('x'))),
        set('x', bin('%', v('x'), num(3))),
        set('x', bin('*', { k: 'analogRead', pin: 'A0' }, num(100))),
        set('x', bin('-', { k: 'millis' }, num(5000))),
        set('listo', bin('&&', bin('>', v('x'), num(3)), bin('||', bool(true), bool(false)))),
        { k: 'for', var: 'i', from: num(10), to: num(1), by: num(2), body: [print(v('i'))] },
        { k: 'for', var: 'i', from: num(1), to: v('x'), by: num(1), body: [{ k: 'break' }] },
        print(v('listo')),
        { k: 'digitalWrite', pin: 'D7', value: v('listo') },
      ],
    });
    const res = generateCode(program, ctx);
    expect(res.code).toMatchSnapshot();
    expect(res.code).toContain('x = 7 / 2.0;');
    expect(res.code).toContain('x = cv_div(x, x);');
    expect(res.code).toContain('x = fmod(x, 3);');
    expect(res.code).toContain('x = analogRead(A0) * 100.0;');
    expect(res.code).toContain('x = millis() - 5000.0;');
    expect(res.code).toContain('listo = x > 3 && (true || false);');
    expect(res.code).toContain('for (i = 10; i >= 1; i -= 2) {');
    expect(res.code).toContain('double i = 0;');
    expect(res.code).toContain('pinMode(7, OUTPUT);');
    expect(res.warnings.some((w) => w.message.includes('pinMode(7, OUTPUT)'))).toBe(true);
  });

  it('functions get prototypes and calls', () => {
    const ctx = makeCtx('uno', [{ id: 'led1', type: 'led', label: 'LED 1' }], [{ part: 'led1', boardPin: 'D13' }]);
    const program = ir({
      functions: [{ name: 'parpadear', id: 'f1', body: [led('led1', true), delay(100), led('led1', false)] }],
      loop: [{ k: 'call', name: 'parpadear', id: 'c1' }, { k: 'call', name: 'noExiste' }, delay(1000)],
    });
    const res = generateCode(program, ctx);
    expect(res.code).toContain('void parpadear();');
    expect(res.code).toContain('  parpadear();');
    expect(res.code).toContain('void parpadear() {');
    expect(res.code).toContain('// ⚠ La función noExiste no existe');
    const sig = res.code.split('\n').indexOf('void parpadear() {') + 1;
    expect(res.lineMap[sig]).toBe('f1');
  });

  it('ESP32: digital writes on a pin that also uses PWM become analogWrite 0/255', () => {
    const ctx = makeCtx('esp32c6', [{ id: 'led1', type: 'led', label: 'LED 1' }, { id: 'led2', type: 'led', label: 'LED 2' }], [
      { part: 'led1', boardPin: 'GPIO4' },
      { part: 'led2', boardPin: 'GPIO5' },
    ]);
    const program = ir({ loop: [led('led1', true), { k: 'ledBrightness', part: 'led1', percent: num(50) }, led('led2', v('x'))] });
    const res = generateCode(program, ctx);
    expect(res.code).toContain('analogWrite(LED_1, 255);');
    expect(res.code).toContain('analogWrite(LED_1, 128);');
    expect(res.code).toContain('digitalWrite(LED_2, x ? HIGH : LOW);');
    // The Uno keeps digitalWrite (the AVR core turns PWM off by itself).
    const uno = generateCode(program, makeCtx('uno', [{ id: 'led1', type: 'led', label: 'LED 1' }], [{ part: 'led1', boardPin: 'D9' }]));
    expect(uno.code).toContain('digitalWrite(LED_1, HIGH);');
  });

  it('empty program still produces a valid sketch', () => {
    const res = generateCode(ir({}), makeCtx(null, [], []));
    expect(res.code).toContain('void setup() {');
    expect(res.code).toContain('void loop() {');
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});
