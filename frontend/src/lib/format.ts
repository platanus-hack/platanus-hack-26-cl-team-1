/** Spanish number formatting helpers for measurements. */
const nf = (digits: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: digits });

export function formatOhms(ohms: number): string {
  if (ohms >= 1e6) return `${nf(2).format(ohms / 1e6)} MΩ`;
  if (ohms >= 1e3) return `${nf(2).format(ohms / 1e3)} kΩ`;
  return `${nf(1).format(ohms)} Ω`;
}

export function formatCurrent(amps: number): string {
  const a = Math.abs(amps);
  if (a >= 1) return `${nf(2).format(amps)} A`;
  if (a >= 1e-3) return `${nf(1).format(amps * 1e3)} mA`;
  if (a >= 1e-6) return `${nf(0).format(amps * 1e6)} µA`;
  return '0 mA';
}

export function formatVolts(v: number): string {
  return `${nf(2).format(v)} V`;
}

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${nf(1).format(ms / 1000)} s`;
  return `${Math.round(ms)} ms`;
}
