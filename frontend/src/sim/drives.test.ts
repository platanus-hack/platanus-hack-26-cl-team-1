import { describe, expect, it, vi } from 'vitest';
import type { CircuitResult } from '@/contracts';
import { DriveBank, readAnalogPin, readDigitalPin, sameDrive } from './drives';
import { createDriveHost } from './host';

const resultWith = (boardPins: CircuitResult['boardPins']): CircuitResult => ({
  project: {} as CircuitResult['project'],
  converged: true,
  iterations: 1,
  netVoltages: {},
  pinVoltages: {},
  wireCurrents: {},
  pinCurrents: {},
  parts: {},
  supplies: [],
  boardPins,
  shorts: [],
  boardPart: null,
});

describe('DriveBank host semantics (contracts/sim.ts PinDrive)', () => {
  it('analogWrite sets duty v/255 and level 1 when v > 0', () => {
    const b = new DriveBank();
    b.analogWrite('D9', 128);
    expect(b.drives.D9).toEqual({ mode: 'output', level: 1, duty: 128 / 255 });
    b.analogWrite('D9', 0);
    expect(b.drives.D9).toEqual({ mode: 'output', level: 0, duty: 0 });
  });

  it('analogWrite clamps and rounds to 0..255', () => {
    const b = new DriveBank();
    b.analogWrite('D9', 300);
    expect(b.drives.D9.duty).toBe(1);
    b.analogWrite('D9', -5);
    expect(b.drives.D9).toEqual({ mode: 'output', level: 0, duty: 0 });
    b.analogWrite('D9', 127.6);
    expect(b.drives.D9.duty).toBeCloseTo(128 / 255);
  });

  it('digitalWrite clears duty and tone', () => {
    const b = new DriveBank();
    b.analogWrite('D5', 200);
    b.digitalWrite('D5', 1);
    expect(b.drives.D5).toEqual({ mode: 'output', level: 1 });
    b.tone('D5', 440);
    b.digitalWrite('D5', 0);
    expect(b.drives.D5).toEqual({ mode: 'output', level: 0 });
  });

  it('tone(f) → level 1, duty 0.5, toneHz f; noTone → LOW output', () => {
    const b = new DriveBank();
    b.tone('D8', 880);
    expect(b.drives.D8).toEqual({ mode: 'output', level: 1, duty: 0.5, toneHz: 880 });
    b.noTone('D8');
    expect(b.drives.D8).toEqual({ mode: 'output', level: 0 });
    b.tone('D8', 0);
    expect(b.drives.D8).toEqual({ mode: 'output', level: 0 });
  });

  it('pinMode sets input modes and keeps an output level', () => {
    const b = new DriveBank();
    b.pinMode('D2', 'INPUT_PULLUP');
    expect(b.drives.D2).toEqual({ mode: 'input_pullup', level: 0 });
    b.pinMode('D2', 'INPUT');
    expect(b.drives.D2.mode).toBe('input');
    b.digitalWrite('D13', 1);
    b.pinMode('D13', 'OUTPUT');
    expect(b.drives.D13).toEqual({ mode: 'output', level: 1 });
    b.pinMode('D12', 'OUTPUT');
    expect(b.drives.D12).toEqual({ mode: 'output', level: 0 });
  });

  it('is copy-on-write and does not change refs when nothing changed', () => {
    const b = new DriveBank();
    const onChange = vi.fn();
    b.onChange = onChange;
    b.digitalWrite('D13', 1);
    const ref = b.drives;
    b.digitalWrite('D13', 1);
    expect(b.drives).toBe(ref);
    expect(onChange).toHaveBeenCalledTimes(1);
    b.digitalWrite('D13', 0);
    expect(b.drives).not.toBe(ref);
    expect(ref.D13.level).toBe(1); // old object untouched
  });

  it('servo angles clamp to 0..180 and onboard rgb [0,0,0] means off', () => {
    const b = new DriveBank();
    b.servoWrite('sv1', 200);
    expect(b.servoAngles.sv1).toBe(180);
    b.setOnboardRgb(300, 10.4, -2);
    expect(b.onboardRgb).toEqual([255, 10, 0]);
    b.setOnboardRgb(0, 0, 0);
    expect(b.onboardRgb).toBeNull();
  });

  it('reset returns every pin to high-Z (empty map)', () => {
    const b = new DriveBank();
    b.tone('D3', 440);
    b.servoWrite('s', 10);
    b.reset();
    expect(b.drives).toEqual({});
    expect(b.servoAngles).toEqual({});
    expect(b.onboardRgb).toBeNull();
  });

  it('sameDrive compares every field', () => {
    expect(sameDrive({ mode: 'output', level: 1 }, { mode: 'output', level: 1 })).toBe(true);
    expect(sameDrive({ mode: 'output', level: 1 }, { mode: 'output', level: 1, duty: 0.5 })).toBe(false);
  });
});

describe('pin reads', () => {
  it('digital reads come from the solve, with drive fallbacks', () => {
    const r = resultWith({ D2: { volts: 0, currentA: 0, digital: 0 } });
    expect(readDigitalPin(r, 'D2', { mode: 'input_pullup', level: 0 })).toBe(0);
    expect(readDigitalPin(r, 'D7', { mode: 'input_pullup', level: 0 })).toBe(1);
    expect(readDigitalPin(null, 'D7')).toBe(0);
  });

  it('analog reads use adc, else volts scaled to the board ADC', () => {
    const r = resultWith({ A0: { volts: 2.5, currentA: 0, digital: 1, adc: 511 }, A1: { volts: 2.5, currentA: 0, digital: 1 } });
    expect(readAnalogPin(r, 'A0', null)).toBe(511);
    expect(readAnalogPin(r, 'A1', null)).toBe(512);
    expect(readAnalogPin(null, 'A2', null)).toBe(0);
  });

  it('host canonicalizes pins and solves before reads', () => {
    const b = new DriveBank();
    const fresh = vi.fn(() => resultWith({ A4: { volts: 5, currentA: 0, digital: 1, adc: 1023 } }));
    const host = createDriveHost(b, { canon: (p) => (p === 'SDA' ? 'A4' : p), board: null, freshResult: fresh });
    host.digitalWrite('SDA', 1);
    expect(b.drives.A4).toEqual({ mode: 'output', level: 1 });
    expect(host.digitalRead('SDA')).toBe(1);
    expect(host.analogRead('SDA')).toBe(1023);
    expect(fresh).toHaveBeenCalledTimes(2);
  });
});
