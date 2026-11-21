import type { Id, PinRef } from '@/contracts';

/** "led1" + "anode" → "led1.anode". */
export const pinRef = (part: Id, pin: string): PinRef => `${part}.${pin}`;

/** "led1.anode" → { part: 'led1', pin: 'anode' }. Pin ids may contain dots? No — part ids never do, so split on the first dot. */
export function parsePinRef(ref: PinRef): { part: Id; pin: string } {
  const i = ref.indexOf('.');
  if (i <= 0) return { part: ref, pin: '' };
  return { part: ref.slice(0, i), pin: ref.slice(i + 1) };
}

export const isPinRef = (s: string): boolean => /^[A-Za-z][\w-]*\.[^\s]+$/.test(s);
