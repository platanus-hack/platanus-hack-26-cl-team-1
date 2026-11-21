/** Spanish formatting for the compile panel (pure, unit-tested). */
import type { CompileResult } from '@/contracts';

const nf = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const formatInt = (n: number) => nf.format(n);

export function usagePercent(used: number, max: number): number {
  if (!max || max <= 0) return 0;
  return Math.max(0, Math.min(100, (used / max) * 100));
}

/** Whole percent, truncated like the Arduino IDE ("924 bytes (2%)"). */
export const wholePercent = (used: number, max: number) => Math.floor(usagePercent(used, max));

/** "Usa 1.234 bytes (3 %) de 32.256" */
export function usageText(used: number, max: number): string {
  if (!max) return `Usa ${formatInt(used)} bytes`;
  return `Usa ${formatInt(used)} bytes (${wholePercent(used, max)} %) de ${formatInt(max)}`;
}

export type UsageLevel = 'ok' | 'warn' | 'danger';
export const usageLevel = (pct: number): UsageLevel => (pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : 'ok');

/** "2,4 s" / "0,8 s" / "1 min 05 s" */
export function formatSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${nf1.format(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;
}

/**
 * Meaningful lines of the log for a short error summary when no sketch line has an error:
 * starts at the first line that mentions an error (warnings printed before it are skipped).
 */
export function logSummary(log: string, maxLines = 3): string {
  const lines = log
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(Sketch uses|Global variables use|Used library|Used platform|Using library)/i.test(l));
  const from = Math.max(0, lines.findIndex((l) => /\berror\b/i.test(l)));
  return lines.slice(from, from + maxLines).join('\n');
}

/** Download button label: ".hex" for the Uno, ".bin" for the ESP32-C6. */
export function artifactExt(result: Pick<CompileResult, 'artifactName' | 'board'>): string {
  if (result.artifactName?.endsWith('.hex')) return '.hex';
  if (result.artifactName?.endsWith('.bin')) return '.bin';
  return result.board === 'uno' ? '.hex' : '.bin';
}

/** One line of the sketch (1-based), trimmed for display. */
export function codeLine(code: string | null, line: number): string | null {
  if (!code || line < 1) return null;
  const l = code.split('\n')[line - 1];
  return l === undefined ? null : l.replace(/\s+$/, '');
}

/**
 * The code without comments, trailing spaces or blank lines: two sketches with the same
 * fingerprint build the same binary. Renaming the project or wiring an unused part only changes
 * the header comments, which must not mark a build as outdated.
 */
export function codeFingerprint(code: string | null): string | null {
  if (code === null) return null;
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      out += code.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
    } else if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? code.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l !== '')
    .join('\n');
}
