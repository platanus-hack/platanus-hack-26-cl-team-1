// Keyboard map for the C172 cockpit (owner: Anaís). `KeyboardEvent.code`, so it works on any layout.
import type { Command, Inputs } from './model';

export const PRESS_KEYS: Record<string, Command> = {
  Digit1: 'toggle_master',
  Digit2: 'toggle_fuel',
  KeyM: 'toggle_mixture',
  KeyF: 'flaps_down',
  KeyR: 'flaps_up',
  KeyL: 'toggle_landing_light',
  KeyB: 'toggle_parking_brake',
};

export const HOLD_KEYS: Record<string, keyof Inputs> = {
  KeyK: 'starter',
  KeyE: 'throttleIn',
  KeyQ: 'throttleOut',
  ArrowDown: 'pitchUp', // pull the yoke back, like a joystick
  KeyS: 'pitchUp',
  ArrowUp: 'pitchDown',
  KeyW: 'pitchDown',
};

/** On-screen legend (Spanish UI copy). */
export const LEGEND: { keys: string; label: string }[] = [
  { keys: '1', label: 'Interruptor maestro' },
  { keys: '2', label: 'Selector de combustible (OFF / BOTH)' },
  { keys: 'M', label: 'Mezcla (rica / corte)' },
  { keys: 'K (mantener)', label: 'Llave a START' },
  { keys: 'F / R', label: 'Bajar / subir flaps' },
  { keys: 'L', label: 'Luz de aterrizaje' },
  { keys: 'B', label: 'Freno de estacionamiento' },
  { keys: 'E / Q (mantener)', label: 'Más / menos potencia' },
  { keys: '↓ o S / ↑ o W', label: 'Tirar / empujar el comando' },
];

/** Tracks held keys and turns presses into commands. Returns a detach function. */
export function attachKeyboard(target: Window, onCommand: (command: Command) => void, inputs: Inputs): () => void {
  const down = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const hold = HOLD_KEYS[e.code];
    if (hold) {
      inputs[hold] = true;
      e.preventDefault();
      return;
    }
    const command = PRESS_KEYS[e.code];
    if (command && !e.repeat) {
      onCommand(command);
      e.preventDefault();
    }
  };
  const up = (e: KeyboardEvent) => {
    const hold = HOLD_KEYS[e.code];
    if (!hold) return;
    // Two keys can drive the same input (↓ and S): release only when neither is held is overkill here.
    inputs[hold] = false;
  };
  const blur = () => {
    for (const key of Object.keys(inputs) as (keyof Inputs)[]) inputs[key] = false;
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', blur);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    target.removeEventListener('blur', blur);
  };
}
