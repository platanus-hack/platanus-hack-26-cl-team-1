// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as Blockly from 'blockly';
import { buildToolbox, NO_BOARD_HINT, registerBlocks } from './index';
import type { ToolboxCategory, ToolboxDef } from './toolbox';
import { makeCtx, part } from './testutil';
import { partOptions, pinOptions, pinsForFilter } from './options';
import { getBoardProfile } from '@/catalog';

const names = (tb: ToolboxDef) => tb.contents.map((c) => c.name);
const cat = (tb: ToolboxDef, name: string) => tb.contents.find((c) => c.name === name) as ToolboxCategory;
const types = (c: ToolboxCategory | undefined) => (c?.contents ?? []).flatMap((i) => (i.kind === 'block' ? [i.type] : []));

describe('buildToolbox', () => {
  it('shows only basic categories and a hint when there is no board', () => {
    const tb = buildToolbox(makeCtx({ board: null, parts: [part('led1', 'led', 'LED 1')] }));
    expect(names(tb)).toEqual(['Eventos', 'Control', 'Lógica', 'Matemáticas', 'Variables', 'Funciones', 'Placa']);
    expect(cat(tb, 'Placa').contents).toEqual([expect.objectContaining({ kind: 'label', text: NO_BOARD_HINT })]);
  });

  it('has no part categories when the project has no parts', () => {
    const tb = buildToolbox(makeCtx());
    expect(names(tb)).toEqual(['Eventos', 'Control', 'Lógica', 'Matemáticas', 'Variables', 'Funciones', 'Pines', 'Placa', 'Comunicación']);
    expect(types(cat(tb, 'Placa'))).toEqual(['cv_onboard_led']);
  });

  it('adds part categories and blocks only for present part types', () => {
    const tb = buildToolbox(makeCtx({ parts: [part('led2', 'led', 'LED rojo'), part('btn1', 'button', 'Botón 1'), part('servo1', 'servo-sg90', 'Servo')] }));
    expect(names(tb)).toContain('LEDs');
    expect(names(tb)).toContain('Entradas');
    expect(names(tb)).toContain('Movimiento');
    expect(names(tb)).not.toContain('Sonido');
    expect(types(cat(tb, 'LEDs'))).toEqual(['cv_led', 'cv_led_brightness']);
    expect(types(cat(tb, 'Entradas'))).toEqual(['cv_button_pressed', 'cv_button_clicked']);
    expect(types(cat(tb, 'Movimiento'))).toEqual(['cv_servo']);
    const led = cat(tb, 'LEDs').contents!.find((i) => i.kind === 'block' && i.type === 'cv_led');
    expect(led).toMatchObject({ fields: { PART: 'led2' } });
  });

  it('analog raw value is offered for potentiometers and LDRs', () => {
    const tb = buildToolbox(makeCtx({ parts: [part('ldr1', 'ldr', 'LDR 1')] }));
    expect(types(cat(tb, 'Entradas'))).toEqual(['cv_light_percent', 'cv_analog_raw']);
  });

  it('the ESP32-C6 board category includes the onboard RGB LED', () => {
    const tb = buildToolbox(makeCtx({ board: 'esp32c6', parts: [part('bz1', 'buzzer', 'Zumbador')] }));
    expect(types(cat(tb, 'Placa'))).toEqual(['cv_onboard_led', 'cv_onboard_rgb']);
    expect(types(cat(tb, 'Sonido'))).toEqual(['cv_buzzer_tone_ms', 'cv_buzzer_tone', 'cv_buzzer_off', 'cv_note']);
  });

  it('every toolbox block type is registered and loads in a headless workspace', () => {
    registerBlocks();
    const tb = buildToolbox(makeCtx({ board: 'esp32c6', parts: ['led', 'led-rgb', 'button', 'switch-slide', 'potentiometer', 'ldr', 'buzzer', 'servo-sg90', 'motor-dc'].map((t, i) => part(`p${i}`, t, `P${i}`)) }));
    const ws = new Blockly.Workspace();
    try {
      for (const c of tb.contents) {
        for (const item of c.contents ?? []) {
          if (item.kind !== 'block') continue;
          expect(Blockly.Blocks[item.type], item.type).toBeTruthy();
          const { kind: _kind, ...state } = item;
          Blockly.serialization.blocks.append(state as Blockly.serialization.blocks.State, ws);
        }
      }
      expect(ws.getAllBlocks(false).length).toBeGreaterThan(40);
    } finally {
      ws.dispose();
    }
  });
});

describe('dropdown options', () => {
  const uno = getBoardProfile('uno');

  it('generic pin lists use canonical pins filtered by capability', () => {
    const digital = pinsForFilter(uno, 'digital').map((p) => p.id);
    expect(digital).toContain('D13');
    expect(digital).toContain('A4');
    expect(digital).not.toContain('SDA'); // alias of A4
    expect(pinsForFilter(uno, 'pwm').map((p) => p.id)).toEqual(['D11', 'D10', 'D9', 'D6', 'D5', 'D3']);
    expect(pinsForFilter(uno, 'analog').map((p) => p.id)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
    expect(pinOptions(uno, 'pwm', 'D9')).toContainEqual(['~9', 'D9']);
  });

  it('always includes the current value, marked when missing', () => {
    expect(pinOptions(uno, 'pwm', 'D2')[0]).toEqual(['2 (no compatible)', 'D2']);
    expect(pinOptions(uno, 'digital', 'GPIO4')[0]).toEqual(['(falta) GPIO4', 'GPIO4']);
    expect(pinOptions(null, 'digital', null)).toEqual([['(sin placa)', '']]);
    const ctx = makeCtx({ parts: [part('led1', 'led', 'LED 1')] });
    expect(partOptions(ctx, 'led', 'led2')).toEqual([
      ['(falta) led2', 'led2'],
      ['LED 1', 'led1'],
    ]);
    expect(partOptions(ctx, 'servo', null)).toEqual([['(sin componentes)', '']]);
  });
});
