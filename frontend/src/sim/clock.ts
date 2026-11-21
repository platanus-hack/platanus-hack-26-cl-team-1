/** Time helpers: sim clock formatting and a rAF scheduler with a timer fallback. */

/** 12345 ms → "00:12.3" (mm:ss.d). */
export function formatClock(ms: number): string {
  const t = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const tenths = Math.floor(t / 100);
  const d = tenths % 10;
  const totalS = Math.floor(tenths / 10);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
}

/** 1250 ms → "00:01.250" (serial timestamps). */
export function formatStamp(ms: number): string {
  const t = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const milli = t % 1000;
  const totalS = Math.floor(t / 1000);
  return `${String(Math.floor(totalS / 60)).padStart(2, '0')}:${String(totalS % 60).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

export const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function requestFrame(cb: (now: number) => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const h = requestAnimationFrame(cb);
    return () => cancelAnimationFrame(h);
  }
  const h = setTimeout(() => cb(nowMs()), 16);
  return () => clearTimeout(h);
}
