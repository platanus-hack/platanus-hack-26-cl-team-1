/**
 * InterpreterHost implementation shared by the live runtime and runHeadless.
 * Writes go to a DriveBank; reads ask the owner for an up-to-date solve
 * (the owner re-solves synchronously when drives/runtime changed).
 */
import type { BoardProfile, CircuitResult, Id } from '@/contracts';
import type { InterpreterHost } from '@/program/interpreter';
import { DriveBank, readAnalogPin, readDigitalPin } from './drives';

export interface DriveHostOptions {
  /** Canonicalizes board pin ids (SDA → A4). Identity by default. */
  canon?: (pin: string) => string;
  /** Returns a solve that reflects the CURRENT drives/runtime (solving first if needed). */
  freshResult: () => CircuitResult | null;
  board: BoardProfile | null;
  serial?: (text: string) => void;
  onBlock?: (blockId: string) => void;
}

export function createDriveHost(bank: DriveBank, opts: DriveHostOptions): InterpreterHost {
  const canon = opts.canon ?? ((p: string) => p);
  return {
    pinMode: (pin, mode) => bank.pinMode(canon(pin), mode),
    digitalWrite: (pin, level) => bank.digitalWrite(canon(pin), level),
    analogWrite: (pin, value) => bank.analogWrite(canon(pin), value),
    tone: (pin, freq) => bank.tone(canon(pin), freq),
    noTone: (pin) => bank.noTone(canon(pin)),
    servoWrite: (part: Id, angle) => bank.servoWrite(part, angle),
    onboardRgb: (r, g, b) => bank.setOnboardRgb(r, g, b),
    serial: (text) => opts.serial?.(String(text)),
    digitalRead: (pin) => {
      const p = canon(pin);
      return readDigitalPin(opts.freshResult(), p, bank.drives[p]);
    },
    analogRead: (pin) => {
      const p = canon(pin);
      return readAnalogPin(opts.freshResult(), p, opts.board, bank.drives[p]);
    },
    onBlock: (id) => opts.onBlock?.(id),
  };
}
