/** Test fixture: a program that touches every IR node kind (compile + interpreter smoke tests). */
import type { BoardId, ProgramIR } from '@/contracts';
import { bin, bool, delay, ir, led, makeCtx, num, print, set, str, v } from './testkit';

export function kitchenSink(board: BoardId, withServo: boolean): { ir: ProgramIR; ctx: ReturnType<typeof makeCtx> } {
  const uno = board === 'uno';
  const parts = [
    { id: 'led1', type: 'led', label: 'LED 1' },
    { id: 'led2', type: 'led', label: 'LED hundido' },
    { id: 'rgb1', type: 'led-rgb', label: 'LED RGB 1' },
    { id: 'bz1', type: 'buzzer', label: 'Zumbador 1' },
    { id: 'm1', type: 'motor-dc', label: 'Motor 1' },
    { id: 'btn1', type: 'button', label: 'Botón 1' },
    { id: 'sw1', type: 'switch-slide', label: 'Interruptor 1' },
    { id: 'pot1', type: 'potentiometer', label: 'Potenciómetro 1' },
    { id: 'ldr1', type: 'ldr', label: 'LDR 1' },
    { id: 'servo1', type: 'servo-sg90', label: 'Servo 1' },
    { id: 'led9', type: 'led', label: 'LED suelto' },
  ];
  const P = (u: string, e: string) => (uno ? u : e);
  const ctx = makeCtx(board, parts, [
    { part: 'led1', boardPin: P('D13', 'GPIO10') },
    { part: 'led2', boardPin: P('D12', 'GPIO11'), activeLow: true, pin: 'cathode' },
    { part: 'rgb1', boardPin: P('D3', 'GPIO18'), channel: 'r', pin: 'r' },
    { part: 'rgb1', boardPin: P('D5', 'GPIO19'), channel: 'g', pin: 'g' },
    { part: 'rgb1', boardPin: P('D6', 'GPIO20'), channel: 'b', pin: 'b' },
    { part: 'bz1', boardPin: P('D8', 'GPIO21'), pin: 'plus' },
    { part: 'm1', boardPin: P('D10', 'GPIO22'), pin: 'a', driver: 'npn', via: ['q1', 'r2'] },
    { part: 'btn1', boardPin: P('D2', 'GPIO23'), pin: 'a1', mode: 'INPUT_PULLUP', activeLow: true },
    { part: 'sw1', boardPin: P('D4', 'GPIO15'), pin: 'com', mode: 'INPUT_PULLUP', activeLow: true },
    { part: 'pot1', boardPin: P('A0', 'GPIO0'), pin: 'wiper', mode: 'ANALOG' },
    { part: 'ldr1', boardPin: P('A1', 'GPIO1'), pin: 'a', mode: 'ANALOG', invert: true },
    { part: 'servo1', boardPin: withServo ? P('D9', 'GPIO2') : null, pin: 'signal' },
    { part: 'led9', boardPin: null },
  ], 'Todo junto "test" \\ fin');
  const program = ir({
    variables: [
      { name: 'contador', type: 'number', init: 1.5 },
      { name: 'activo', type: 'boolean', init: true },
      { name: 'año', type: 'number' },
      { name: 'loop', type: 'number' },
    ],
    setup: [
      { k: 'pinMode', pin: P('D7', 'GPIO7'), mode: 'INPUT' },
      print(str('Hola "mundo"\n\t??(fin)')),
      { k: 'digitalWrite', pin: P('D11', 'GPIO3'), value: num(1) },
      { k: 'analogWrite', pin: P('D11', 'GPIO3'), value: bin('*', v('contador'), num(10)) },
      { k: 'tone', pin: P('D11', 'GPIO3'), freq: num(440), ms: v('contador') },
      { k: 'noTone', pin: P('D11', 'GPIO3') },
      { k: 'onboardLed', on: v('activo') },
      { k: 'onboardRgb', r: num(10), g: v('contador'), b: num(300) },
    ],
    loop: [
      led('led1', bin('>', { k: 'potPercent', part: 'pot1' }, num(50))),
      led('led2', true),
      led('led9', true),
      { k: 'ledBrightness', part: 'led1', percent: { k: 'lightPercent', part: 'ldr1' } },
      { k: 'ledBrightness', part: 'led2', percent: num(25) },
      { k: 'rgb', part: 'rgb1', r: { k: 'random', min: num(0), max: num(255) }, g: num(0), b: v('año') },
      { k: 'buzzerTone', part: 'bz1', freq: bin('+', num(200), { k: 'analogRaw', part: 'pot1' }), ms: num(100) },
      { k: 'buzzerOff', part: 'bz1' },
      { k: 'servo', part: 'servo1', angle: { k: 'map', value: { k: 'analogRaw', part: 'pot1' }, fromLow: num(0), fromHigh: num(1023), toLow: num(0), toHigh: num(180) } },
      { k: 'motor', part: 'm1', speed: { k: 'constrain', value: v('contador'), low: num(0), high: num(100) } },
      {
        k: 'if',
        branches: [
          { cond: { k: 'buttonClicked', part: 'btn1' }, body: [{ k: 'change', var: 'contador', delta: num(1) }] },
          { cond: { k: 'switchOn', part: 'sw1' }, body: [{ k: 'change', var: 'activo', delta: num(1) }] },
          { cond: { k: 'buttonPressed', part: 'btn1' }, body: [{ k: 'change', var: 'contador', delta: num(-2.5) }] },
        ],
        else: [set('activo', { k: 'not', a: v('activo') })],
      },
      { k: 'repeat', times: bin('+', v('contador'), num(1)), body: [{ k: 'repeat', times: num(2), body: [{ k: 'continue' }, { k: 'break' }] }] },
      { k: 'for', var: 'i', from: v('contador'), to: num(0), by: v('año'), body: [print(v('i'), false)] },
      { k: 'for', var: 'i', from: num(0), to: num(10), by: num(0.5), body: [] },
      { k: 'while', cond: bin('<', { k: 'millis' }, num(100)), body: [delay(1)] },
      { k: 'while', cond: v('activo'), until: true, body: [{ k: 'break' }] },
      { k: 'waitUntil', cond: bin('||', { k: 'buttonPressed', part: 'btn1' }, bool(true)) },
      set('año', bin('%', bin('/', { k: 'millis' }, v('contador')), num(7))),
      set('año', bin('-', { k: 'neg', a: v('año') }, { k: 'neg', a: num(3) })),
      set('año', { k: 'math', fn: 'sin', a: bin('+', v('año'), num(30)) }),
      set('año', bin('+', { k: 'math', fn: 'round', a: v('año') }, { k: 'math', fn: 'pow10', a: num(2) })),
      set('año', bin('*', { k: 'math', fn: 'abs', a: v('año') }, { k: 'math', fn: 'sqrt', a: num(2) })),
      set('año', bin('/', { k: 'digitalRead', pin: P('D7', 'GPIO7') }, num(0))),
      set('loop', bin('*', num(60), num(1000))),
      print(bin('==', v('año'), v('loop'))),
      print({ k: 'math', fn: 'round', a: v('año') }),
      print({ k: 'millis' }),
      print(num(3.14159)),
      print(num(42)),
      { k: 'call', name: 'mi función' },
      delay(v('año')),
      delay({ k: 'millis' }),
      { k: 'break' },
    ],
    functions: [{ name: 'mi función', body: [{ k: 'call', name: 'otra' }, delay(10)] }, { name: 'otra', body: [{ k: 'onboardLed', on: bool(true) }] }],
  });
  return { ir: program, ctx };
}
